import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";

const DAYS = ["월", "화", "수", "목", "금"];
const DAY_LABEL = { 월: "월요일", 화: "화요일", 수: "수요일", 목: "목요일", 금: "금요일" };
const OPEN = 8 * 60 + 30;
const CLOSE = 22 * 60 + 40;

// 실제 수업 시간대 (2시간 블록 단위)
const PERIODS = [
  { t: 9 * 60 + 30, label: "1교시" },
  { t: 11 * 60 + 30, label: "2교시" },
  { t: 13 * 60 + 30, label: "3교시" },
  { t: 15 * 60 + 30, label: "4교시" },
  { t: 17 * 60 + 30, label: "5교시" },
  { t: 19 * 60, label: "야간" },
];

const toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

function nowDefaults() {
  const d = new Date();
  const map = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };
  return {
    day: map[d.getDay()] || "월",
    t: Math.min(CLOSE, Math.max(OPEN, d.getHours() * 60 + d.getMinutes())),
  };
}

function statusFor(room, day, t) {
  const ds = room.sessions
    .filter((s) => s.day === day)
    .map((s) => ({ s: toMin(s.start), e: toMin(s.end), course: s.course, prof: s.prof }))
    .sort((a, b) => a.s - b.s);
  const cur = ds.find((x) => x.s <= t && t < x.e);
  if (cur) {
    let end = cur.e, grew = true;
    while (grew) {
      grew = false;
      for (const x of ds) if (x.s <= end && x.e > end) { end = x.e; grew = true; }
    }
    return { free: false, until: end, current: cur };
  }
  const next = ds.find((x) => x.s > t);
  return { free: true, until: next ? next.s : null, today: ds.length };
}

// 빈 시간 길이 → 표시 정보
function freeInfo(st, t) {
  if (st.until == null) return { mins: 100000, tone: "long", label: "종일 비어요" };
  const mins = st.until - t;
  const tone = mins >= 120 ? "long" : mins >= 60 ? "mid" : "soon";
  return { mins, until: st.until, tone };
}

const DATA_FILES = ["data.json", "data.sample.json"];

function useData() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      let lastError = null;
      for (const file of DATA_FILES) {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}${file}`);
          if (!res.ok) throw new Error(`${file}: ${res.status}`);
          const json = await res.json();
          if (alive) setData(json);
          return;
        } catch (e) {
          lastError = e;
        }
      }
      if (alive) setErr(String(lastError || new Error("data unavailable")));
    }

    load();
    return () => { alive = false; };
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

const LAST_BLDG_KEY = "djgongsil:lastBldg";

export default function App() {
  const { data, err } = useData();
  const init = useMemo(nowDefaults, []);
  const [step, setStep] = useState("when"); // when | where | rooms
  const [day, setDay] = useState(init.day);
  const [t, setT] = useState(init.t);
  const [bldg, setBldg] = useState("전체");
  const [sort, setSort] = useState("duration");
  const [showBusy, setShowBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const clock = useClock();

  // 스텝 전환 (View Transitions 슬라이드)
  const go = (next, dir = "forward") => {
    if (typeof document !== "undefined" && document.startViewTransition) {
      document.documentElement.dataset.nav = dir;
      document.startViewTransition(() => flushSync(() => setStep(next)));
    } else {
      setStep(next);
    }
  };

  const buildings = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of data.rooms) m.set(r.bldg, r.bldgName);
    return [...m.entries()].map(([code, name]) => ({ code, name }));
  }, [data]);

  // (요일,시각) 기준 전체 방 상태
  const scored = useMemo(() => {
    if (!data) return [];
    return data.rooms.map((r) => {
      const st = statusFor(r, day, t);
      return { ...r, st, fi: st.free ? freeInfo(st, t) : null };
    });
  }, [data, day, t]);

  const freeByBldg = useMemo(() => {
    const m = new Map();
    for (const r of scored) if (r.st.free) m.set(r.bldg, (m.get(r.bldg) || 0) + 1);
    return m;
  }, [scored]);

  const totalFree = useMemo(() => scored.filter((r) => r.st.free).length, [scored]);

  const pickBldg = (code) => {
    setBldg(code);
    if (code !== "전체") localStorage.setItem(LAST_BLDG_KEY, code);
    go("rooms");
  };

  const jumpNow = () => {
    const n = nowDefaults();
    setDay(n.day);
    setT(n.t);
    setBldg("전체");
    go("rooms");
  };

  if (err) return <Center>데이터를 불러오지 못했어요.</Center>;
  if (!data) return <Center>강의실 불러오는 중…</Center>;

  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <div style={{ viewTransitionName: "step" }} key={step}>
        {step === "when" && (
          <WhenStep
            clock={clock}
            day={day}
            setDay={setDay}
            t={t}
            setT={setT}
            onNow={jumpNow}
            onNext={() => go("where")}
          />
        )}
        {step === "where" && (
          <WhereStep
            day={day}
            t={t}
            buildings={buildings}
            freeByBldg={freeByBldg}
            totalFree={totalFree}
            onBack={() => go("when", "backward")}
            onPick={pickBldg}
          />
        )}
        {step === "rooms" && (
          <RoomsStep
            day={day}
            setDay={setDay}
            t={t}
            setT={setT}
            bldg={bldg}
            buildings={buildings}
            scored={scored}
            sort={sort}
            setSort={setSort}
            showBusy={showBusy}
            setShowBusy={setShowBusy}
            onEditWhere={() => go("where", "backward")}
            onDetail={setDetail}
          />
        )}
      </div>
      {detail && <DetailSheet room={detail} day={day} t={t} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ───────── STEP 1 · 언제 ───────── */
function WhenStep({ clock, day, setDay, t, setT, onNow, onNext }) {
  const hh = String(clock.getHours()).padStart(2, "0");
  const mm = String(clock.getMinutes()).padStart(2, "0");
  const now = nowDefaults();
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-14 pb-8 sm:px-8">
      <p className="serif text-sm italic text-pine">DJGongsil</p>
      <h1 className="serif mt-3 text-[2.5rem] leading-[1.1] font-medium text-ink">
        언제 빈 강의실이
        <br />
        필요하세요?
      </h1>

      {/* 지금 = 직행 */}
      <button
        onClick={onNow}
        className="press mt-8 flex items-center justify-between rounded-2xl border border-pine bg-pine px-6 py-5 text-left text-paper shadow-[0_6px_24px_rgba(31,111,77,0.28)]"
      >
        <div>
          <div className="text-sm font-medium text-paper/75">지금 바로</div>
          <div className="mt-0.5 text-xl font-bold">
            {DAY_LABEL[now.day]} <span className="tnum">{hh}:{mm}</span>
          </div>
        </div>
        <span className="serif tnum text-3xl">→</span>
      </button>

      <div className="mt-9 flex items-center gap-3">
        <div className="h-px flex-1 bg-line" />
        <span className="text-xs text-muted">다른 시간 고르기</span>
        <div className="h-px flex-1 bg-line" />
      </div>

      {/* 요일 */}
      <div className="mt-5 flex items-center gap-1.5">
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={`press h-11 flex-1 rounded-xl text-base font-semibold transition ${
              day === d
                ? "bg-pine text-paper shadow-[0_2px_8px_rgba(31,111,77,0.4)]"
                : "border border-line bg-raised text-muted"
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* 수업 시간대 */}
      <p className="mt-6 mb-2 text-xs text-muted">수업 시간대</p>
      <div className="no-bar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {PERIODS.map((p) => {
          const active = t === p.t;
          return (
            <button
              key={p.label}
              onClick={() => setT(p.t)}
              className={`press flex shrink-0 flex-col items-center rounded-xl border px-4 py-2 transition ${
                active ? "border-pine bg-pine text-paper" : "border-line bg-raised text-ink"
              }`}
            >
              <span className="tnum text-sm font-semibold">{fmt(p.t)}</span>
              <span className={`text-[11px] ${active ? "text-paper/80" : "text-muted"}`}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1" />
      <button
        onClick={onNext}
        className="press mt-8 w-full rounded-2xl bg-pine py-4 text-base font-bold text-paper shadow-[0_4px_18px_rgba(31,111,77,0.28)]"
      >
        {DAY_LABEL[day]} <span className="tnum">{fmt(t)}</span> · 건물 고르기 →
      </button>
    </div>
  );
}

/* ───────── STEP 2 · 어디 ───────── */
function WhereStep({ day, t, buildings, freeByBldg, totalFree, onBack, onPick }) {
  const [q, setQ] = useState("");
  const last = typeof localStorage !== "undefined" ? localStorage.getItem(LAST_BLDG_KEY) : null;
  const list = useMemo(() => {
    let arr = buildings.filter((b) => (freeByBldg.get(b.code) || 0) >= 0);
    if (q) arr = arr.filter((b) => b.name.includes(q));
    // 최근 건물 맨 위
    arr = [...arr].sort((a, b) => {
      if (a.code === last) return -1;
      if (b.code === last) return 1;
      return (freeByBldg.get(b.code) || 0) > (freeByBldg.get(a.code) || 0) ? 1 : -1;
    });
    return arr;
  }, [buildings, q, freeByBldg, last]);

  return (
    <div className="flex min-h-dvh flex-col px-5 pt-6 pb-8 sm:px-8">
      <StepHeader onBack={onBack} crumb={`${DAY_LABEL[day]} ${fmt(t)}`} />
      <h2 className="serif mt-4 text-3xl font-medium text-ink">어디서 찾을까요?</h2>

      <div className="relative mt-5">
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="건물 검색…"
          className="w-full rounded-xl border border-line bg-raised py-3 pl-9 pr-4 text-sm text-ink outline-none focus:border-pine"
        />
      </div>

      <div className="mt-4 flex-1 space-y-2 overflow-y-auto pb-2">
        {!q && (
          <BldgRow name="전체 캠퍼스" count={totalFree} primary onClick={() => onPick("전체")} />
        )}
        {list.map((b) => (
          <BldgRow
            key={b.code}
            name={b.name}
            count={freeByBldg.get(b.code) || 0}
            star={b.code === last}
            onClick={() => onPick(b.code)}
          />
        ))}
        {list.length === 0 && (
          <p className="serif mt-10 text-center italic text-muted">검색 결과가 없어요.</p>
        )}
      </div>
    </div>
  );
}

function BldgRow({ name, count, primary, star, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`press flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition ${
        primary ? "border-pine bg-pine-soft" : "border-line bg-raised hover:border-line-2"
      }`}
    >
      <span className="flex items-center gap-1.5 font-semibold text-ink">
        {star && <span className="text-pine">★</span>}
        {name}
      </span>
      <span className="text-sm">
        <span className="tnum font-bold text-pine">{count}</span>
        <span className="text-muted"> 곳 빔</span>
      </span>
    </button>
  );
}

/* ───────── STEP 3 · 강의실 ───────── */
const SORTS = [
  { k: "duration", label: "오래 빔순" },
  { k: "capacity", label: "넓은 순" },
  { k: "ho", label: "호수순" },
];

function RoomsStep({ day, setDay, t, setT, bldg, buildings, scored, sort, setSort, showBusy, setShowBusy, onEditWhere, onDetail }) {
  const bldgName = bldg === "전체" ? "전체 캠퍼스" : buildings.find((b) => b.code === bldg)?.name;
  const inScope = useMemo(
    () => scored.filter((r) => bldg === "전체" || r.bldg === bldg),
    [scored, bldg]
  );
  const freeCount = useMemo(() => inScope.filter((r) => r.st.free).length, [inScope]);
  const rooms = useMemo(() => {
    let arr = showBusy ? [...inScope] : inScope.filter((r) => r.st.free);
    arr = [...arr];
    arr.sort((a, b) => {
      if (a.st.free !== b.st.free) return a.st.free ? -1 : 1; // 빈 방 먼저
      if (sort === "capacity") return (b.capacity || 0) - (a.capacity || 0);
      if (sort === "ho")
        return a.bldg === b.bldg
          ? a.ho.localeCompare(b.ho, "ko", { numeric: true })
          : a.bldgName.localeCompare(b.bldgName, "ko");
      if (a.st.free) return (b.fi?.mins || 0) - (a.fi?.mins || 0); // 오래 빔순
      return (a.st.until || 0) - (b.st.until || 0);
    });
    return arr;
  }, [inScope, sort, showBusy]);

  return (
    <div className="px-5 pb-24 pt-6 sm:px-8">
      <div className="flex items-center gap-3">
        <button onClick={onEditWhere} className="press -ml-1 p-1 text-xl text-ink">←</button>
        <button
          onClick={onEditWhere}
          className="press inline-flex items-center gap-1 rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-ink"
        >
          {bldgName} <span className="text-muted">✎</span>
        </button>
      </div>

      <h2 className="serif mt-4 text-3xl font-medium text-ink">
        빈 강의실 <span className="text-pine">{freeCount}곳</span>
      </h2>

      {/* 요일 + 시간 스크러버 (결과 페이지에서 바로 조절) */}
      <div className="mt-4 rounded-2xl border border-line bg-raised p-3">
        <div className="flex items-center gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d}
              onClick={() => setDay(d)}
              className={`press h-8 flex-1 rounded-lg text-sm font-semibold transition ${
                day === d ? "bg-pine text-paper" : "text-muted"
              }`}
            >
              {d}
            </button>
          ))}
          <span className="serif tnum ml-1 w-14 shrink-0 text-right text-lg text-pine">{fmt(t)}</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2.5">
          <span className="tnum text-[10px] text-muted">08:30</span>
          <input
            type="range"
            className="scrub flex-1"
            min={OPEN}
            max={CLOSE}
            step={10}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
          />
          <span className="tnum text-[10px] text-muted">22:40</span>
        </div>
      </div>

      {/* 정렬 + 수업중 토글 */}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 rounded-full border border-line bg-raised p-0.5">
          {SORTS.map((s) => (
            <button
              key={s.k}
              onClick={() => setSort(s.k)}
              className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition ${
                sort === s.k ? "bg-pine text-paper" : "text-muted"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowBusy((v) => !v)}
          className={`press shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            showBusy ? "border-pine bg-pine-soft text-pine" : "border-line bg-raised text-muted"
          }`}
        >
          수업중{showBusy ? " ✓" : ""}
        </button>
      </div>

      {rooms.length === 0 ? (
        <p className="serif mt-16 text-center text-lg italic text-muted">
          이 시간엔 빈 강의실이 없어요.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rooms.map((r, i) => (
            <RoomCard
              key={r.code}
              room={r}
              showBldg={bldg === "전체"}
              onClick={() => onDetail(r)}
              style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Crumb({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="press inline-flex items-center gap-1 rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-ink"
    >
      {children}
      <span className="text-muted">✎</span>
    </button>
  );
}

function RoomCard({ room, showBldg, onClick, style }) {
  const { st, fi } = room;
  const free = st.free;
  const soon = free && fi.tone === "soon";
  const tagClass = !free
    ? "bg-line text-muted"
    : soon
    ? "bg-clay/10 text-clay"
    : "bg-pine-soft text-pine";
  const tag = !free
    ? "사용중"
    : fi.mins >= 100000
    ? "종일"
    : fi.mins >= 60
    ? `${Math.floor(fi.mins / 60)}시간+`
    : `${fi.mins}분`;
  return (
    <button
      onClick={onClick}
      style={style}
      className={`press rise flex flex-col rounded-xl border p-4 text-left transition ${
        free
          ? "border-line bg-raised hover:border-line-2 hover:shadow-[0_2px_16px_rgba(27,26,21,0.05)]"
          : "border-line bg-paper-2/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`tnum text-lg font-semibold leading-none ${free ? "text-ink" : "text-muted"}`}>
            {room.ho}
          </div>
          <div className="mt-1.5 truncate text-xs text-muted">
            {showBldg ? `${room.bldgName} · ` : ""}
            {room.roomType || "강의실"}
          </div>
        </div>
        {room.capacity ? <div className="tnum shrink-0 text-xs text-muted">{room.capacity}석</div> : null}
      </div>
      <div className="mt-3.5 flex items-center justify-between border-t border-line pt-3">
        {free ? (
          <div className={`flex items-center gap-2 text-sm font-medium ${soon ? "text-clay" : "text-pine"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${soon ? "bg-clay" : "bg-pine"}`} />
            {fi.mins >= 100000
              ? "종일 비어요"
              : soon
              ? `~${fmt(fi.until)} 곧 수업`
              : `${fmt(fi.until)}까지 비어요`}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-line-2" />
            <span className="font-medium text-clay">사용 중</span>
            <span className="tnum text-muted">{fmt(st.until)}부터 빔</span>
          </div>
        )}
        <span className={`tnum rounded-md px-1.5 py-0.5 text-[11px] ${tagClass}`}>{tag}</span>
      </div>
    </button>
  );
}

/* ───────── 상세 바텀시트 ───────── */
function DetailSheet({ room, day, t, onClose }) {
  const st = statusFor(room, day, t);
  const todays = room.sessions
    .filter((s) => s.day === day)
    .map((s) => ({ ...s, _s: toMin(s.start) }))
    .sort((a, b) => a._s - b._s);
  const usage = room.usageWeekday?.[day];
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="backdrop-in absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="sheet-up relative max-h-[80vh] overflow-y-auto rounded-t-3xl bg-paper px-6 pb-10 pt-3">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-2" />
        <div className="flex items-start justify-between">
          <div>
            <h3 className="tnum text-2xl font-bold text-ink">{room.ho}</h3>
            <p className="mt-1 text-sm text-muted">
              {room.bldgName} · {room.roomType || "강의실"}
              {room.capacity ? ` · ${room.capacity}석` : ""}
            </p>
          </div>
          <button onClick={onClose} className="press p-1 text-2xl leading-none text-muted">×</button>
        </div>

        <div className="mt-4 rounded-xl border border-pine/30 bg-pine-soft px-4 py-3">
          <span className="text-sm font-semibold text-pine">
            {st.free
              ? st.until
                ? `지금부터 ${fmt(st.until)}까지 비어요`
                : "오늘 남은 시간 내내 비어요"
              : `${fmt(st.until)}부터 비어요 (지금 ${st.current.course})`}
          </span>
        </div>

        <div className="mt-5 flex items-baseline justify-between">
          <p className="text-sm font-semibold text-ink">{DAY_LABEL[day]} 시간표</p>
          {usage != null && <p className="tnum text-xs text-muted">사용률 {usage}%</p>}
        </div>
        <div className="mt-2 space-y-1.5">
          {todays.length === 0 ? (
            <p className="serif py-4 text-center italic text-muted">오늘 수업이 없어요 · 종일 비어요</p>
          ) : (
            todays.map((s, i) => {
              const on = toMin(s.start) <= t && t < toMin(s.end);
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                    on ? "bg-clay/10" : "bg-raised"
                  }`}
                >
                  <span className="tnum w-24 shrink-0 text-xs text-muted">
                    {s.start}~{s.end}
                  </span>
                  <span className="truncate text-sm text-ink">
                    {s.course} <span className="text-muted">· {s.prof}</span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StepHeader({ onBack, crumb }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onBack} className="press -ml-1 p-1 text-xl text-ink">←</button>
      {crumb && <span className="text-sm text-muted">{crumb}</span>}
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
