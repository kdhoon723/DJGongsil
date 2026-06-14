# DJGongsil · 대진대 빈 강의실 찾기

> "지금 어디서 자습하지?" — 대진대학교에서 **현재 비어있는 강의실**을 요일·시간대별로 찾아주는 웹앱.

공강이나 시험기간에 빈 강의실을 찾아 헤맨 경험에서 출발했습니다. 학교 포털의 *강의실별 시간표*는 강의실을 하나씩 눌러봐야 해서 "지금 비어있는 곳"을 한눈에 볼 수 없었어요. DJGongsil은 전 강의실의 시간표를 모아 **점유의 여집합(= 빈 강의실)** 을 계산해 보여줍니다.

## 어떻게 동작하나

세 단계 파이프라인입니다.

```
포털 강의실별 시간표 ──(Playwright 렌더)──▶ 렌더 텍스트
        └─ Crownix 리포트(클라이언트 암호화)            │
                                          (정규식 파싱)  ▼
빈 강의실 계산 ◀──(React)── 정적 JSON ◀──── 과목·요일·시간·수용인원·사용률
```

1. **수집 `crawler/crawl_rooms.cjs`** — 대진대 포털(DREAMS2)의 *강의실별 시간표 조회*를 **본인 로그인 세션**으로 열람합니다. 이 페이지는 Crownix 리포트 뷰어라서 데이터 요청(`mrd_param`)이 클라이언트에서 암호화되어 나갑니다. 즉 순수 HTTP(curl)로는 데이터를 못 받고, **헤드리스 브라우저로 리포트를 실제 렌더한 뒤 텍스트를 긁어야** 합니다. 그래서 Playwright를 씁니다.
2. **전처리 `crawler/parse_rooms.py`** — 렌더 텍스트를 줄 단위로 파싱해 세션(과목·교수·과목번호·분반·요일·시간·수강인원)과 강의실 메타(수용인원·요일별/종합 사용률)를 뽑아 정적 JSON으로 만듭니다.
3. **앱 `app/`** — 그 JSON만 불러오는 React SPA. 선택한 (요일, 시각)에 대해 각 강의실의 점유를 계산해 **빈 강의실을 건물별로** 보여줍니다. **런타임 백엔드가 없습니다.**

## 기술 스택

| 영역 | 사용 |
|------|------|
| 프론트엔드 | React 19 · Vite 6 · Tailwind CSS v4 |
| 데이터 수집 | Node · Playwright (헤드리스 Chromium) |
| 전처리 | Python 3 |
| 호스팅 | Cloudflare Pages (정적 SPA) |

## 폴더 구조

```
DJGongsil/
├── app/                  # React 웹앱 (Vite)
│   ├── public/data.json  # 배포되는 강의실 데이터셋
│   └── src/              # App.jsx, index.css …
├── crawler/
│   ├── crawl_rooms.cjs   # 포털 → 강의실별 리포트 수집 (Playwright)
│   └── parse_rooms.py    # 렌더 텍스트 → 정제 JSON
└── data/extracted/       # 수집·전처리 산출물 (app_data.json 등)
```

## 실행 방법

### 1) 데이터 수집

자격증명은 **환경변수로만** 주입합니다 (코드/저장소에 비밀번호를 넣지 않습니다).

```bash
cd crawler
npm install            # playwright 설치
npx playwright install chromium

# 전체 학술 건물의 강의실 시간표 수집  (기숙사/운동장 등은 자동 제외)
DREAMS_ID=학번 DREAMS_PW=비밀번호 BLDG=ALL node crawl_rooms.cjs

# 렌더 텍스트 → 앱용 JSON
python3 parse_rooms.py
cp ../data/extracted/app_data.json ../app/public/data.json
```

`BLDG`에 `01,03,A7` 처럼 건물 코드를 콤마로 주면 특정 건물만 수집합니다.

### 2) 앱 개발 / 빌드

```bash
cd app
npm install
npm run dev      # 개발 서버
npm run build    # 정적 빌드 → app/dist
```

## 배포 (Cloudflare Pages)

정적 SPA라 `app/dist`를 그대로 올리면 됩니다.

- **Git 연동**: 이 저장소를 Cloudflare Pages에 연결 → Root `app`, Build `npm run build`, Output `dist`. push 시 자동 배포.
- **직접 업로드**: `cd app && npm run build && npx wrangler pages deploy dist`

## 데이터 · 프라이버시

- **본인의 정당한 포털 로그인 세션**으로 열람 가능한 *강의실 점유(시간표)* 데이터만 수집합니다. 타인 정보·개인정보는 다루지 않습니다.
- 자격증명은 환경변수(`DREAMS_ID`/`DREAMS_PW`)로 주입하며 저장소에 포함하지 않습니다.
- 빈 강의실은 **정규 수업이 없는 시간**일 뿐, 실제 이용 가능 여부(예약·잠금)는 현장에서 확인하세요.

## 면책

대진대학교 공식 서비스가 아닌 개인 프로젝트입니다.
