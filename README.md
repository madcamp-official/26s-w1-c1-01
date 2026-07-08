# NomadList — 여행 비용 3D 글로브

혼자 여행을 떠나고 싶은 사람을 위해, 인천(ICN) 출발 기준 여행지별 예상 비용(식비·숙박·항공권)과
환율, 외교부 해외안전여행 경보를 3D 지구본 위에서 한눈에 보여주는 웹 서비스.

## 공통과제 I : 웹 기반 프로젝트 (2인 1팀)

**목적:** 공통 과제를 함께 수행하며 웹 개발의 전체 흐름을 빠르게 익히고 협업에 적응하기

**결과물:** 기획부터 배포까지 완료된 웹 서비스와 관련 문서 일체

---

## 팀원

<table>
  <tr>
    <td align="center">
      <img src="img/유영석.png" width="120" height="120" alt="유영석" style="border-radius:50%; object-fit:cover;" /><br />
      <b>유영석</b><br />
      <a href="https://github.com/yskstuff">@yskstuff</a><br />
      개발자
    </td>
    <td align="center">
      <img src="img/유나연.jpeg" width="120" height="120" alt="유나연" style="border-radius:50%; object-fit:cover;" /><br />
      <b>유나연</b><br />
      <a href="https://github.com/yxxnxyxxn">@yxxnxyxxn</a><br />
      개발자
    </td>
  </tr>
</table>

---

## 기획안

- **주제:** 여행 비용 정보 사이트
- **목적:** 전세계 도시를 혼자 여행 가는 데 드는 비용을 직관적으로 보여줌
- **핵심 기능:** 여행지별 1인 식비 + 숙박비 + 항공편 비용 최저가 계산 및 비교
- **예상 사용자:** 빠른 시일 내에 혼자 여행을 떠나고 싶은 사람

---

## 기능 명세서

### 필수 기능

- [x] 지구본 위에 국제공항이 있는 도시들 핀으로 표시
- [x] 도시별 최저가 1인 식비, 숙박비, 항공편 비용 계산
- [x] 도시별 최소 여행비용 구간 기준 핀 색깔 구분
- [x] 외교부 여행경보 발령단계 정보 해당 도시(국가)별 표시

### 선택 기능

- [x] 도시/국가 이름 기반 검색
- [x] 식비·숙박비·항공권 비용 선호도 기반 추천 퀴즈
- [x] 무작위 도시 보여주는 버튼
- [x] 빅맥지수 기반 국가 물가 비교
- [x] 도시별 관광지 사진/정보 표시

---

## 시연 영상

<!-- TODO: 시연 영상 삽입 -->

---

## 아키텍처

모노레포 3파트(frontend / backend / data-pipeline) + Supabase(PostgreSQL) 구성.

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

- **frontend**: 지구본 UI 렌더링, 도시/국가 데이터 시각화, 도시 갱신 요청 트리거
- **backend**: `GET /countries`, `GET /cities` 조회 API + 갱신 요청 시 Python 배치 실행
- **data-pipeline**: 환율·항공권·숙박·여행경보 수집 후 Supabase에 반영
- **Docker**: `backend`와 `data-pipeline`은 자식 프로세스 spawn 구조상 한 이미지로 통합, `frontend`는 별도 nginx 컨테이너

---

## 폴더 구조

```
.
├── backend/          Express API 서버 (routes, services, db)
├── frontend/          React 3D 글로브 앱 (components, queries, store, utils)
├── data-pipeline/      수집/배치 파이프라인 (scrapers, collectors, main_batch.py)
├── Dockerfile          backend + data-pipeline 통합 이미지
├── docker-compose.yml   backend + frontend 오케스트레이션
└── run_docker.sh         docker compose wrapper 스크립트
```

---

## 기술 스택

| 영역 | 언어 |
|---|---|
| Frontend | TypeScript (React) |
| Backend | JavaScript (Node.js / Express) |
| Data Pipeline | Python |
| DB | PostgreSQL (Supabase) |

---

## 시작하기

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
| `VITE_API_BASE_URL` | backend 주소. 미설정 시 목업 데이터로 동작 |

**data-pipeline/.env**

| 변수 | 설명 |
|---|---|
| `EXIM_AUTH_KEY` | 한국수출입은행 환율 오픈API 인증키 |
| `MOFA_TRAVEL_ALARM_KEY` | 공공데이터포털 외교부 해외안전여행경보 API 인증키 |
| `SUPABASE_DB_URL` | Supabase Postgres 연결 문자열 (backend의 `DATABASE_URL`과 동일 값) |

---

## API 문서

Base URL: `http://localhost:4000`

| Method | Endpoint | 설명 | 응답 |
|---|---|---|---|
| GET | `/health` | 헬스체크 | `{ status: "ok" }` |
| GET | `/countries` | 국가 목록 (환율/여행경보/빅맥지수 포함) | `Country[]` |
| GET | `/cities` | 국제공항 보유 도시 목록 (식비/항공권/숙박 최저가 포함) | `City[]` |
| POST | `/cities/:cityId/update` | 특정 도시 데이터 갱신 트리거 (fire-and-forget) | `202` / `404` / `429` |

**Country**: `countryId, nameKo, nameEn, center{lat,lng}, alarmLevel(0~4), specialAdvisory, currencyCode, exchangeRate, unit, bigMac`

**City**: `cityId, nameKo, nameEn, countryId, iata, lat, lng, mealPrice, flightPrice, stayPrice, updatedAt`

`POST /cities/:cityId/update`는 IP당 10분 20회 레이트리밋 + 도시별 10분 쿨다운이 적용되며,
백엔드가 `python main_batch.py <cityId>`를 자식 프로세스로 실행해 결과를 다음 `GET /cities`에 반영한다.

---

## DB 스키마

### ERD

```
currencies (1) ──< countries (N) ──< cities (N) ──< flight_price_scrapes (N)
                                                └──< stay_price_scrapes (N)
```

### currencies

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `currency_code` | `CHAR(3)` PK | ISO 4217 |
| `currency_name` | `VARCHAR(50)` | 통화명 |
| `unit` | `INTEGER` | 고시 단위 (JPY/IDR 등은 100) |
| `exchange_rate` | `NUMERIC(14,4)` | `unit`당 KRW 매매기준율 |
| `base_date` | `DATE` | 고시 기준일 |
| `updated_at` | `TIMESTAMPTZ` | 갱신 시각 |

### countries

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `country_id` | `CHAR(2)` PK | ISO 3166-1 alpha-2 |
| `name_ko` / `name_en` | `VARCHAR(100)` | 국가명 |
| `center_lat` / `center_lng` | `NUMERIC` | 지도 카메라 연출용 |
| `currency_code` | `CHAR(3)` FK → `currencies` | |
| `iso3` | `CHAR(3)` UNIQUE | ISO 3166-1 alpha-3 (여행경보 API 매핑용) |
| `alarm_level` | `SMALLINT` (0~4) | 외교부 해외안전여행 알람 |
| `special_advisory` | `VARCHAR(255)` | 특별여행주의보 등, 없으면 NULL |
| `big_mac_price` | `INTEGER` | KRW 환산 빅맥지수 |
| `updated_at` | `TIMESTAMPTZ` | 갱신 시각 |

### cities

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `city_id` | `CHAR(3)` PK | IATA 코드 |
| `name_ko` / `name_en` | `VARCHAR(100)` | 도시명 |
| `country_id` | `CHAR(2)` FK → `countries` | |
| `lat` / `lng` | `NUMERIC` | 실좌표 |
| `meal_price` | `INTEGER` | 1인 1일 식비 (현재는 PLI 지수 임시 대입) |
| `flight_price` | `INTEGER` | KRW, ICN 왕복 최저가 |
| `stay_price` | `INTEGER` | KRW, 7박 총액 |
| `updated_at` | `TIMESTAMPTZ` | 갱신 시각 |

### flight_price_scrapes / stay_price_scrapes

스크래핑 원본 로그. `cities`의 최저가 캐시는 이 로그의 최신값을 배치가 뽑아 덮어쓴 값이다.

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | `BIGSERIAL` PK | |
| `city_id` | `CHAR(3)` FK → `cities` | |
| `scrape_date` | `DATE` | 배치 실행일 |
| `depart_date`/`checkin`, `return_date`/`checkout` | `DATE` | 검색 조건 |
| `price` | `INTEGER` | 실패 시 NULL |
| `airline` / `source_url` | `VARCHAR` / `TEXT` | 최저가 항공사, 예약 링크 |
| `scraped_at` | `TIMESTAMPTZ` | |

---

## 배포 결과물

> 접속 가능한 링크는 배포 후 이 섹션에 채워 넣는다.

- **서비스 URL:** [http://www.nomadlist.madcamp-kaist.org/](https://nomadlist.madcamp-kaist.org/)
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
