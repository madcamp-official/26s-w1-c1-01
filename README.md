# NomadList — 여행 비용 3D 글로브


![메인화면](img/메인화면.gif)


혼자 여행을 떠나고 싶은 사람을 위해, 인천(ICN) 출발 기준 여행지별 예상 비용(식비·숙박·항공권)과
환율, 외교부 해외안전여행 경보를 3D 지구본 위에서 한눈에 보여주는 웹 서비스.

## 공통과제 I : 웹 기반 프로젝트 (2인 1팀)

**목적:** 공통 과제를 함께 수행하며 웹 개발의 전체 흐름을 빠르게 익히고 협업에 적응하기

**결과물:** 기획부터 배포까지 완료된 웹 서비스와 관련 문서 일체

---

## 팀원

<div align="center">

<table>
  <tr>
    <td align="center">
      <img src="img/Nupjuk.jpg" width="120" height="120" alt="유영석" style="border-radius:50%; object-fit:cover;" /><br />
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

</div>

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

## IA 및 화면 설계서

### 정보구조도 (IA)

- 홈 → 검색 → 국가 개요 → 도시 핀 지도 → 도시 요약 팝업 → 상세 정보 → 지도 복귀
- 홈 → 추천 → 퀴즈 → 추천 결과 → 도시 요약 팝업 (위 흐름과 합류)

### 화면 설계서

**1. 홈 화면**

![홈 화면](img/ia/1_홈화면.png)

검색창 + 랜덤 도시 / 추천 버튼 + 지도 위 도시 핀 배치

**2. 국가 검색 (일본)**

![국가 검색](img/ia/2_국가검색.png)

국가명으로 검색하면 지도 중심에 국가명 라벨 표시

**3. 도시 핀 지도**

![도시 핀 지도](img/ia/3_도시핀지도.png)

지도를 확대하면 국가 내 도시들이 핀으로 표시됨

**4. 도시 요약 팝업 (도쿄)**

![도시 요약 팝업 도쿄](img/ia/4_도시요약팝업_도쿄.png)

핀 클릭 시 항공편 / 숙소비 / 식비 / 여행경보단계 요약 표시

**5. 도시 상세 정보 (도쿄)**

![도시 상세 정보 도쿄](img/ia/5_도시상세정보_도쿄.png)

"자세한 정보" 클릭 시 인구 / 면적 / 환율 / 생필품 가격 추가 표시

**6. 지도 복귀**

![지도 복귀](img/ia/6_지도복귀.png)

상세 정보를 닫고 지도로 복귀, 검색어는 선택했던 도시명(도쿄)으로 갱신

**7. 추천 퀴즈**

![추천 퀴즈](img/ia/7_추천퀴즈.png)

"추천" 버튼 클릭 시 여행경비 중요도(항공권 / 식사 / 숙소) 선택 퀴즈

**8. 추천 결과**

![추천 결과](img/ia/8_추천결과.png)

선택한 기준에 맞는 도시 3곳 추천 (예: 뉴욕 / 도쿄 / 런던)

**9. 도시 요약 팝업 (모스크바, 여행경보 예시)**

![도시 요약 팝업 모스크바](img/ia/9_도시요약팝업_모스크바.png)

동일한 팝업 컴포넌트가 여행경보단계 3단계 도시에서 재사용되는 예시

---

## 시연 영상

<video src="img/시연영상.mp4" controls width="100%"></video>

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

<div align="center">

| 영역 | 언어 |
|---|---|
| Frontend | TypeScript (React) |
| Backend | JavaScript (Node.js / Express) |
| Data Pipeline | Python |
| DB | PostgreSQL (Supabase) |

</div>

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

<div align="center">

| 변수 | 설명 |
|---|---|
| `PORT` | Express 포트 (기본 4000) |
| `DATABASE_URL` | Supabase Postgres 연결 문자열 |
| `FRONTEND_ORIGIN` | CORS 허용 origin (콤마로 다중 지정 가능) |
| `PYTHON_BIN` | `POST /cities/:id/update`가 실행할 python 실행 파일 |
| `DATA_PIPELINE_DIR` | data-pipeline 디렉토리 경로 (미설정 시 `../data-pipeline`) |

</div>

**frontend/.env**

<div align="center">

| 변수 | 설명 |
|---|---|
| `VITE_API_BASE_URL` | backend 주소. 미설정 시 목업 데이터로 동작 |

</div>

**data-pipeline/.env**

<div align="center">

| 변수 | 설명 |
|---|---|
| `EXIM_AUTH_KEY` | 한국수출입은행 환율 오픈API 인증키 |
| `MOFA_TRAVEL_ALARM_KEY` | 공공데이터포털 외교부 해외안전여행경보 API 인증키 |
| `SUPABASE_DB_URL` | Supabase Postgres 연결 문자열 (backend의 `DATABASE_URL`과 동일 값) |

</div>

---

## API 문서

Base URL: `http://localhost:4000`

<div align="center">

| Method | Endpoint | 설명 | 응답 |
|---|---|---|---|
| GET | `/health` | 헬스체크 | `{ status: "ok" }` |
| GET | `/countries` | 국가 목록 (환율/여행경보/빅맥지수 포함) | `Country[]` |
| GET | `/cities` | 국제공항 보유 도시 목록 (식비/항공권/숙박 최저가 포함) | `City[]` |
| POST | `/cities/:cityId/update` | 특정 도시 데이터 갱신 트리거 (fire-and-forget) | `202` / `404` / `429` |

</div>

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

<div align="center">

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `currency_code` | `CHAR(3)` PK | ISO 4217 |
| `currency_name` | `VARCHAR(50)` | 통화명 |
| `unit` | `INTEGER` | 고시 단위 (JPY/IDR 등은 100) |
| `exchange_rate` | `NUMERIC(14,4)` | `unit`당 KRW 매매기준율 |
| `base_date` | `DATE` | 고시 기준일 |
| `updated_at` | `TIMESTAMPTZ` | 갱신 시각 |

</div>

### countries

<div align="center">

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

</div>

### cities

<div align="center">

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

</div>

### flight_price_scrapes / stay_price_scrapes

스크래핑 원본 로그. `cities`의 최저가 캐시는 이 로그의 최신값을 배치가 뽑아 덮어쓴 값이다.

<div align="center">

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | `BIGSERIAL` PK | |
| `city_id` | `CHAR(3)` FK → `cities` | |
| `scrape_date` | `DATE` | 배치 실행일 |
| `depart_date`/`checkin`, `return_date`/`checkout` | `DATE` | 검색 조건 |
| `price` | `INTEGER` | 실패 시 NULL |
| `airline` / `source_url` | `VARCHAR` / `TEXT` | 최저가 항공사, 예약 링크 |
| `scraped_at` | `TIMESTAMPTZ` | |

</div>

---

## 배포 결과물


- **서비스 URL:** [http://nomadlist.madcamp-kaist.org/](https://nomadlist.madcamp-kaist.org/)
- **실행 방법:** [시작하기](#시작하기) 참고 (`./run_docker.sh`)

---

## 회고 문서


### Keep
- 지구본을 활용한 서비스를 만들기를 잘한 것 같다; 직관적이면서도 원하는 기능들을 구현하기 좋았다!
- 아이디어를 팀원 둘의 공통 관심사로 선정해서 더 재밌게 개발할 수 있었다.

### Problem
- 처음 쓰는 KCloud 서비스를 사용하느라 첫 서버 세팅 작업이 살짝 오래 걸렸다.
- 처음에는 도시의 수를 더 늘리고 싶었지만, 렌더링 문제 및 동기화할 정보 소스가 부족해서 줄였다. 

### Try
- 다음 프로젝트에서도 개발자의 관심사를 고려해서 계획하면 좋을 것 같다.
- 유료 API도 활용해서 더 다양한 정보를 제공해주고 싶다.

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
