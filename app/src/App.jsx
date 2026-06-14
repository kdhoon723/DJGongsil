import { useEffect, useMemo, useState } from "react";

const DAYS = ["월", "화", "수", "목", "금"];
const DAY_LABEL = { 월: "월요일", 화: "화요일", 수: "수요일", 목: "목요일", 금: "금요일" };
const OPEN = 8 * 60 + 30;
const CLOSE = 22 * 60 + 40;

const toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

function nowDefaults() {
  const d = new Date();
  const map = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };
  const day = map[d.getDay()] || "월";
  const t = Math.min(CLOSE, Math.max(OPEN, d.getHours() * 60 + d.getMinutes()));
  return { day, t };
}

function statusFor(room, day, t) {
  const ds = room.sessions
    .filter((s) => s.day === day)
    .map((s) => ({ ...s, s: toMin(s.start), e: toMin(s.end) }))
    .sort((a, b) => a.s - b.s);
  const cur = ds.find((x) => x.s <= t && t < x.e);
  if (cur) {
    let end = cur.e;
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of ds)
        if (x.s <= end && x.e > end) {
          end = x.e;
          grew = true;
        }
    }
    return { free: false, until: end, current: cur };
  }
  const next = ds.find((x) => x.s > t);
  return { free: true, until: next ? next.s : null, todayCount: ds.length };
}

function useData() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);
  return { data, err };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function App() {
  const { data, err } = useData();
  const init = useMemo(nowDefaults, []);
  const [day, setDay] = useState(init.day);
  const [t, setT] = useState(init.t);
  const [bldg, setBldg] = useState("전체");
  const [showBusy, setShowBusy] = useState(false);
  const clock = useClock();

  const buildings = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of data.rooms) m.set(r.bldg, r.bldgName);
    return [...m.entries()].map(([code, name]) => ({ code, name }));
  }, [data]);

  const computed = useMemo(() => {
    if (!data) return null;
    const rooms = data.rooms
      .filter((r) => bldg === "전체" || r.bldg === bldg)
      .map((r) => ({ ...r, st: statusFor(r, day, t) }));
    const free = rooms.filter((r) => r.st.free);
    const groups = new Map();
    for (const r of showBusy ? rooms : free) {
      if (!groups.has(r.bldgName)) groups.set(r.bldgName, []);
      groups.get(r.bldgName).push(r);
    }
    for (const arr of groups.values())
      arr.sort((a, b) => a.ho.localeCompare(b.ho, "ko", { numeric: true }));
    return { total: rooms.length, free: free.length, groups };
  }, [data, day, t, bldg, showBusy]);

  if (err) return <Center>데이터를 불러오지 못했어요.</Center>;
  if (!data || !computed)
    return <Center>강의실 불러오는 중…</Center>;

  const groups = [...computed.groups.entries()];

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 pb-24 sm:px-8">
      {/* 헤더 */}
      <header className="flex items-center justify-between border-b border-line py-5">
        <div className="flex items-baseline gap-2">
          <span className="serif text-2xl font-medium italic text-pine">DJGongsil</span>
        </div>
        <div className="serif tnum text-2xl text-ink-2">
          {String(clock.getHours()).padStart(2, "0")}
          <span className="text-muted">:</span>
          {String(clock.getMinutes()).padStart(2, "0")}
        </div>
      </header>

      {/* 히어로 요약 */}
      <section className="pt-9 pb-7">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          {DAY_LABEL[day]} · <span className="tnum">{fmt(t)}</span> 기준
        </p>
        <h1 className="serif mt-2 text-[2.6rem] leading-[1.05] font-medium text-ink sm:text-5xl">
          비어있는 강의실{" "}
          <span className="text-pine">{computed.free}곳</span>
        </h1>
        <p className="mt-2 text-sm text-muted">
          {bldg === "전체" ? "전체 캠퍼스" : buildings.find((b) => b.code === bldg)?.name} ·
          조회 강의실 <span className="tnum">{computed.total}</span>곳
        </p>
      </section>

      {/* 컨트롤 */}
      <div className="sticky top-0 z-10 -mx-5 border-y border-line bg-paper/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              const n = nowDefaults();
              setDay(n.day);
              setT(n.t);
            }}
            className="rounded-full border border-pine bg-pine/10 px-3.5 py-1.5 text-sm font-semibold text-pine transition hover:bg-pine/20 active:scale-95"
          >
            지금
          </button>
          <div className="flex items-center rounded-full border border-line bg-raised p-0.5">
            {DAYS.map((d) => (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`h-8 w-9 rounded-full text-sm font-semibold transition ${
                  day === d
                    ? "bg-pine text-paper shadow-[0_2px_8px_rgba(31,111,77,0.45)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="serif tnum ml-auto text-xl text-pine">{fmt(t)}</div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="tnum text-[11px] text-muted">08:30</span>
          <input
            type="range"
            className="scrub flex-1"
            min={OPEN}
            max={CLOSE}
            step={10}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          />
          <span className="tnum text-[11px] text-muted">22:40</span>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          <Chip active={bldg === "전체"} onClick={() => setBldg("전체")}>
            전체
          </Chip>
          {buildings.map((b) => (
            <Chip key={b.code} active={bldg === b.code} onClick={() => setBldg(b.code)}>
              {b.name}
            </Chip>
          ))}
        </div>
      </div>

      {/* 토글 */}
      <div className="flex justify-end pt-4">
        <button
          onClick={() => setShowBusy((v) => !v)}
          className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          {showBusy ? "빈 강의실만 보기" : "사용중인 곳도 보기"}
        </button>
      </div>

      {/* 결과 */}
      {groups.length === 0 ? (
        <p className="serif mt-16 text-center text-lg italic text-muted">
          {showBusy ? "표시할 강의실이 없어요." : "이 시간엔 빈 강의실이 없네요."}
        </p>
      ) : (
        <div className="mt-3 space-y-9">
          {groups.map(([name, rooms], gi) => (
            <section key={name} className="rise" style={{ animationDelay: `${gi * 45}ms` }}>
              <div className="mb-3 flex items-baseline justify-between border-b border-line pb-2">
                <h2 className="text-sm font-semibold tracking-wide text-ink">{name}</h2>
                <span className="tnum text-xs text-muted">{rooms.length}곳</span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {rooms.map((r) => (
                  <RoomCard key={r.code} room={r} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <footer className="mt-20 border-t border-line pt-6 text-xs leading-relaxed text-muted">
        <p>대진대학교 {data.year} 학부·대학원 통합 강의실 시간표 기준</p>
        <p className="mt-1 opacity-70">
          빈 강의실은 정규 수업이 없는 시간일 뿐이에요. 실제 이용 가능 여부는 현장에서 확인하세요.
        </p>
      </footer>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
        active
          ? "border-pine bg-pine text-paper shadow-[0_2px_8px_rgba(31,111,77,0.35)]"
          : "border-line text-muted hover:border-line-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function RoomCard({ room }) {
  const st = room.st;
  return (
    <div className="rounded-xl border border-line bg-raised p-4 transition hover:border-line-2 hover:shadow-[0_2px_16px_rgba(27,26,21,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="tnum text-lg font-semibold leading-none text-ink">{room.ho}</div>
          <div className="mt-1.5 truncate text-xs text-muted">{room.roomType || "강의실"}</div>
        </div>
        {room.capacity ? (
          <div className="tnum shrink-0 text-xs text-muted">{room.capacity}석</div>
        ) : null}
      </div>

      <div className="mt-3.5 border-t border-line pt-3">
        {st.free ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-pine" />
            <span className="font-medium text-pine">
              {st.until ? (
                <>
                  <span className="tnum">{fmt(st.until)}</span>까지 비어요
                </>
              ) : st.todayCount === 0 ? (
                "오늘 수업 없어요"
              ) : (
                "일과 끝까지 비어요"
              )}
            </span>
          </div>
        ) : (
          <div className="text-sm">
            <span className="font-medium text-clay">사용 중</span>
            <span className="tnum text-muted"> · {fmt(st.until)}부터 빔</span>
            <div className="mt-1 truncate text-xs text-muted">
              {st.current.course} · {st.current.prof}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Center({ children }) {
  return (
    <div className="serif grid min-h-dvh place-items-center px-6 text-center text-lg italic text-muted">
      {children}
    </div>
  );
}
