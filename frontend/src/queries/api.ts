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
  // 백엔드(backend/src/routes/countries.js)는 아직 exchangeRateUnit(환율 고시 단위,
  // 예: JPY는 100)을 내려주지 않고 이미 1단위 기준으로 나눈 exchangeRate만 보낸다.
  // 숫자 자체는 맞으므로 단위는 1로 고정해두고, 백엔드가 unit 필드를 추가하면 그대로 반영한다.
  return rows.map((row) => ({
    ...row,
    fitAltitude: FALLBACK_FIT_ALTITUDE,
    exchangeRateUnit: 1,
    specialAdvisory: row.specialAdvisory ?? undefined,
    bigMac: row.bigMac ?? undefined,
  }));
}

/**
 * 도시 선택 시 백엔드에 해당 도시의 항공권/숙박비 재계산을 요청한다.
 * 계산 결과는 이 응답으로 받지 않는다 — 백엔드가 갱신해두면 이후의 GET /cities에서
 * 새 값이 내려오는 흐름을 전제로 한 fire-and-forget 트리거다. 그래서 실패해도
 * 화면에는 영향이 없고(기존 값으로 계속 동작), 별도 재시도도 하지 않는다.
 * 엔드포인트 경로는 백엔드와 협의해 여기 한 곳만 바꾸면 된다.
 */
export async function requestCityCostUpdate(cityId: string): Promise<void> {
  // 목업 단계(VITE_API_BASE_URL 미설정)에서는 조용히 아무것도 하지 않는다.
  if (!API_BASE_URL) return;
  try {
    await fetch(`${API_BASE_URL}/cities/${encodeURIComponent(cityId)}/update`, { method: 'POST' });
  } catch {
    // 네트워크 실패는 치명적이지 않다 — 다음 도시 선택에서 자연스럽게 다시 시도된다.
  }
}
