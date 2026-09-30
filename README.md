# DJGongsil

대진대학교 강의실 시간표를 바탕으로 선택한 요일과 시각에 비어 있는 강의실을 찾는 정적 웹앱입니다. 강의실별 시간표를 하나씩 확인하는 대신, 빈 강의실 수와 다음 수업까지 남은 시간을 건물별로 비교할 수 있습니다.

## 무엇을 보여주나

1. 지금 시각으로 바로 조회하거나 평일과 시간을 직접 선택합니다.
2. 전체 캠퍼스 또는 건물별 빈 강의실 수를 확인합니다.
3. 빈 시간 길이, 강의실 수용인원, 시간표 상세를 보고 장소를 고릅니다.

조회 결과는 빈 시간 길이, 수용인원, 강의실 이름 순으로 정렬할 수 있습니다. 필요하면 수업 중인 강의실도 함께 표시합니다.

## 해결 방식

```text
대진대 포털 강의실별 시간표
        │ Playwright로 Crownix 리포트 렌더링
        ▼
강의실별 렌더 텍스트
        │ Python으로 과목·요일·시간·수용인원·사용률 파싱
        ▼
정적 JSON
        │ React에서 선택 시각과 수업 구간 비교
        ▼
건물별 빈 강의실과 다음 수업까지 남은 시간
```

- **브라우저 기반 수집**: 포털의 강의실별 시간표가 Crownix 리포트로 렌더링되므로 `crawler/crawl_rooms.cjs`가 로그인 세션에서 화면을 열고 텍스트를 추출합니다.
- **수집과 파싱 분리**: `crawler/parse_rooms.py`가 저장된 원문을 다시 읽어 세션과 강의실 메타데이터를 만듭니다. 파싱 규칙을 고칠 때 포털을 다시 조회하지 않아도 됩니다.
- **구간 기반 판정**: 프론트엔드는 선택 시각이 수업의 시작·종료 구간에 포함되는지 계산합니다. 비어 있다면 다음 수업 시작 시각까지의 길이도 구합니다.
- **런타임 백엔드 없는 배포**: React 앱은 정적 JSON만 읽으므로 정적 호스팅에 배포할 수 있습니다.

## 주요 구성

| 영역 | 역할 | 구현 |
| --- | --- | --- |
| `app/` | 시간·건물 선택, 빈 강의실 판정과 표시 | React 19, Vite 6, Tailwind CSS v4 |
| `crawler/crawl_rooms.cjs` | 포털 로그인, 건물·강의실 목록과 리포트 수집 | Node.js, Playwright |
| `crawler/parse_rooms.py` | 렌더 텍스트를 앱용 JSON으로 변환 | Python 3 |

## 공개 데이터와 현재 범위

이 저장소는 실제 포털에서 수집한 `app/public/data.json`과 `data/extracted/*`를 포함하지 않습니다. 대신 화면과 빌드를 확인할 수 있는 익명 샘플 `app/public/data.sample.json`을 제공합니다.

앱은 `data.json`을 먼저 읽고, 파일이 없으면 `data.sample.json`을 사용합니다. 따라서 저장소를 그대로 실행하면 실제 강의실 현황이 아닌 샘플관·예시관 데이터가 표시됩니다.

수집 코드는 현재 **2026학년도 1학기**에 맞춰져 있습니다. 다른 학기를 수집하려면 다음 값을 함께 바꿔야 합니다.

- `crawler/crawl_rooms.cjs`의 `YEAR`
- 같은 파일의 Crownix `REPORT` URL에 있는 연도·학기 파라미터
- `crawler/parse_rooms.py`가 결과 JSON에 기록하는 `year`

포털 화면이나 리포트 형식이 바뀌면 수집·파싱 규칙도 조정해야 할 수 있습니다. 또한 여기서 말하는 빈 강의실은 **정규 수업이 없는 공간**입니다. 예약, 행사, 출입 제한 등 실제 이용 가능 여부는 현장에서 확인해야 합니다. DJGongsil은 대진대학교 공식 서비스가 아닙니다.

## 로컬 실행

샘플 데이터로 웹앱을 실행합니다.

```bash
cd app
npm install
npm run dev
```

정적 빌드는 다음 명령으로 만듭니다.

```bash
cd app
npm run build
```

## 데이터 수집과 전처리

자격증명은 환경변수로만 주입합니다. 코드나 저장소에 학번과 비밀번호를 넣지 마세요. 시간표 데이터는 본인이 정당하게 열람할 수 있는 범위에서만 수집하고 학교 정책과 관련 약관을 따라야 합니다.

```bash
cd crawler
npm install
npx playwright install chromium

# 전체 학술 건물 수집
DREAMS_ID=학번 DREAMS_PW=비밀번호 BLDG=ALL node crawl_rooms.cjs

# 렌더 텍스트를 앱용 JSON으로 변환
python3 parse_rooms.py
cp ../data/extracted/app_data.json ../app/public/data.json
```

`BLDG=01,03,A7`처럼 건물 코드를 콤마로 구분하면 일부 건물만 수집합니다. 생성되는 실제 데이터와 자격증명 파일은 `.gitignore`로 제외합니다.

## 배포

`app/dist`를 정적 호스팅에 배포합니다.

- Cloudflare Pages Git 연동: Root `app`, Build command `npm run build`, Output directory `dist`
- 직접 업로드: `cd app && npm run build && npx wrangler pages deploy dist`

운영 배포에서 실제 데이터를 쓰려면 배포 전에 `app/public/data.json`을 별도로 생성하거나 호스팅 환경에서 안전하게 주입해야 합니다.

## 저장소 구조

```text
DJGongsil/
├── app/
│   ├── public/data.sample.json  # 공개용 익명 샘플
│   └── src/                     # React 앱
├── crawler/
│   ├── crawl_rooms.cjs          # 포털 리포트 수집
│   ├── parse_rooms.py           # 렌더 텍스트 전처리
│   └── .env.example             # 환경변수 예시
└── LICENSE
```

## 라이선스

MIT License. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
