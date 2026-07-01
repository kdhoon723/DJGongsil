# DJGongsil · 대진대 빈 강의실 찾기

> “지금 어디서 자습하지?” — 대진대학교 강의실 시간표를 바탕으로 **요일·시간대별 빈 강의실**을 찾아주는 정적 웹앱.

공강이나 시험기간에 빈 강의실을 찾아 헤맨 경험에서 출발했습니다. 학교 포털의 *강의실별 시간표*는 강의실을 하나씩 열어봐야 해서 “지금 비어있는 곳”을 한눈에 보기 어렵습니다. DJGongsil은 강의실별 점유 시간을 모아 **점유의 여집합(= 빈 강의실)** 을 계산하고, 건물별로 빠르게 탐색할 수 있게 보여줍니다.

## 주요 기능

- **지금/요일/시간대 기준 검색**: 현재 시각 또는 선택한 수업 시간대에 비어 있는 강의실을 확인합니다.
- **건물별 탐색**: 건물별 빈 강의실 수를 먼저 보고 원하는 건물을 좁혀 들어갑니다.
- **빈 시간 길이 표시**: 다음 수업 전까지 얼마나 비어 있는지 함께 보여줍니다.
- **정적 SPA**: 앱은 JSON 파일만 읽는 React 정적 사이트이며 런타임 백엔드가 없습니다.
- **재현 가능한 파이프라인**: Playwright 수집기와 Python 파서를 분리해 데이터 갱신 과정을 명확히 했습니다.

## 데모 데이터 정책

이 공개 저장소에는 실제 포털에서 수집한 `app/public/data.json`을 포함하지 않습니다. 대신 UI와 빌드를 확인할 수 있도록 익명화된 `app/public/data.sample.json`만 포함합니다.

- 실제 수집 산출물(`app/public/data.json`, `data/extracted/*`)은 로컬/배포 환경에서만 생성·관리하세요.
- 앱은 `data.json`이 있으면 실제 데이터를 우선 사용하고, 없으면 `data.sample.json`으로 fallback합니다.
- 시간표 데이터는 본인이 정당하게 열람할 수 있는 범위에서만 수집해야 하며, 학교 정책과 관련 약관을 준수해야 합니다.

## 어떻게 동작하나

세 단계 파이프라인입니다.

```text
포털 강의실별 시간표 ──(Playwright 렌더)──▶ 렌더 텍스트
        └─ Crownix 리포트(클라이언트 암호화)            │
                                          (정규식 파싱)  ▼
빈 강의실 계산 ◀──(React)── 정적 JSON ◀──── 과목·요일·시간·수용인원·사용률
```

1. **수집 `crawler/crawl_rooms.cjs`** — 대진대 포털(DREAMS2)의 *강의실별 시간표 조회*를 본인 로그인 세션으로 열람합니다. 해당 화면은 Crownix 리포트 뷰어라 데이터 요청 파라미터가 클라이언트에서 암호화되어 나가므로, 단순 HTTP 요청 대신 Playwright로 브라우저를 실제 렌더링한 뒤 텍스트를 추출합니다.
2. **전처리 `crawler/parse_rooms.py`** — 렌더 텍스트를 줄 단위로 파싱해 세션(과목·과목번호·분반·요일·시간·수강인원)과 강의실 메타(수용인원·요일별/종합 사용률)를 정적 JSON으로 만듭니다.
3. **앱 `app/`** — JSON을 불러오는 React SPA입니다. 선택한 (요일, 시각)에 대해 각 강의실의 점유 여부를 계산해 빈 강의실을 건물별로 보여줍니다.

## 기술 스택

| 영역 | 사용 |
| --- | --- |
| 프론트엔드 | React 19 · Vite 6 · Tailwind CSS v4 |
| 데이터 수집 | Node.js · Playwright |
| 전처리 | Python 3 |
| 호스팅 | Cloudflare Pages 등 정적 호스팅 |

## 폴더 구조

```text
DJGongsil/
├── app/                         # React 웹앱 (Vite)
│   ├── public/data.sample.json   # 공개 저장소용 익명 샘플 데이터
│   └── src/                      # App.jsx, index.css …
├── crawler/
│   ├── crawl_rooms.cjs           # 포털 → 강의실별 리포트 수집 (Playwright)
│   ├── parse_rooms.py            # 렌더 텍스트 → 정제 JSON
│   └── .env.example              # 환경변수 예시
└── LICENSE
```

로컬에서 실제 수집을 실행하면 `data/extracted/`와 `app/public/data.json`이 생성될 수 있습니다. 이 파일들은 공개 저장소에 커밋하지 않습니다.

## 실행 방법

### 1) 웹앱 개발 / 빌드

```bash
cd app
npm install
npm run dev      # 개발 서버
npm run build    # 정적 빌드 → app/dist
```

`app/public/data.json`이 없으면 샘플 데이터로 실행됩니다.

### 2) 데이터 수집과 전처리

자격증명은 **환경변수로만** 주입합니다. 코드나 저장소에 학번/비밀번호를 넣지 마세요.

```bash
cd crawler
npm install
npx playwright install chromium

# 전체 학술 건물의 강의실 시간표 수집
DREAMS_ID=학번 DREAMS_PW=비밀번호 BLDG=ALL node crawl_rooms.cjs

# 렌더 텍스트 → 앱용 JSON
python3 parse_rooms.py
cp ../data/extracted/app_data.json ../app/public/data.json
```

`BLDG`에 `01,03,A7`처럼 건물 코드를 콤마로 주면 특정 건물만 수집합니다.

## 배포

정적 SPA라 `app/dist`를 그대로 배포하면 됩니다.

- **Cloudflare Pages Git 연동**: Root `app`, Build command `npm run build`, Output directory `dist`
- **직접 업로드**: `cd app && npm run build && npx wrangler pages deploy dist`

운영 배포에서 실제 데이터를 쓰려면 배포 전에 `app/public/data.json`을 별도로 생성하거나, 호스팅 환경에서 안전하게 주입하세요.

## 보안 · 프라이버시 · 면책

- 이 저장소에는 포털 자격증명과 실제 수집 데이터를 포함하지 않습니다.
- `.env`, `.env.*`, `app/public/data.json`, 빌드 산출물은 git에서 제외합니다.
- 빈 강의실은 “정규 수업이 없는 시간”을 뜻할 뿐, 실제 이용 가능 여부(예약·잠금·행사)는 현장에서 확인해야 합니다.
- 대진대학교 공식 서비스가 아닌 개인 프로젝트입니다.

## 라이선스

MIT License. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
