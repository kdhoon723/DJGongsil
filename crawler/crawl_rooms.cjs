//--(2026-06-14)
// 대진대 포털 강의실별 시간표 종합 크롤러 (재활용 목적 = 가능한 모든 정보 수집)
// 흐름: 홈페이지 SSO 로그인 -> LinkPortal 포털 진입 -> 전체 건물 인벤토리
//      -> 건물별 강의실 인벤토리 -> 강의실마다 Crownix 리포트 렌더텍스트 수집/파싱
// 수집: 건물(코드/명), 강의실(코드/호수/유형), 세션(과목명/교수/과목번호/분반/요일/시간/수강인원), 방별 원본텍스트
// 실행: NODE_PATH=.../autoTicket/node_modules \
//       DREAMS_ID=학번 DREAMS_PW=비번 BLDG=01,03 node crawl_rooms.cjs   (BLDG=ALL 이면 전체 건물)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const YEAR = "20261"; // 2026년도 1학기
const ID = process.env.DREAMS_ID || "";
const PW = process.env.DREAMS_PW || "";
const BLDG_ARG = process.env.BLDG || "01";
const OUT = path.join(__dirname, "..", "data", "extracted");

const LOGIN_URL =
  "https://www.daejin.ac.kr/daejin/1045/subview.do?enc=Zm5jdDF8QEB8JTJGc3ViTG9naW4lMkZkYWVqaW4lMkZ2aWV3LmRvJTNG";
const PORTAL = "https://dreams2.daejin.ac.kr/sugang/LinkPortal.jsp?dvd=P";
const FORM = "https://dreams2.daejin.ac.kr/sugang/center/Blsn011301.jsp";
const REPORT = (room) =>
  "https://dreams2.daejin.ac.kr/sugang/commonRd7Prt.jsp?path=https://dreams2.daejin.ac.kr/dreamsprint/" +
  "&mrdname=d_blsn_time_t_room.mrd&mode00=&mode01=2026&mode02=1&mode03=" +
  room +
  "&mode04=P&mode05=&mode06=&mode07=&mode08=&mode09=";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByPlaceholder("학번(교번)").waitFor({ timeout: 15000 });
  await page.getByPlaceholder("학번(교번)").fill(ID);
  await page.getByPlaceholder("비밀번호").fill(PW);
  // 메뉴에도 "로그인"이 있어 폼 영역(#_UlgnS_basic)으로 한정
  await page
    .locator("#_UlgnS_basic")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  const ok = page.getByRole("button", { name: "확인" }); // 6개월 비번미변경 안내
  await ok.first().waitFor({ timeout: 12000 }).catch(() => {});
  if (await ok.count().catch(() => 0)) {
    await ok.first().click().catch(() => {});
  }
  for (let i = 0; i < 4; i++) {
    await page
      .goto(PORTAL, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => {});
    if (/MyPageFr/.test(page.url())) return true;
    await sleep(1000);
  }
  return /MyPageFr/.test(page.url());
}

// 건물/강의실 select 옵션 읽기
async function getBuildings(page) {
  await page.goto(FORM, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("select[name=bldg_cd]", { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => {
    const b = document.querySelector("select[name=bldg_cd]");
    return b
      ? [...b.options]
          .map((o) => ({ code: o.value, name: o.text.trim() }))
          .filter((o) => o.code && o.code !== "건물명 선택")
      : [];
  });
}

async function getRooms(page, bldg) {
  await page.goto(FORM, { waitUntil: "domcontentloaded", timeout: 30000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.evaluate(
      ({ y, b }) => {
        const f = document.myform;
        f.selectYear.value = y;
        f.bldg_cd.value = b;
        f.room_cd.value = "";
        f.action = "/sugang/center/Blsn011301.jsp";
        f.target = "";
        f.submit();
      },
      { y: YEAR, b: bldg }
    ),
  ]);
  // 강의실 목록이 채워질 때까지 대기
  await page
    .waitForFunction(
      () => {
        const r = document.querySelector("select[name=room_cd]");
        return r && r.options.length > 1;
      },
      { timeout: 10000 }
    )
    .catch(() => {});
  return page.evaluate(() => {
    const r = document.querySelector("select[name=room_cd]");
    if (!r) return [];
    return [...r.options]
      .map((o) => ({ code: o.value, name: o.text.trim() }))
      .filter((o) => o.code && o.code !== "강의실 선택");
  });
}

// "인105 - 토론형 강의실" -> { ho:"인105", roomType:"토론형 강의실" }
function parseRoomName(name) {
  const m = name.split(/\s*-\s*/);
  return { ho: (m[0] || "").trim(), roomType: (m.slice(1).join("-") || "").trim() };
}

// 리포트 렌더텍스트 -> 세션 배열 (가능한 모든 필드)
function parseSchedule(text) {
  // 예) "[학]한국전쟁사 최한진 교수 (922504-01) 화09:30~11:30 수강인원: 50명"
  const re =
    /([^()\n]*?)\((\d{5,6})-(\d{2})\)\s*([월화수목금토일])\s*(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})\s*(?:수강인원:\s*(\d+)\s*명)?/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    let lab = m[1].replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    let prof = "";
    const pm = lab.match(/([가-힣]{2,5})\s*교수\s*$/);
    if (pm) {
      prof = pm[1];
      lab = lab.slice(0, pm.index).trim();
    }
    out.push({
      course: lab,
      prof,
      curiNo: m[2],
      clssNo: m[3],
      day: m[4],
      start: `${m[5].padStart(2, "0")}:${m[6]}`,
      end: `${m[7].padStart(2, "0")}:${m[8]}`,
      enroll: m[9] ? Number(m[9]) : null,
    });
  }
  return out;
}

async function getRoomReport(page, code) {
  // Crownix 뷰어는 연결을 계속 열어둬 networkidle이 안 끝남 -> domcontentloaded + 렌더대기
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(REPORT(code), {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
    } catch (e) {
      /* commit은 됐을 수 있으니 렌더 대기로 진행 */
    }
    const rendered = await page
      .waitForFunction(
        () => /출력일자/.test(document.body.innerText || ""),
        { timeout: 12000 }
      )
      .then(() => true)
      .catch(() => false);
    if (rendered) {
      await sleep(700); // 셀(SVG) 렌더 안정화
      const text = await page.evaluate(() => document.body.innerText || "");
      return { raw: text, sessions: parseSchedule(text) };
    }
  }
  return { raw: "", sessions: [] };
}

const isOnline = (name) => /e-learning|온라인/.test(name);
// 강의실류만 리포트 조회(연구실/사무실 등은 스킵 = 시간 절약). 건물 인벤토리엔 전부 남음.
const shouldFetch = (name) =>
  !isOnline(name) &&
  !/교수연구실|연구실|사무실|과제도서실|회의실|상담실|준비실|인권센터|행정|학과사무/.test(name);
// 비학술 건물(기숙사/철거/운동장 등)은 통째로 스킵 = 큰 시간 절약
const BLDG_SKIP =
  /철거|기숙사|운동장|스탠드|경비|총장공관|파워플랜트|학군단|쑤저우|하얼빈|야외|예비군/;

(async () => {
  if (!ID || !PW) throw new Error("DREAMS_ID/DREAMS_PW env 필요");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PW_EXEC || undefined,
  });
  const ctx = await browser.newContext();
  ctx.on("page", (p) => p.on("dialog", (d) => d.accept().catch(() => {})));
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept().catch(() => {}));

  console.log("[*] 로그인...");
  if (!(await login(page))) throw new Error("로그인/포털진입 실패");
  console.log("[*] 포털 진입:", page.url());

  // 전체 건물 인벤토리 저장
  const buildings = await getBuildings(page);
  fs.writeFileSync(
    path.join(OUT, "buildings.json"),
    JSON.stringify({ year: YEAR, buildings }, null, 2)
  );
  console.log(`[*] 건물 ${buildings.length}개 인벤토리 저장`);

  const targets =
    BLDG_ARG.toUpperCase() === "ALL"
      ? buildings.map((b) => b.code)
      : BLDG_ARG.split(",").map((s) => s.trim());

  const all = [];
  const flat = []; // 재활용용 마스터 테이블 (세션 1건 = 1행)
  for (const code of targets) {
    const bName = (buildings.find((b) => b.code === code) || {}).name || code;
    if (BLDG_SKIP.test(bName)) {
      console.log(`[건물 ${code} ${bName}] 스킵(비학술)`);
      continue;
    }
    const rooms = await getRooms(page, code);
    console.log(`[건물 ${code} ${bName}] 방 ${rooms.length}개`);
    const bldgData = { bldg: code, bldgName: bName, year: YEAR, rooms: [] };
    for (const room of rooms) {
      const { ho, roomType } = parseRoomName(room.name);
      const online = isOnline(room.name);
      let rep = { raw: "", sessions: [] };
      if (shouldFetch(room.name)) {
        try {
          rep = await getRoomReport(page, room.code);
        } catch (e) {
          console.log(`   ! ${room.name} 실패: ${e.message}`);
        }
      }
      const rec = {
        code: room.code,
        name: room.name,
        ho,
        roomType,
        online,
        sessionCount: rep.sessions.length,
        sessions: rep.sessions,
        raw: rep.raw,
      };
      bldgData.rooms.push(rec);
      for (const s of rep.sessions) {
        flat.push({
          bldg: code,
          bldgName: bName,
          roomCode: room.code,
          ho,
          roomType,
          ...s,
        });
      }
      console.log(`   ${room.name}: ${rep.sessions.length}세션`);
      await sleep(120);
    }
    all.push(bldgData);
    fs.writeFileSync(
      path.join(OUT, `rooms_${code}.json`),
      JSON.stringify(bldgData, null, 2)
    );
  }
  fs.writeFileSync(path.join(OUT, "rooms_all.json"), JSON.stringify(all, null, 2));
  fs.writeFileSync(
    path.join(OUT, "sessions_flat.json"),
    JSON.stringify(flat, null, 2)
  );
  console.log(
    `[완료] 건물 ${all.length} / 방 ${all.flatMap((b) => b.rooms).length} / 세션 ${flat.length}`
  );
  await browser.close();
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
