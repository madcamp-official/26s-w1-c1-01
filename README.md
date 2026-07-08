# NomadList — 여행 비용 3D 글로브

혼자 여행을 떠나고 싶은 사람을 위해, 인천(ICN) 출발 기준 여행지별 예상 비용(식비·숙박·항공권)과
환율, 외교부 해외안전여행 경보를 3D 지구본 위에서 한눈에 보여주는 웹 서비스.

## 공통과제 I : 웹 기반 프로젝트 (2인 1팀)

**목적:** 공통 과제를 함께 수행하며 웹 개발의 전체 흐름을 빠르게 익히고 협업에 적응하기

**결과물:** 기획부터 배포까지 완료된 웹 서비스와 관련 문서 일체

---

## 팀원

| 이름 | GitHub | 역할 |
|---|---|---|
| 유영석 | github.com/yskstuff | 개발자 |
| 유나연 | github.com/yxxnxyxxn | 개발자 |

---

## 기획안

- **주제:** 여행 비용 정보 사이트
- **목적:** 전세계 도시를 혼자 여행 가는 데 드는 비용을 직관적으로 보여줌
- **핵심 기능:** 여행지별 1인 식비 + 숙박비 + 항공편 비용 최저가 계산 및 비교
- **예상 사용자:** 빠른 시일 내에 혼자 여행을 떠나고 싶은 사람

---

## 기능 명세서

### 필수 기능

- [x] 지구본 위에 국제공항이 있는 도시들 핀으로 표시 (`react-globe.gl`)
- [x] 도시별 최저가 1인 식비, 숙박비, 항공편 비용 계산
- [x] 도시별 최소 여행비용 구간 기준 핀 색깔 구분 (`frontend/src/utils/pinColor.ts`)
- [x] 외교부 여행경보 발령단계 정보 해당 도시(국가)별 표시

### 선택 기능

- [x] 도시/국가 이름 기반 검색 (`SearchBar`, Fuse.js 퍼지 검색)
- [x] 식비·숙박비·항공권 비용 선호도 기반 추천 퀴즈 (`RecommendQuiz`)
- [x] 무작위 도시 보여주는 버튼 (`utils/random.ts`)
- [x] 빅맥지수 기반 국가 물가 비교 (`CountryDetailPanel`)
- [ ] 도시별 관광지 사진/정보 표시 (현재 `picsum.photos` 플레이스홀더)

---

## 아키텍처

모노레포 3파트 + Supabase(PostgreSQL) 구성.

```
┌────────────┐   GET /cities, /countries    ┌────────────┐        ┌──────────────┐
│  frontend  │ ────────────────────────────▶│   backend   │───────▶│   Supabase   │
│ React+Vite │   POST /cities/:id/update     │  Express    │  pg    │  (Postgres)  │
│ (nginx:80) │◀──────────────────────────────│  (:4000)    │◀───────│              │
└────────────┘                               └─────┬───────┘        └──────▲───────┘
                                                     │ spawn                │
                                                     ▼                       │
                                              ┌─────────────┐               │
                                              │ data-pipeline│──────────────┘
                                              │ main_batch.py│  psycopg2
                                              │ (Python)     │
                                              └─────────────┘
```

- **frontend**: 지구본 UI. 백엔드에서 받은 도시/국가 데이터를 시각화하고, 사용자가 요청하면
  `POST /cities/:cityId/update`로 해당 도시 데이터 갱신을 트리거한다.
- **backend**: `GET /countries`, `GET /cities`만 제공하는 얇은 조회 API. 갱신 요청이 오면
  Python 배치(`main_batch.py`)를 자식 프로세스로 실행한다.
- **data-pipeline**: 환율·항공권·숙박·여행경보를 실제로 수집(스크래핑/공공 API)해서
  Supabase에 반영하는 배치. 크론으로 전체 배치를, 백엔드 요청으로 단일 도시 배치를 돌릴 수 있다.
- **Docker**: `backend` + `data-pipeline`은 파일시스템을 공유해야 자식 프로세스 spawn이
  그대로 동작하므로 하나의 이미지로 합쳐져 있다(루트 `Dockerfile`). `frontend`는 별도로
  빌드되어 nginx 컨테이너로 뜬다.

---

## 폴더 구조

```
.
├── backend/                 Express API 서버
│   └── src/
│       ├── app.js           라우터 등록, CORS, 404/에러 핸들러
│       ├── server.js        진입점
│       ├── db.js            pg Pool (Supabase 연결)
│       ├── routes/          countries.js, cities.js
│       └── services/        cityBatchRunner.js (배치 spawn + 쿨다운)
│
├── frontend/                React 3D 글로브 앱
│   └── src/
│       ├── components/      GlobeView, SearchBar, PricePanel, CityDetailPanel,
│       │                    CountryDetailPanel, RecommendQuiz, HelpPanel
│       ├── queries/         TanStack Query 훅 + fetcher(api.ts)
│       ├── store/           zustand 전역 상태(useAppStore)
│       ├── utils/           검색/추천/가격등급/카메라 프레이밍 등 순수 로직
│       ├── data/            mockData.ts(백엔드 미연결 시 폴백), worldCountries.ts(국경 GeoJSON)
│       └── types.ts         City/Country 공유 타입
│
├── data-pipeline/           수집/배치 파이프라인 (Python)
│   ├── main_batch.py        배치 진입점 (전체 실행 / 단일 도시 실행)
│   ├── run_batch.sh         cron용 wrapper (전체 배치, 매시간)
│   ├── scrapers/            exchange_scrapers, flight_scraper, stay_scraper,
│   │                        travel_alarm_scraper (Playwright 기반 실시간 수집)
│   ├── collectors/          build_currencies/countries/cities/flights/stay/
│   │                        travel_alarm, sync_city_prices (CSV/DataFrame → DB 반영)
│   └── data/
│       ├── raw/             원본 소스 CSV(공항, GDP-PLI, 빅맥지수 등)
│       ├── processed/       스크래핑/가공 결과 CSV
│       └── README.md        DB 스키마 상세 문서 (ERD + DDL)
│
├── Dockerfile                backend + data-pipeline 통합 이미지
├── docker-compose.yml         backend + frontend 오케스트레이션
├── run_docker.sh               docker compose wrapper 스크립트
└── requirements.txt             data-pipeline Python 의존성
```

---

## 기술 스택

| 영역 | 스택 |
|---|---|
| Frontend | React 19, TypeScript, Vite, [react-globe.gl](https://github.com/vasturiano/react-globe.gl) (Three.js 기반 3D 지구본), Zustand, TanStack Query, Fuse.js, Tailwind CSS |
| Backend | Node.js, Express, node-postgres(`pg`), express-rate-limit |
| Data Pipeline | Python, Playwright(+stealth), pandas, psycopg2, requests |
| DB / Infra | Supabase(PostgreSQL), Docker / docker-compose, nginx(frontend 서빙) |
| 외부 데이터 소스 | 한국수출입은행 환율 오픈API, 공공데이터포털 외교부 해외안전여행경보 API, 네이버 항공권(flight.naver.com) / 네이버 호텔(hotels.naver.com) 스크래핑, World Bank ICP PLI, The Economist Big Mac Index, OpenFlights/공항코드집(국제공항 도시 필터링) |

---

## 시작하기

### 1) 로컬에서 각 파트 따로 실행

**backend**
```bash
cd backend
cp .env.example .env   # DATABASE_URL 등 채우기
npm install
npm run dev            # http://localhost:4000
```

**frontend**
```bash
cd frontend
cp .env.example .env   # VITE_API_BASE_URL 설정 (미설정 시 목업 데이터로 동작)
npm install
npm run dev            # http://localhost:5173
```

**data-pipeline**
```bash
cd data-pipeline
python3 -m venv venv && source venv/bin/activate
pip install -r ../requirements.txt
playwright install --with-deps chromium
cp .env.example .env   # EXIM_AUTH_KEY, MOFA_TRAVEL_ALARM_KEY, SUPABASE_DB_URL

python3 main_batch.py            # 전체 배치(환율/항공권/숙박/여행경보) 1회 실행
python3 main_batch.py ICN        # 특정 도시(IATA 코드)만 갱신
```
운영 환경에서는 `run_batch.sh`를 크론에 등록해 전체 배치를 주기 실행한다.

### 2) Docker Compose로 한 번에 실행

```bash
cp backend/.env.example backend/.env
cp data-pipeline/.env.example data-pipeline/.env
# 위 두 .env에 실제 값(DATABASE_URL/SUPABASE_DB_URL, API 키 등) 채우기

./run_docker.sh          # 포그라운드 (로그 바로 보임)
./run_docker.sh -d        # 백그라운드 + 로그 tail
```
- frontend: http://localhost:5173
- backend: http://localhost:4000 (헬스체크: `GET /health`)

---

## 환경 변수

**backend/.env**

| 변수 | 설명 |
|---|---|
| `PORT` | Express 포트 (기본 4000) |
| `DATABASE_URL` | Supabase Postgres 연결 문자열 |
| `FRONTEND_ORIGIN` | CORS 허용 origin (콤마로 다중 지정 가능) |
| `PYTHON_BIN` | `POST /cities/:id/update`가 실행할 python 실행 파일 |
| `DATA_PIPELINE_DIR` | data-pipeline 디렉토리 경로 (미설정 시 `../data-pipeline`) |

**frontend/.env**

| 변수 | 설명 |
|---|---|
| `VITE_API_BASE_URL` | backend 주소. 미설정 시 `src/data/mockData.ts` 목업 데이터로 동작 |

**data-pipeline/.env**

| 변수 | 설명 |
|---|---|
| `EXIM_AUTH_KEY` | 한국수출입은행 환율 오픈API 인증키 |
| `MOFA_TRAVEL_ALARM_KEY` | data.go.kr 외교부 해외안전여행경보 API 인증키 |
| `SUPABASE_DB_URL` | Supabase Postgres 연결 문자열 (backend의 `DATABASE_URL`과 동일 값) |

---

## API 문서

Base URL: `backend/.env`의 `PORT` 기준 (`http://localhost:4000`)

| Method | Endpoint | 설명 | 요청 | 응답 |
|---|---|---|---|---|
| GET | `/health` | 헬스체크 | - | `{ status: "ok" }` |
| GET | `/countries` | 국가 목록 (환율/여행경보/빅맥지수 포함) | - | `Country[]` |
| GET | `/cities` | 국제공항 보유 도시 목록 (식비/항공권/숙박 최저가 포함) | - | `City[]` |
| POST | `/cities/:cityId/update` | 특정 도시 데이터 갱신 트리거 (fire-and-forget, 202 즉시 응답) | path: `cityId` (IATA 코드) | `202 { accepted, cityId, skipped? }` / `404` (없는 도시) / `429` (레이트리밋) |

**`Country` 응답 필드**: `countryId, nameKo, nameEn, center{lat,lng}, alarmLevel(0~4), specialAdvisory, currencyCode, exchangeRate, unit, bigMac`

**`City` 응답 필드**: `cityId, nameKo, nameEn, countryId, iata, lat, lng, mealPrice, flightPrice, stayPrice, updatedAt`

**`POST /cities/:cityId/update` 동작 방식**
- IP당 10분에 20회 레이트리밋(`express-rate-limit`).
- 동일 도시는 10분 쿨다운 + 실행 중 중복 요청 스킵(`services/cityBatchRunner.js`).
- 백엔드가 `python main_batch.py <cityId>`를 자식 프로세스로 실행 → 성공 시 다음 `GET /cities` 응답에 반영.

---

## DB 스키마

Supabase(PostgreSQL) 4개 테이블. 상세 컬럼 정의·제약조건·DDL 전문은
[`data-pipeline/data/README.md`](data-pipeline/data/README.md) 참고.

```
currencies (1) ──< countries (N) ──< cities (N) ──< flight_price_scrapes (N)
                                                └──< stay_price_scrapes (N)
```

- **currencies**: 통화 코드(ISO 4217) 단위 환율 마스터. 한국수출입은행 API로 매 배치 upsert.
- **countries**: 국가 메타 + 여행경보 단계/특이사항 + 빅맥지수. `currencies`를 FK로 참조.
- **cities**: 국제공항 보유 도시 메타 + 식비(임시 PLI 지수)/항공권/숙박 최저가 캐시.
- **flight_price_scrapes / stay_price_scrapes**: 스크래핑 원본 로그. `cities`의 최저가 캐시는
  이 로그에서 배치가 뽑아 덮어쓴 값.

---

## 데이터 파이프라인

`data-pipeline/main_batch.py`가 아래 순서로 스크래핑 → DB 반영을 수행한다.

1. **환율**: `exchange_scrapers.py`(한국수출입은행 API → `exchange.csv`) → `build_currencies.py`(upsert)
2. **항공권**: `flight_scraper.py`(네이버 항공권, Playwright 병렬 스크래핑) → `build_flights.py`
3. **숙박**: `stay_scraper.py`(네이버 호텔, Playwright) → `build_stay.py`
4. **가격 캐시 동기화**: `sync_city_prices.py`가 2/3의 최신 로그에서 최저가를 뽑아 `cities`에 반영
5. **여행경보**: `travel_alarm_scraper.py`(공공데이터포털 외교부 API) → `build_travel_alarm.py`

한 단계가 실패해도 나머지 단계는 계속 진행한다. `python main_batch.py <city_id>`로 실행하면
환율(도시 단위 아님)을 제외한 2~5단계만 해당 도시로 스코프를 좁혀 실행하며, 이 경로가
백엔드의 `POST /cities/:cityId/update`가 실제로 호출하는 경로다.

그 외 일회성/시드 스크립트: `build_countries.py`, `build_cities.py`(국가·도시 마스터 데이터 조립),
`merge_airport_db.py` · `filter_gdp_by_airport.py`(OpenFlights/공항코드집/World Bank PLI를
병합해 국제공항 보유 도시만 필터링), `build_big_mac.py`(Big Mac Index → KRW 환산).

---

## 배포 결과물

> 접속 가능한 링크는 배포 후 이 섹션에 채워 넣는다.

- **서비스 URL:** _(배포 후 작성)_
- **실행 방법:** [시작하기](#시작하기) 참고 (`./run_docker.sh`)

---

## 회고 문서

> 개발 과정에서의 어려움, 해결 방법, 역할 분담, 다음에 개선할 점 (KPT 방법론 참고)

### Keep

### Problem

### Try

---

## 참고 자료

- [SDD(스펙 주도 개발) 이해하기](https://news.hada.io/topic?id=21338)
- [Software Design Document Best Practices](https://www.atlassian.com/work-management/project-management/design-document)
- [IA 정보구조도 작성 방법](https://brunch.co.kr/@nyonyo/7)
- [기획자 화면설계서 작성법](https://brunch.co.kr/@soup/10)
- [Figma 와이어프레임 가이드](https://www.figma.com/ko-kr/resource-library/what-is-wireframing/)
- [무료 Figma 와이어프레임 키트](https://www.figma.com/ko-kr/templates/wireframe-kits/)
- [ERD/DB 설계 총정리](https://inpa.tistory.com/entry/DB-%F0%9F%93%9A-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EB%AA%A8%EB%8D%B8%EB%A7%81-%EA%B0%9C%EB%85%90-ERD-%EB%8B%A4%EC%9D%B4%EC%96%B4%EA%B7%B8%EB%9E%A8)
- [API 명세서 작성 가이드라인](https://velog.io/@sebinChu/BackEnd-API-%EB%AA%85%EC%84%B8%EC%84%9C-%EC%9E%91%EC%84%B1-%EA%B0%80%EC%9D%B4%EB%93%9C-%EB%9D%BC%EC%9D%B8)
- [좋은 README 작성하는 방법](https://velog.io/@sabo/good-readme)
- [단기 프로젝트 회고 KPT 방법론](https://velog.io/@habwa/%EB%8B%A8%EA%B8%B0-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%9A%8C%EA%B3%A0-KPT-%EB%B0%A9%EB%B2%95%EB%A1%A0)
