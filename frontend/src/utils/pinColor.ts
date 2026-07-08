import type { City, CityWithCost, CostGrade } from '../types';

const STAY_NIGHTS = 8;
// 식비는 숙박 일수(8박)가 아니라 여행 전체 일수(8박 9일 = 9일) 동안 발생한다.
const MEAL_DAYS = STAY_NIGHTS + 1;

export const GRADE_COLOR: Record<CostGrade | 'GRAY', string> = {
  LOW: '#22c55e',
  MID: '#eab308',
  HIGH: '#ef4444',
  GRAY: '#6b7280',
};

// 색약 접근성 보완 기호 (핀 형태 병행 표기, 기능명세서 5.2절)
// −/=/+는 "한국과 비교"하는 부호처럼 보인다는 피드백이 있어 가격대를 나타내는
// 익숙한 $ 표기(저가/중가/고가)로 바꿨다.
export const GRADE_SYMBOL: Record<CostGrade | 'GRAY', string> = {
  LOW: '$',
  MID: '$$',
  HIGH: '$$$',
  GRAY: '?',
};

// 가격대 배지 문구. PricePanel과 RecommendQuiz가 함께 쓰므로 여기 한 곳에서만 관리한다.
export const GRADE_LABEL: Record<CostGrade | 'GRAY', string> = {
  LOW: '저렴',
  MID: '적당',
  HIGH: '비쌈',
  GRAY: '준비 중',
};

function computeTotalCost(city: City): number | null {
  if (city.mealPrice == null || city.flightPrice == null || city.stayPrice == null) {
    return null;
  }
  return city.mealPrice * MEAL_DAYS + city.flightPrice + city.stayPrice * STAY_NIGHTS;
}

/**
 * 전체 도시의 종합 비용 분포를 3분위(저/중/고)로 나눠 등급을 매긴다.
 * API 명세서 7-1 `City.Pin_Color` 계산 규칙.
 */
export function withCostAndColor(cities: City[]): CityWithCost[] {
  const totals = cities
    .map(computeTotalCost)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const p33 = totals[Math.floor(totals.length / 3)] ?? 0;
  const p66 = totals[Math.floor((totals.length * 2) / 3)] ?? 0;

  return cities.map((city) => {
    const totalCost = computeTotalCost(city);
    let pinColor: CostGrade | 'GRAY';
    if (totalCost == null) {
      pinColor = 'GRAY';
    } else if (totalCost <= p33) {
      pinColor = 'LOW';
    } else if (totalCost <= p66) {
      pinColor = 'MID';
    } else {
      pinColor = 'HIGH';
    }
    return { ...city, totalCost, pinColor };
  });
}
