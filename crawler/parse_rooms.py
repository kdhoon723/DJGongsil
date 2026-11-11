# 크롤된 rooms_*.json 의 raw(렌더 텍스트)를 줄 단위로 재파싱.
# 추출: 세션(과목/교수/코드/요일/시간/수강인원) + 강의실 메타(수용인원, 요일별/종합 사용률)
# raw 보존 덕에 재크롤 없이 파싱만 교정/확장 가능.
import json, re, glob, os

EXTRACTED = os.path.join(os.path.dirname(__file__), "..", "data", "extracted")
DAYS = ["월", "화", "수", "목", "금"]

RE_CODE = re.compile(r"^\((\d{5,6})-(\d{2})\)$")
RE_DT = re.compile(r"^([월화수목금토일])\s*(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})$")
RE_PROF = re.compile(r"^(.+?)\s*교수$")
RE_TAG = re.compile(r"^\[[^\]]*\](.*)$")
RE_ENROLL = re.compile(r"수강인원:\s*(\d+)")
RE_TIME_LABEL = re.compile(r"^\d{1,2}:\d{2}$")  # 그리드 시각 (12:00)
RE_GYOSI = re.compile(r"^\d{1,2}교시$")  # 그리드 교시 (7교시)
RE_CAP = re.compile(r"수용인원:\s*(\d+)\s*명")
RE_SUMMARY = re.compile(
    r"월~금\s*주간사용률:\s*([\d.]+)%\s*/\s*월~금\s*주야간사용률:\s*([\d.]+)%"
)


def parse_sessions(raw):
    lines = [l.strip() for l in (raw or "").split("\n")]
    out = []
    for i, line in enumerate(lines):
        mc = RE_CODE.match(line)
        if not mc or i + 1 >= len(lines):
            continue
        mdt = RE_DT.match(lines[i + 1])
        if not mdt:
            continue
        day, sh, sm, eh, em = mdt.groups()
        prof = ""
        if i >= 1:
            mp = RE_PROF.match(lines[i - 1])
            if mp:
                prof = mp.group(1).strip()
        # 과목명: 코드 앞에서 역방향 수집. [태그]를 만나면 내용 포함하고 멈춤.
        # Crownix가 "[학"+"]..." 로 태그를 줄바꿈 분할하는 경우가 있어,
        # 그리드(시간/교시)·수강인원·교수·시간·코드 줄을 만나면 경계로 보고 멈춘다.
        parts, j = [], i - 2
        while j >= 0:
            L = lines[j]
            mt = RE_TAG.match(L)
            if mt:
                if mt.group(1).strip():
                    parts.insert(0, mt.group(1).strip())
                break
            if (RE_TIME_LABEL.match(L) or RE_GYOSI.match(L) or L.startswith("수강인원")
                    or L.endswith("교수") or RE_DT.match(L) or RE_CODE.match(L)):
                break
            parts.insert(0, L)
            j -= 1
        course = "".join(parts)
        course = re.sub(r"^\s*\[[^\]]*\]", "", course)  # [학]/[대] 태그 제거
        course = re.sub(r"^\s*[\[\]]+", "", course).strip()  # 분할 태그 잔재(괄호)
        enroll = None
        if i + 2 < len(lines):
            me = RE_ENROLL.search(lines[i + 2])
            if me:
                enroll = int(me.group(1))
        out.append({
            "course": course, "prof": prof,
            "curiNo": mc.group(1), "clssNo": mc.group(2),
            "day": day, "start": f"{int(sh):02d}:{sm}", "end": f"{int(eh):02d}:{em}",
            "enroll": enroll,
        })
    seen, uniq = set(), []
    for s in out:
        k = (s["curiNo"], s["clssNo"], s["day"], s["start"])
        if k not in seen:
            seen.add(k)
            uniq.append(s)
    return uniq


def parse_meta(raw):
    lines = [l.strip() for l in (raw or "").split("\n")]
    cap = None
    mc = RE_CAP.search(raw or "")
    if mc:
        cap = int(mc.group(1))

    def grab_after(a1, a2):
        for i in range(len(lines) - 1):
            if lines[i] == a1 and lines[i + 1] == a2:
                vals, j = [], i + 2
                while j < len(lines) and re.match(r"^[\d.]+%$", lines[j]) and len(vals) < 5:
                    vals.append(float(lines[j][:-1]))
                    j += 1
                return vals
        return []

    day = grab_after("주간", "사용률")
    night = grab_after("주야간", "사용률")
    summary = None
    ms = RE_SUMMARY.search(raw or "")
    if ms:
        summary = {"weekday": float(ms.group(1)), "dayNight": float(ms.group(2))}
    return {
        "capacity": cap,
        "usageWeekday": dict(zip(DAYS, day)) if day else {},
        "usageDayNight": dict(zip(DAYS, night)) if night else {},
        "usageSummary": summary,
    }


# "인119-1 - 교양A/V강의실" -> ("인119-1","교양A/V강의실")  (호수 내부 대시 보존)
RE_ROOMNAME = re.compile(r"^([가-힣A-Za-z]+\d+(?:-\d+)?)\s*-?\s*(.*)$")


def parse_room_name(name):
    m = RE_ROOMNAME.match((name or "").strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return (name or "").strip(), ""


# 학술 건물이 아닌 곳(기숙사/철거/운동장 등)은 빈 강의실 도구에서 제외
BLDG_EXCLUDE = re.compile(
    r"철거|기숙사|성실관|신념관|운동장|스탠드|경비|총장공관|파워플랜트|학군단|쑤저우|하얼빈|야외|예비군"
)


def is_lecture(room_type):
    t = room_type or ""
    if re.search(r"연구실|사무실|도서실|회의실|상담실|준비실|사무|인권센터|행정", t):
        return False
    return bool(re.search(r"강의실|실습|회화실|세미나|랩|스튜디오|실험|연습실", t))


def main():
    files = [f for f in sorted(glob.glob(os.path.join(EXTRACTED, "rooms_*.json")))
             if not f.endswith("rooms_all.json")]
    bldgs = [json.load(open(f, encoding="utf-8")) for f in files]
    semesters = {b.get("year") for b in bldgs}
    if len(semesters) != 1:
        raise SystemExit(f"rooms_*.json 학기가 하나가 아님: {sorted(map(str, semesters))}")
    semester = semesters.pop()
    app_rooms, flat, failed = [], [], []
    for b in bldgs:
        if BLDG_EXCLUDE.search(b.get("bldgName", "")):
            continue
        for r in b["rooms"]:
            if r.get("online"):
                continue
            if r.get("failed"):
                failed.append(r["name"])
                continue
            raw = r.get("raw", "")
            ho, roomType = parse_room_name(r.get("name") or r.get("ho", ""))
            sess = parse_sessions(raw)
            meta = parse_meta(raw)
            if not (is_lecture(roomType) or sess):
                continue  # 연구실/사무실 등 제외
            app_rooms.append({
                "bldg": b["bldg"], "bldgName": b["bldgName"],
                "code": r["code"], "ho": ho, "roomType": roomType,
                "capacity": meta["capacity"],
                "usageWeekday": meta["usageWeekday"],
                "usageDayNight": meta["usageDayNight"],
                "usageSummary": meta["usageSummary"],
                "sessions": sess,
            })
            for s in sess:
                flat.append({"bldg": b["bldg"], "bldgName": b["bldgName"],
                             "ho": ho, "roomType": roomType,
                             "code": r["code"], "capacity": meta["capacity"], **s})
    json.dump({"year": semester, "rooms": app_rooms},
              open(os.path.join(EXTRACTED, "app_data.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    json.dump(flat, open(os.path.join(EXTRACTED, "sessions_flat.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    empty = sum(1 for r in app_rooms if not r["sessions"])
    print(f"[{semester}] 강의실 {len(app_rooms)}개 (수업無 {empty}) / 세션 {len(flat)}")
    if failed:
        print(f"  조회 실패로 제외 {len(failed)}개: {', '.join(failed)}")
    for r in app_rooms:
        if r["ho"] == "인105":
            print(f"  인105 수용인원={r['capacity']} 종합사용률={r['usageSummary']}")
            print(f"  요일별 주간사용률={r['usageWeekday']}")


if __name__ == "__main__":
    main()
