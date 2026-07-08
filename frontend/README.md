# NomadList — 여행 비용 3D 글로브

인천발 여행지의 예상 비용(식비·숙박·항공)과 환율, 외교부 여행경보 등을 3D 지구본 위에서
바로 확인하는 웹 앱. 도시/국가 검색, 예산 기반 추천 퀴즈, 랜덤 여행지 추천을 제공한다.

이 디렉토리는 모노레포의 `frontend` 파트다. 나머지 두 파트:
- `backend` — 도시/국가 데이터 API (`GET /cities`, `GET /countries`)
- `data-pipeline` — 항공권·숙박·환율·여행경보 등 실데이터 수집/정제 배치

## 스택

- React 19 + TypeScript + Vite
- [react-globe.gl](https://github.com/vasturiano/react-globe.gl) — 3D 지구본, 위성 타일, 국경선, 핀 오버레이
- Zustand — 선택 도시/국가, 패널 상태
- TanStack Query — 서버 데이터 캐싱 계층(현재는 목업 데이터를 감싼 fetcher, 실제 API로 교체 예정)
- Fuse.js — 국가/도시 이름 퍼지 검색
- Tailwind CSS — 스타일링

## 시작하기

```bash
npm install
npm run dev       # 개발 서버 (기본 포트 5173)
npm run build     # 타입체크 + 프로덕션 빌드
npm run lint      # oxlint
```

## 폴더 구조

```
src/
  components/   GlobeView, SearchBar, PricePanel, CityDetailPanel, RecommendQuiz 등 UI
  data/         목업 데이터(mockData.ts), 국경 GeoJSON 로더(worldCountries.ts)
  queries/      TanStack Query 훅과 fetcher(api.ts) — 백엔드 연동 시 이 계층만 교체
  store/        zustand 전역 상태
  utils/        검색/추천/가격 등급/국가 카메라 프레이밍 등 순수 로직
  types.ts      City/Country 등 공유 타입
```

## 백엔드 연동 시 참고

- `src/queries/api.ts`의 `fetchCities`/`fetchCountries`만 실제 API 호출로 교체하면 된다.
- `City`/`Country` 타입(`src/types.ts`)이 API 응답 스키마의 기준이다.
- `center`/`fitAltitude`(국가 카메라 프레이밍)는 프런트엔드가 국경 GeoJSON에서 직접
  계산하는 UI 전용 값이라(`src/utils/countryFraming.ts`) 백엔드가 내려줄 필요는 없다.
