import type { CityWithCost, CostGrade } from '../types';

export type BudgetAnswer = CostGrade;
export type ClimateAnswer = 'TROPICAL' | 'TEMPERATE' | 'COLD';
export type RegionAnswer = 'ASIA' | 'EUROPE' | 'AMERICAS_OCEANIA';

export interface QuizAnswers {
  budget: BudgetAnswer;
  climate: ClimateAnswer;
  region: RegionAnswer;
}

// 러시아는 유라시아에 걸쳐 있어 도시 경도 기준으로 아시아/유럽을 나눈다(RUSSIA_ASIA_CITIES 참고).
const REGION_BY_COUNTRY: Record<string, RegionAnswer> = {
  JP: 'ASIA', TW: 'ASIA', HK: 'ASIA', MO: 'ASIA', TH: 'ASIA', SG: 'ASIA', MY: 'ASIA',
  PH: 'ASIA', VN: 'ASIA', ID: 'ASIA', CN: 'ASIA', MN: 'ASIA', MM: 'ASIA', KR: 'ASIA',
  AE: 'ASIA', QA: 'ASIA', TR: 'ASIA', KZ: 'ASIA', IN: 'ASIA', LK: 'ASIA', SA: 'ASIA',
  NP: 'ASIA', KH: 'ASIA', UZ: 'ASIA', IL: 'ASIA', LA: 'ASIA',
  GB: 'EUROPE', FR: 'EUROPE', IT: 'EUROPE', ES: 'EUROPE', DE: 'EUROPE',
  NL: 'EUROPE', FI: 'EUROPE', CZ: 'EUROPE', AT: 'EUROPE',
  GU: 'AMERICAS_OCEANIA', US: 'AMERICAS_OCEANIA', CA: 'AMERICAS_OCEANIA',
  AU: 'AMERICAS_OCEANIA', NZ: 'AMERICAS_OCEANIA', FJ: 'AMERICAS_OCEANIA',
  PW: 'AMERICAS_OCEANIA', MP: 'AMERICAS_OCEANIA', KE: 'AMERICAS_OCEANIA',
};

// 러시아 도시 중 극동(아시아 쪽) 공항만 별도 지정, 나머지(모스크바/상트페테르부르크)는 유럽으로 취급
const RUSSIA_ASIA_CITIES = new Set(['KHV', 'VVO', 'UUS']);

function regionOf(countryId: string, cityId: string): RegionAnswer | undefined {
  if (countryId === 'RU') return RUSSIA_ASIA_CITIES.has(cityId) ? 'ASIA' : 'EUROPE';
  return REGION_BY_COUNTRY[countryId];
}

function climateOf(lat: number): ClimateAnswer {
  const abs = Math.abs(lat);
  if (abs < 23.5) return 'TROPICAL';
  if (abs < 45) return 'TEMPERATE';
  return 'COLD';
}

/**
 * F-05/17/18 추천 로직. 응답 3개(예산/기후/지역)를 모두 만족하는 도시를 최우선으로 담고,
 * 3곳이 안 되면 기후 → 예산 → 지역 순으로 조건을 완화해 "부족한 자리만" 채운다.
 * 지역(Region)은 사용자가 가장 선호하는 핵심 가치이므로 최우선으로 유지한다.
 */
export function recommendCities(cities: CityWithCost[], answers: QuizAnswers): CityWithCost[] {
  const valid = cities.filter((c) => c.totalCost != null);

  const matches = (c: CityWithCost, opts: { budget: boolean; climate: boolean; region: boolean }) => {
    if (opts.budget && c.pinColor !== answers.budget) return false;
    if (opts.climate && climateOf(c.lat) !== answers.climate) return false;
    if (opts.region && regionOf(c.countryId, c.cityId) !== answers.region) return false;
    return true;
  };

  const attempts = [
    { budget: true, climate: true, region: true }, // 모두 일치
    { budget: true, climate: false, region: true }, // 기후 완화 (예산, 지역 유지)
    { budget: false, climate: true, region: true }, // 예산 완화 (기후, 지역 유지)
    { budget: false, climate: false, region: true }, // 예산+기후 완화 (지역 최우선 유지)
    { budget: true, climate: true, region: false }, // 지역 완화 (예산, 기후 유지) - 다른 대륙이라도 조건이 맞는 곳
    { budget: true, climate: false, region: false }, // 지역+기후 완화 (예산 최우선) - 최후의 보루
  ];

  const sortedValid = [...valid].sort((a, b) => (a.totalCost ?? 0) - (b.totalCost ?? 0));

  const picked: CityWithCost[] = [];
  for (const opts of attempts) {
    for (const c of sortedValid) {
      if (picked.length >= 3) return picked;
      if (!picked.includes(c) && matches(c, opts)) picked.push(c);
    }
  }
  if (picked.length >= 3) return picked;

  // 모든 조건을 내려놓고도 3곳이 안 되면 최종적으로 남은 자리만 전체 최저가 순으로 채운다
  const fallback = sortedValid.filter((c) => !picked.includes(c));
  return [...picked, ...fallback].slice(0, 3);
}
