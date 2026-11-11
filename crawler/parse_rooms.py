# 크롤된 rooms_*.json 의 raw(렌더 텍스트)를 줄 단위로 재파싱.
# 추출: 세션(과목/교수/코드/요일/시간/수강인원) + 강의실 메타(수용인원, 요일별/종합 사용률)
# raw 보존 덕에 재크롤 없이 파싱만 교정/확장 가능.
import json, re, glob, os
from datetime import date

EXTRACTED = os.path.join(os.path.dirname(__file__), "..", "data", "extracted")
DAYS = ["월", "화", "수", "목", "금"]

# 과목번호는 단독 줄이나 교수명 줄 끝에 온다: "(525090-01)", "이정 교수(200230)", "(MS1155)".
# 학부·대학원 합반은 앞 과목번호 뒤에 " /"가 붙고 시간 줄도 "화13:30~15:00 / 화"가 된다.
RE_CODE = re.compile(r"\(([0-9A-Z]{5,8})(?:-(\d{2}))?\)\s*/?$")
RE_MERGED = re.compile(r"\([0-9A-Z]{5,8}(?:-\d{2})?\)\s*/")
RE_DT = re.compile(r"^([월화수목금토일])\s*(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})(?:\s*/.*)?$")
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
    for i in range(1, len(lines)):
        mdt = RE_DT.match(lines[i])
        mc = RE_CODE.search(lines[i - 1])
        if not mdt or not mc:
            continue
        day, sh, sm, eh, em = mdt.groups()
        head, j = lines[i - 1][: mc.start()].strip(), i - 2
        # 교수명은 코드 줄 앞이나 윗줄에 오고, "타카쿠사키미나 교" + "수(…)"처럼 잘리기도 한다
        if not head.endswith("교수") and j >= 0 and RE_PROF.match(lines[j] + head):
            head, j = lines[j] + head, j - 1
        mp = RE_PROF.match(head)
        prof = mp.group(1).strip() if mp else ""
        # 과목명: 역방향 수집. [태그]를 만나면 내용 포함하고 멈춤.
        # Crownix가 "[학"+"]..." 로 태그를 줄바꿈 분할하는 경우가 있어,
        # 그리드(시간/교시)·수강인원·교수·시간·코드 줄을 만나면 경계로 보고 멈춘다.
        parts = []
        while j >= 0:
            L = lines[j]
            mt = RE_TAG.match(L)
            if mt:
                if mt.group(1).strip():
                    parts.insert(0, mt.group(1).strip())
                break
            if RE_MERGED.search(L):
                j -= 1
                continue
            if (RE_TIME_LABEL.match(L) or RE_GYOSI.match(L) or L.startswith("수강인원")
                    or L.endswith("교수") or RE_DT.match(L) or RE_CODE.search(L)):
                break
            parts.insert(0, L)
            j -= 1
        course = "".join(parts)
        course = re.sub(r"\[[^\]]*\]", "", course)  # [학]/[원] 태그 제거
        course = re.sub(r"^\s*[\[\]]+", "", course).strip()  # 분할 태그 잔재(괄호)
        enroll = None
        for L in lines[i + 1:i + 3]:
            me = RE_ENROLL.search(L)
            if me:
                enroll = int(me.group(1))
                break
        out.append({
            "course": course, "prof": prof,
            "curiNo": mc.group(1), "clssNo": mc.group(2) or "",
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


def parse_meta(raw, sessions):
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

    # 리포트는 수업이 하나라도 있는 요일의 사용률만 순서대로 찍는다
    used = [d for d in DAYS if any(s["day"] == d for s in sessions)]

    def by_day(vals):
        return dict(zip(used, vals)) if len(vals) == len(used) else {}

    day = grab_after("주간", "사용률")
    night = grab_after("주야간", "사용률")
    summary = None
    ms = RE_SUMMARY.search(raw or "")
    if ms:
        summary = {"weekday": float(ms.group(1)), "dayNight": float(ms.group(2))}
    return {
        "capacity": cap,
        "usageWeekday": by_day(day),
        "usageDayNight": by_day(night),
        "usageSummary": summary,
    }


# "인119-1 - 교양A/V강의실", "공가A 101 - 실습실", "공다 A107 - 강의실", "정보 202 정보실습실B", "611 - e-강의실"
RE_ROOMNAME = re.compile(r"^((?:[가-힣]+\s?[A-Z]?\s?)?[A-Z]?\d{3,4}(?:-\d+)?)\s*(?:-\s*)?(.*)$")
RE_BASEMENT = re.compile(r"B0\d\d")  # 예B006 = 지하. 공가B 101의 B는 동 이름
RE_ROOMNO = re.compile(r"(\d{3,4})(?:-\d+)?$")


def parse_room_name(name):
    m = RE_ROOMNAME.match((name or "").strip())
    if m:
        return re.sub(r"\s+", "", m.group(1)), m.group(2).strip()
    return (name or "").strip(), ""


def floor_of(ho):
    if RE_BASEMENT.search(ho):
        return -1
    m = RE_ROOMNO.search(ho)
    return int(m.group(1)[0]) if m else None


# 학술 건물이 아닌 곳(기숙사/철거/운동장 등)은 빈 강의실 도구에서 제외
BLDG_EXCLUDE = re.compile(
    r"철거|기숙사|성실관|신념관|운동장|스탠드|경비|총장공관|파워플랜트|학군단|쑤저우|하얼빈|야외|예비군"
)


# 포털은 이공학관 각 동을 A·B 두 건물로 나누지만 학생들은 한 건물로 공가·공나·공다라고 부른다
ENG_HALLS = {
    f"{wing}{n}": (f"A{n}", short, full)
    for n, short, full in [("7", "공가", "이공학관 가동"), ("8", "공나", "이공학관 나동"), ("9", "공다", "이공학관 다동")]
    for wing in "AB"
}


def building_of(b):
    code, name, alias = ENG_HALLS.get(b["bldg"], (b["bldg"], b["bldgName"], None))
    return {"bldg": code, "bldgName": name, **({"bldgAlias": alias} if alias else {})}


def is_open_room(room_type):
    t = room_type or ""
    if re.search(r"연구실|사무실|도서실|회의실|상담실|준비실|사무|인권센터|행정", t):
        return False
    return bool(re.search(r"강의실|회화실|세미나|토론", t))


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
        where = building_of(b)
        for r in b["rooms"]:
            if r.get("online") or r["name"].startswith("이동수업"):
                continue
            if r.get("failed"):
                failed.append(r["name"])
                continue
            raw = r.get("raw", "")
            ho, roomType = parse_room_name(r.get("name") or r.get("ho", ""))
            sess = parse_sessions(raw)
            meta = parse_meta(raw, sess)
            if not (is_open_room(roomType) or sess):
                continue
            app_rooms.append({
                **where,
                "code": r["code"], "ho": ho, "roomType": roomType, "floor": floor_of(ho),
                "capacity": meta["capacity"],
                "usageWeekday": meta["usageWeekday"],
                "usageDayNight": meta["usageDayNight"],
                "usageSummary": meta["usageSummary"],
                "sessions": sess,
            })
            for s in sess:
                flat.append({**where, "ho": ho, "roomType": roomType,
                             "code": r["code"], "capacity": meta["capacity"], **s})
    collected = [b.get("collectedAt") for b in bldgs]
    updated = max(collected) if all(collected) else date.fromtimestamp(max(map(os.path.getmtime, files))).isoformat()
    json.dump({"year": semester, "updated": updated, "rooms": app_rooms},
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
