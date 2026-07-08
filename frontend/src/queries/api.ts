import { cities, countries } from '../data/mockData';
import type { City, Country } from '../types';

// 백엔드 주소. .env(.env.local 등)에 VITE_API_BASE_URL을 설정하면 활성화된다.
// 예: VITE_API_BASE_URL=http://localhost:8080
const API_BASE_URL: string | undefined = import.meta.env.VITE_API_BASE_URL;

// GeoJSON 로드 전(computeFitView 계산 전) 잠깐 쓰이는 자리 표시자 고도값 —
// 국경 데이터가 로드되는 즉시 실제 fitAltitude로 교체된다(GlobeView.tsx의 resolveFitView).
const FALLBACK_FIT_ALTITUDE = 2;

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
  return (await res.json()) as City[];
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
