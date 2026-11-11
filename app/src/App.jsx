import { useEffect, useId, useMemo, useRef, useState } from "react";

const DAYS = ["월", "화", "수", "목", "금"];
const DAY_LABEL = { 월: "월요일", 화: "화요일", 수: "수요일", 목: "목요일", 금: "금요일" };
const OPEN = 8 * 60 + 30;
const CLOSE = 23 * 60;
const ALL = "all";
const NO_CLASS_LEFT = 1e6;

const PERIODS = [
  { t: 9 * 60 + 30, label: "1교시" },
  { t: 11 * 60 + 30, label: "2교시" },
  { t: 13 * 60 + 30, label: "3교시" },
  { t: 15 * 60 + 30, label: "4교시" },
  { t: 17 * 60 + 30, label: "5교시" },
  { t: 19 * 60, label: "야간" },
];

const MIN_FREE = [
  { m: 0, label: "전부" },
  { m: 60, label: "1시간+" },
  { m: 120, label: "2시간+" },
];

const SORTS = [
  { k: "place", label: "위치순" },
  { k: "duration", label: "오래 빈 순" },
  { k: "capacity", label: "넓은 순" },
];

const NOTICE = {
  weekend: "주말에는 정규 수업이 없어요. 월요일 시간표로 보여드릴게요.",
  early: "아직 수업 시작 전이에요. 08:30 기준으로 보여드릴게요.",
  late: "오늘 수업이 모두 끝났어요. 23:00 기준으로 보여드릴게요.",
};

const toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;
const clampT = (m) => Math.min(CLOSE, Math.max(OPEN, m));
const span = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
};
const byHo = (a, b) => a.ho.localeCompare(b.ho, "ko", { numeric: true });
const floorLabel = (f) => (f == null ? "기타" : f < 0 ? "지하" : `${f}층`);

function liveWhen(date) {
  const dow = date.getDay();
  const mins = date.getHours() * 60 + date.getMinutes();
  const weekend = dow === 0 || dow === 6;
  return {
    day: weekend ? "월" : DAYS[dow - 1],
    t: clampT(mins),
    notice: weekend ? "weekend" : mins < OPEN ? "early" : mins > CLOSE ? "late" : null,
  };
}

function statusFor(room, day, t) {
  const ds = room.sessions
    .filter((s) => s.day === day)
    .map((s) => ({ s: toMin(s.start), e: toMin(s.end), course: s.course }))
    .sort((a, b) => a.s - b.s);
  const cur = ds.find((x) => x.s <= t && t < x.e);
  if (cur) {
    let end = cur.e;
    for (const x of ds) if (x.s <= end && x.e > end) end = x.e;
    return { free: false, until: end, current: cur };
  }
  const next = ds.find((x) => x.s > t);
  return { free: true, until: next ? next.s : null, classesToday: ds.length };
}

function freeMinutes(st, t) {
  return st.until == null ? NO_CLASS_LEFT : st.until - t;
}

function readMain(search) {
  const q = new URLSearchParams(search);
  const d = q.get("d");
  const t = q.get("t");
  const m = Number(q.get("m"));
  return {
    at: DAYS.includes(d) && /^\d{1,2}:\d{2}$/.test(t || "") ? { day: d, t: clampT(toMin(t)) } : null,
    bldg: q.get("b"),
    minFree: MIN_FREE.some((x) => x.m === m) ? m : 0,
    showBusy: q.get("busy") === "1",
    sort: SORTS.some((s) => s.k === q.get("s")) ? q.get("s") : "place",
  };
}

function readOverlay(search) {
  const q = new URLSearchParams(search);
  const room = q.get("r");
  return { room, picker: !room && q.get("pick") === "1" };
}

function toSearch(main, overlay) {
  const q = new URLSearchParams();
  if (main.bldg) q.set("b", main.bldg);
  if (main.at) {
    q.set("d", main.at.day);
    q.set("t", fmt(main.at.t));
  }
  if (main.minFree) q.set("m", String(main.minFree));
  if (main.showBusy) q.set("busy", "1");
  if (main.sort !== "place") q.set("s", main.sort);
  if (overlay.room) q.set("r", overlay.room);
  if (overlay.picker) q.set("pick", "1");
  const s = q.toString();
  return `${location.pathname}${s ? `?${s}` : ""}`;
}

const LAST_BLDG_KEY = "djgongsil:lastBldg";
const remembered = () => {
  try {
    return localStorage.getItem(LAST_BLDG_KEY);
  } catch {
    return null;
  }
};
const remember = (code) => {
  try {
    localStorage.setItem(LAST_BLDG_KEY, code);
  } catch {
  }
};

const DATA_FILES = ["data.json", "data.sample.json"];

function useData() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
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
    })();
    return () => {
      alive = false;
    };
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
  const clock = useClock();
  const [main, setMain] = useState(() => {
    const m = readMain(location.search);
    return { ...m, bldg: m.bldg || remembered() || ALL };
  });
  const [overlay, setOverlay] = useState(() => readOverlay(location.search));
  const mainRef = useRef(main);
  mainRef.current = main;
  const closing = useRef(false);

  useEffect(() => {
    history.replaceState(history.state, "", toSearch(main, readOverlay(location.search)));
  }, [main]);

  useEffect(() => {
    const shared = readOverlay(location.search);
    if ((shared.room || shared.picker) && !history.state?.overlay) {
      history.replaceState(null, "", toSearch(mainRef.current, { room: null, picker: false }));
      history.pushState({ overlay: true }, "", toSearch(mainRef.current, shared));
    }
    const onPop = () => {
      closing.current = false;
      const ov = readOverlay(location.search);
      setOverlay(ov);
      history.replaceState(history.state, "", toSearch(mainRef.current, ov));
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const openOverlay = (next) => {
    history.pushState({ overlay: true }, "", toSearch(mainRef.current, next));
    setOverlay(next);
  };
  const closeOverlay = () => {
    if (history.state?.overlay) {
      if (!closing.current) history.back();
      closing.current = true;
      return;
    }
    const next = { room: null, picker: false };
    history.replaceState(null, "", toSearch(mainRef.current, next));
    setOverlay(next);
  };

  const live = liveWhen(clock);
  const { day, t } = main.at ?? live;
  const notice = main.at ? null : live.notice;
  const update = (patch) => setMain((m) => ({ ...m, ...patch }));
  const setDay = (d) => update({ at: { day: d, t } });
  const setT = (v) => update({ at: { day, t: v } });

  const buildings = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const r of data.rooms) m.set(r.bldg, { code: r.bldg, name: r.bldgName, alias: r.bldgAlias });
    return [...m.values()];
  }, [data]);
  const bldg = buildings.some((b) => b.code === main.bldg) ? main.bldg : ALL;

  const scored = useMemo(() => {
    if (!data) return [];
    return data.rooms.map((r) => {
      const st = statusFor(r, day, t);
      return { ...r, st, mins: st.free ? freeMinutes(st, t) : 0, idle: r.sessions.length === 0 };
    });
  }, [data, day, t]);

  const freeByBldg = useMemo(() => {
    const m = new Map();
    for (const r of scored) if (r.st.free && r.mins >= main.minFree) m.set(r.bldg, (m.get(r.bldg) || 0) + 1);
    return m;
  }, [scored, main.minFree]);

  useEffect(() => {
    if (data && overlay.room && !data.rooms.some((r) => r.code === overlay.room)) closeOverlay();
  }, [data, overlay.room]);

  const pickBuilding = (code) => {
    remember(code);
    update({ bldg: code });
    closeOverlay();
    scrollTo({ top: 0 });
  };

  if (err) return <Center>데이터를 불러오지 못했어요.</Center>;
  if (!data) return <Center>강의실 불러오는 중…</Center>;

  const detail = overlay.room ? scored.find((r) => r.code === overlay.room) : null;
  const whenLabel = main.at || notice ? `${DAY_LABEL[day]} ${fmt(t)}` : "지금";

  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <RoomsView
        data={data}
        buildings={buildings}
        bldg={bldg}
        scored={scored}
        freeByBldg={freeByBldg}
        main={main}
        day={day}
        t={t}
        notice={notice}
        whenLabel={whenLabel}
        update={update}
        setDay={setDay}
        setT={setT}
        onPickBuilding={() => openOverlay({ room: null, picker: true })}
        onDetail={(code) => openOverlay({ room: code, picker: false })}
      />
      {overlay.picker && (
        <BuildingSheet
          buildings={buildings}
          bldg={bldg}
          freeByBldg={freeByBldg}
          totalFree={[...freeByBldg.values()].reduce((a, b) => a + b, 0)}
          whenLabel={whenLabel}
          onPick={pickBuilding}
          onClose={closeOverlay}
        />
      )}
      {detail && <DetailSheet room={detail} day={day} t={t} whenLabel={whenLabel} onClose={closeOverlay} />}
    </div>
  );
}

function RoomsView({ data, buildings, bldg, scored, freeByBldg, main, day, t, notice, whenLabel, update, setDay, setT, onPickBuilding, onDetail }) {
  const allScope = bldg === ALL;
  const bldgName = allScope ? "전체 캠퍼스" : buildings.find((b) => b.code === bldg)?.name;
  const inScope = useMemo(() => scored.filter((r) => allScope || r.bldg === bldg), [scored, allScope, bldg]);
  const visible = useMemo(
    () => inScope.filter((r) => (r.st.free ? r.mins >= main.minFree : main.showBusy)),
    [inScope, main.minFree, main.showBusy]
  );
  const freeCount = visible.filter((r) => r.st.free).length;
  const groups = useMemo(
    () => groupRooms(visible, { sort: main.sort, allScope, freeByBldg }),
    [visible, main.sort, allScope, freeByBldg]
  );

  return (
    <>
      <header className="px-5 pt-6 sm:px-8">
        <div className="flex items-center justify-between gap-3">
          <p className="serif text-sm italic text-pine">DJGongsil</p>
          <DataLabel data={data} />
        </div>
        <button
          onClick={onPickBuilding}
          aria-haspopup="dialog"
          className="press mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-raised py-1.5 pr-3 pl-4 text-sm font-semibold text-ink"
        >
          {bldgName}
          <span aria-hidden className="text-xs text-muted">▼</span>
          <span className="sr-only">건물 바꾸기</span>
        </button>
        <h1 className="serif mt-3 text-[2rem] leading-tight font-medium text-ink">
          {whenLabel} 빈 강의실 <span className="tnum text-pine">{freeCount}곳</span>
        </h1>
      </header>

      <div className="sticky top-0 z-20 mt-3 bg-paper/95 px-5 pt-2 pb-3 backdrop-blur sm:px-8">
        <WhenPicker at={main.at} day={day} t={t} setDay={setDay} setT={setT} onNow={() => update({ at: null })} />
      </div>

      <div className="px-5 pb-16 sm:px-8">
        <Segmented
          label="빈 시간"
          options={MIN_FREE.map((x) => ({ value: x.m, label: x.label }))}
          value={main.minFree}
          onChange={(m) => update({ minFree: m })}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            onClick={() => update({ showBusy: !main.showBusy })}
            aria-pressed={main.showBusy}
            className={`press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              main.showBusy ? "border-pine bg-pine-soft text-pine" : "border-line bg-raised text-muted"
            }`}
          >
            수업 중인 방도
          </button>
          <label className="inline-flex items-center gap-1 text-xs text-muted">
            <span className="sr-only">정렬</span>
            <select
              value={main.sort}
              onChange={(e) => update({ sort: e.target.value })}
              className="rounded-full border border-line bg-raised py-1.5 pr-2 pl-3 text-xs font-semibold text-ink outline-none focus:border-pine"
            >
              {SORTS.map((s) => (
                <option key={s.k} value={s.k}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {notice && (
          <p role="status" className="mt-4 rounded-xl border border-line bg-raised px-4 py-3 text-sm text-ink-2">
            {NOTICE[notice]}
          </p>
        )}

        {visible.length === 0 ? (
          <EmptyState
            minFree={main.minFree}
            allScope={allScope}
            onClearMin={() => update({ minFree: 0 })}
            onAll={() => update({ bldg: ALL })}
          />
        ) : (
          <div className="mt-4 space-y-5">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label || "강의실"}>
                {g.label && (
                  <h2 className="mb-1.5 flex items-baseline justify-between px-1 text-xs font-semibold text-muted">
                    <span>{g.label}</span>
                    <span className="tnum font-normal">빈 곳 {g.rooms.filter((r) => r.st.free).length}</span>
                  </h2>
                )}
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
                  {g.rooms.map((r) => (
                    <li key={r.code}>
                      <RoomRow room={r} showBldg={allScope && main.sort !== "place"} onClick={() => onDetail(r.code)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-xs leading-relaxed text-muted">
          정규 수업 시간표 기준이에요.
          <br />
          예약·행사·출입 제한은 현장에서 확인해 주세요.
        </p>
      </div>
    </>
  );
}

function DataLabel({ data }) {
  if (data.sample) return <p className="text-[11px] text-clay">샘플 데이터</p>;
  const [, mo, d] = (data.updated || "").split("-").map(Number);
  return (
    <p className="text-[11px] text-muted">
      {data.year}학기 시간표{mo ? ` · ${mo}월 ${d}일 수집` : ""}
    </p>
  );
}

function WhenPicker({ at, day, t, setDay, setT, onNow }) {
  return (
    <div className="rounded-2xl border border-line bg-raised p-3">
      <div className="flex items-center gap-1.5">
        <button
          onClick={onNow}
          aria-pressed={!at}
          className={`press h-8 shrink-0 rounded-lg px-2.5 text-sm font-semibold transition ${
            !at ? "bg-pine text-paper" : "border border-pine/40 text-pine"
          }`}
        >
          지금
        </button>
        {DAYS.map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            aria-pressed={day === d}
            aria-label={DAY_LABEL[d]}
            className={`press h-8 flex-1 rounded-lg text-sm font-semibold transition ${
              day === d ? (at ? "bg-pine text-paper" : "bg-pine-soft text-pine") : "text-muted"
            }`}
          >
            {d}
          </button>
        ))}
        <span className="serif tnum ml-1 w-12 shrink-0 text-right text-lg text-pine">{fmt(t)}</span>
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
          aria-label="시간"
          aria-valuetext={fmt(t)}
          onChange={(e) => setT(Number(e.target.value))}
        />
        <span className="tnum text-[10px] text-muted">23:00</span>
      </div>
      <div className="mt-2 grid grid-cols-6 gap-1">
        {PERIODS.map((p) => {
          const active = at && t === p.t;
          return (
            <button
              key={p.label}
              onClick={() => setT(p.t)}
              aria-pressed={!!active}
              aria-label={`${p.label} ${fmt(p.t)}`}
              className={`press rounded-md py-1 text-[11px] leading-tight transition ${
                active ? "bg-pine-soft font-semibold text-pine" : "text-muted"
              }`}
            >
              <span className="tnum block">{fmt(p.t)}</span>
              <span className="block text-[10px]">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Segmented({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex items-center rounded-full border border-line bg-raised p-0.5">
      <span className="px-3 text-xs text-muted">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`flex-1 rounded-full py-1.5 text-xs font-semibold transition ${
            value === o.value ? "bg-pine text-paper" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function groupRooms(rooms, { sort, allScope, freeByBldg }) {
  if (sort !== "place") {
    const free = (a, b) => (a.st.free === b.st.free ? 0 : a.st.free ? -1 : 1);
    const cmp =
      sort === "capacity"
        ? (a, b) => free(a, b) || (b.capacity || 0) - (a.capacity || 0) || byHo(a, b)
        : (a, b) => free(a, b) || a.idle - b.idle || b.mins - a.mins || (a.st.until || 0) - (b.st.until || 0) || byHo(a, b);
    return [{ key: "flat", label: null, rooms: [...rooms].sort(cmp) }];
  }
  const keyOf = allScope ? (r) => r.bldg : (r) => r.floor ?? 99;
  const m = new Map();
  for (const r of rooms) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  const groups = [...m.entries()].map(([k, rs]) => ({
    key: String(k),
    order: k,
    label: allScope ? rs[0].bldgName : floorLabel(rs[0].floor),
    rooms: rs.sort(byHo),
  }));
  return groups.sort(
    allScope
      ? (a, b) => (freeByBldg.get(b.order) || 0) - (freeByBldg.get(a.order) || 0) || a.label.localeCompare(b.label, "ko")
      : (a, b) => a.order - b.order
  );
}

function RoomRow({ room, showBldg, onClick }) {
  const { st, mins } = room;
  const soon = st.free && mins < 60;
  let primary;
  let sub = null;
  if (!st.free) {
    primary = <span className="text-muted">{fmt(st.until)}부터 빔</span>;
    sub = <span className="text-clay">수업 중</span>;
  } else if (st.until == null) {
    primary = <span className="text-pine">{st.classesToday ? "남은 수업 없음" : "종일 비어요"}</span>;
  } else {
    primary = <span className={soon ? "text-clay" : "text-pine"}>{fmt(st.until)}까지</span>;
    sub = <span className="tnum">{span(mins)}</span>;
  }
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-paper-2/40 ${st.free ? "" : "bg-paper-2/30"}`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 shrink-0 rounded-full ${!st.free ? "bg-line-2" : soon ? "bg-clay" : "bg-pine"}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`tnum shrink-0 font-semibold ${st.free ? "text-ink" : "text-muted"}`}>{room.ho}</span>
          <span className="truncate text-xs text-muted">
            {room.roomType || "강의실"}
            {room.capacity ? ` · ${room.capacity}석` : ""}
          </span>
        </span>
        {(showBldg || room.idle) && (
          <span className="mt-0.5 block truncate text-[11px] text-muted">
            {showBldg ? room.bldgName : ""}
            {showBldg && room.idle ? " · " : ""}
            {room.idle ? "정규 수업 없음" : ""}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-sm font-medium">
        {primary}
        {sub && <span className="block text-[11px] font-normal text-muted">{sub}</span>}
      </span>
    </button>
  );
}

function EmptyState({ minFree, allScope, onClearMin, onAll }) {
  return (
    <div className="mt-14 text-center">
      <p className="serif text-lg italic text-muted">조건에 맞는 빈 강의실이 없어요.</p>
      <div className="mt-4 flex justify-center gap-2">
        {minFree > 0 && (
          <button onClick={onClearMin} className="press rounded-full border border-pine px-4 py-2 text-sm font-semibold text-pine">
            빈 시간 조건 풀기
          </button>
        )}
        {!allScope && (
          <button onClick={onAll} className="press rounded-full border border-pine px-4 py-2 text-sm font-semibold text-pine">
            전체 캠퍼스에서 보기
          </button>
        )}
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  const titleId = useId();
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !panel.current) return;
      const items = panel.current.querySelectorAll("button, input, select, a[href]");
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !panel.current.contains(at) || at === panel.current)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (at === last || !panel.current.contains(at))) {
        e.preventDefault();
        first?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="backdrop-in absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="sheet-up relative mx-auto max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-paper px-6 pt-3 pb-10 outline-none"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-2" />
        <div className="flex items-start justify-between gap-3">
          <div id={titleId} className="min-w-0">
            {title}
          </div>
          <button onClick={onClose} aria-label="닫기" className="press -mr-1 p-1 text-2xl leading-none text-muted">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BuildingSheet({ buildings, bldg, freeByBldg, totalFree, whenLabel, onPick, onClose }) {
  const [q, setQ] = useState("");
  const last = remembered();
  const list = useMemo(() => {
    const count = (b) => freeByBldg.get(b.code) || 0;
    return buildings
      .filter((b) => !q || `${b.name} ${b.alias || ""}`.includes(q.trim()))
      .sort((a, b) => (b.code === last) - (a.code === last) || count(b) - count(a) || a.name.localeCompare(b.name, "ko"));
  }, [buildings, q, freeByBldg, last]);

  return (
    <Sheet
      onClose={onClose}
      title={
        <>
          <h2 className="serif text-2xl font-medium text-ink">어느 건물에서 찾을까요?</h2>
          <p className="mt-1 text-sm text-muted">{whenLabel} 기준 빈 강의실 수</p>
        </>
      }
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="건물 이름 검색"
        aria-label="건물 이름 검색"
        className="mt-4 w-full rounded-xl border border-line bg-raised px-4 py-3 text-sm text-ink outline-none focus:border-pine"
      />
      <ul className="mt-3 space-y-2">
        {!q && (
          <li>
            <BldgRow name="전체 캠퍼스" count={totalFree} active={bldg === ALL} onClick={() => onPick(ALL)} />
          </li>
        )}
        {list.map((b) => (
          <li key={b.code}>
            <BldgRow
              name={b.name}
              alias={b.alias}
              count={freeByBldg.get(b.code) || 0}
              recent={b.code === last}
              active={b.code === bldg}
              onClick={() => onPick(b.code)}
            />
          </li>
        ))}
      </ul>
      {list.length === 0 && <p className="serif mt-8 text-center italic text-muted">검색 결과가 없어요.</p>}
    </Sheet>
  );
}

function BldgRow({ name, alias, count, recent, active, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`press flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
        active ? "border-pine bg-pine-soft" : "border-line bg-raised"
      }`}
    >
      <span className="flex items-center gap-2 font-semibold text-ink">
        {name}
        {alias && <span className="text-xs font-normal text-muted">{alias}</span>}
        {recent && <span className="rounded bg-pine-soft px-1.5 py-0.5 text-[10px] font-semibold text-pine">최근</span>}
      </span>
      <span className="text-sm text-muted">
        빈 곳 <span className="tnum font-bold text-pine">{count}</span>
      </span>
    </button>
  );
}

function DetailSheet({ room, day, t, whenLabel, onClose }) {
  const { st } = room;
  const todays = room.sessions
    .filter((s) => s.day === day)
    .sort((a, b) => toMin(a.start) - toMin(b.start));
  const usage = room.usageWeekday?.[day];
  let headline;
  if (!st.free) headline = `${whenLabel} 수업 중이에요 · ${fmt(st.until)}부터 비어요`;
  else if (st.until != null) headline = `${whenLabel}부터 ${fmt(st.until)}까지 비어요`;
  else if (st.classesToday) headline = `${whenLabel} 이후로 남은 수업이 없어요`;
  else headline = `${DAY_LABEL[day]}에는 수업이 없어요`;

  return (
    <Sheet
      onClose={onClose}
      title={
        <>
          <h2 className="tnum text-2xl font-bold text-ink">{room.ho}</h2>
          <p className="mt-1 text-sm text-muted">
            {room.bldgName} · {room.roomType || "강의실"}
            {room.capacity ? ` · ${room.capacity}석` : ""}
          </p>
        </>
      }
    >
      <div
        className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${
          st.free ? "border-pine/30 bg-pine-soft text-pine" : "border-clay/30 bg-clay/10 text-clay"
        }`}
      >
        {headline}
        {!st.free && <span className="mt-0.5 block font-normal text-ink-2">{st.current.course}</span>}
      </div>
      {room.idle && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          이번 학기 정규 수업이 없는 방이에요. 문이 잠겨 있을 수 있어요.
        </p>
      )}

      <div className="mt-5 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-ink">{DAY_LABEL[day]} 시간표</h3>
        {usage != null && <p className="tnum text-xs text-muted">주간 사용률 {usage}%</p>}
      </div>
      <DayTimeline sessions={todays} t={t} />
      <ul className="mt-3 space-y-1.5">
        {todays.length === 0 ? (
          <li className="serif py-3 text-center italic text-muted">수업이 없어요</li>
        ) : (
          todays.map((s, i) => {
            const on = toMin(s.start) <= t && t < toMin(s.end);
            return (
              <li key={i} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${on ? "bg-clay/10" : "bg-raised"}`}>
                <span className="tnum w-24 shrink-0 text-xs text-muted">
                  {s.start}~{s.end}
                </span>
                <span className="truncate text-sm text-ink">
                  {s.course}
                  {s.prof && <span className="text-muted"> · {s.prof}</span>}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </Sheet>
  );
}

function DayTimeline({ sessions, t }) {
  const pct = (m) => ((clampT(m) - OPEN) / (CLOSE - OPEN)) * 100;
  const busy = sessions.map((s) => `${s.start}~${s.end}`).join(", ");
  return (
    <div className="mt-2" role="img" aria-label={busy ? `수업 시간 ${busy}` : "수업 없음"}>
      <div className="relative h-6 overflow-hidden rounded-md bg-pine-soft">
        {sessions.map((s, i) => (
          <div
            key={i}
            className="absolute inset-y-0 border-x border-raised bg-clay/30"
            style={{ left: `${pct(toMin(s.start))}%`, width: `${pct(toMin(s.end)) - pct(toMin(s.start))}%` }}
          />
        ))}
        <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${pct(t)}%` }} />
      </div>
      <div aria-hidden className="relative mt-1 h-3">
        {[9, 12, 15, 18, 21].map((h) => (
          <span
            key={h}
            className="tnum absolute -translate-x-1/2 text-[10px] text-muted"
            style={{ left: `${pct(h * 60)}%` }}
          >
            {h}시
          </span>
        ))}
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
