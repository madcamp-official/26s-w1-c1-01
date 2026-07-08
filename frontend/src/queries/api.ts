import { cities, countries } from '../data/mockData';
import type { City, Country } from '../types';

// 백엔드 주소. .env(.env.local 등)에 VITE_API_BASE_URL을 설정하면 활성화된다.
// 예: VITE_API_BASE_URL=http://localhost:8080
const API_BASE_URL: string | undefined = import.meta.env.VITE_API_BASE_URL;

// GeoJSON 로드 전(computeFitView 계산 전) 잠깐 쓰이는 자리 표시자 고도값 —
// 국경 데이터가 로드되는 즉시 실제 fitAltitude로 교체된다(GlobeView.tsx의 resolveFitView).
const FALLBACK_FIT_ALTITUDE = 2;

// 백엔드는 아직 실제 식비(KRW) 데이터가 없어 meal_price에 세계은행 PLI(가격수준지수,
// 미국=100 기준)를 임시로 대입한다(data-pipeline/collectors/build_cities.py 참고) — KRW
// 금액이 아니다. 실제 식비 데이터가 붙기 전까지, 지수 100(=미국 평균)을 1끼 10,000원으로
// 놓고 하루 3끼 기준 1인 1일 식비로 환산한다.
const MEAL_BASELINE_KRW_PER_MEAL = 10000;
const MEALS_PER_DAY = 3;

function mealIndexToDailyKRW(mealPriceIndex: number): number {
  return Math.round((mealPriceIndex / 100) * MEAL_BASELINE_KRW_PER_MEAL * MEALS_PER_DAY);
}

type CountryDto = Omit<Country, 'fitAltitude' | 'exchangeRateUnit' | 'specialAdvisory' | 'bigMac'> & {
  specialAdvisory?: string | null;
  bigMac?: number | null;
  unit?: number | null;
};

// VITE_API_BASE_URL 미설정 시(목업 단계)에는 목업 데이터를 그대로 반환한다.
export async function fetchCities(): Promise<City[]> {
  if (!API_BASE_URL) return cities;
  const res = await fetch(`${API_BASE_URL}/cities`);
  if (!res.ok) throw new Error(`GET /cities failed: ${res.status}`);
  const rows = (await res.json()) as City[];
  // stay_price는 data-pipeline/scrapers/stay_scraper.py의 docstring대로 체크인~체크아웃
  // 7박 총액이라, 별도 변환 없이 그대로 쓴다(1박 평균은 표시 시점에 STAY_NIGHTS로 나눈다).
  return rows.map((row) => ({
    ...row,
    mealPrice: row.mealPrice != null ? mealIndexToDailyKRW(row.mealPrice) : null,
  }));
}

export async function fetchCountries(): Promise<Country[]> {
  if (!API_BASE_URL) return countries;
  const res = await fetch(`${API_BASE_URL}/countries`);
  if (!res.ok) throw new Error(`GET /countries failed: ${res.status}`);
  const rows = (await res.json()) as CountryDto[];
  return rows.map(({ unit, ...row }) => ({
    ...row,
    fitAltitude: FALLBACK_FIT_ALTITUDE,
    exchangeRateUnit: unit ?? 1,
    specialAdvisory: row.specialAdvisory ?? undefined,
    bigMac: row.bigMac ?? undefined,
  }));
}
