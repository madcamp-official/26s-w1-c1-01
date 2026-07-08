import type { CityWithCost } from '../types';

// F-06/F-19: 가격 데이터가 있는 도시 중 무작위 1곳. 직전에 보여준 도시와 중복되지 않도록 한다.
export function pickRandomCity(cities: CityWithCost[], excludeCityId: string | null): CityWithCost | undefined {
  const candidates = cities.filter((c) => c.totalCost != null && c.cityId !== excludeCityId);
  const pool = candidates.length > 0 ? candidates : cities.filter((c) => c.totalCost != null);
  if (pool.length === 0) return undefined;
  return pool[Math.floor(Math.random() * pool.length)];
}
