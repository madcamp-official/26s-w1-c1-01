// 데이터 모델 — 기능 명세서 5.1절 + API 명세서 DB 필드 매핑 기준

export type AlarmLevel = 0 | 1 | 2 | 3 | 4;

export interface Country {
  countryId: string; // ISO 3166-1 alpha-2
  nameKo: string;
  nameEn: string;
  center: { lat: number; lng: number };
  /** 국가 전체가 화면에 들어오도록 하는 카메라 고도(altitude) 값. 국가 크기에 비례 */
  fitAltitude: number;
  alarmLevel: AlarmLevel; // Country.Alarm_Level (외교부 여행경보 단계, 0=없음~4=흑색경보)
  /** 외교부 특별여행주의보/경보 발령 시 문구. 발령 중이 아니면 undefined */
  specialAdvisory?: string;
  /** 환율 고시 단위. 통화별로 자연스러운 표기 단위가 달라(엔화는 100엔당,
   *  베트남 동은 1,000동당 등) 백엔드가 통화별로 알맞은 단위를 정해 함께 내려준다. */
  exchangeRateUnit: number;
  /** exchangeRateUnit 단위당 KRW 환산액. 예: JPY(100), 945 → 100엔 = 945원.
   *  수출입은행 API가 커버하는 23개 주요 통화 밖의 국가(대만, 베트남 등)는 아직
   *  환율 데이터가 없어 null - 화면에서 반드시 null 체크 후 표시해야 한다. */
  exchangeRate: number | null; // Country.Exchange_Rate
  currencyCode: string | null;
  bigMac?: number; // Country.BigMac (KRW)
  /** 대표 이미지. 파이프라인이 아직 못 채운 국가는 undefined(프런트가 플레이스홀더로 대체) */
  imageUrl?: string;
  imageCredit?: string;
}

export type CostGrade = 'LOW' | 'MID' | 'HIGH';

export interface City {
  cityId: string;
  nameKo: string;
  nameEn: string;
  countryId: string;
  iata: string;
  lat: number;
  lng: number;
  /** 1인 1일 식비 (KRW) — City.Meal_Price */
  mealPrice: number | null;
  /** 왕복 항공권 최저가 (KRW) — City.Flight_Price */
  flightPrice: number | null;
  /** 7박 숙박 총액 (KRW) — City.Stay_Price */
  stayPrice: number | null;
  /** 대표 이미지. 파이프라인이 아직 못 채운 도시는 undefined(프런트가 플레이스홀더로 대체) */
  imageUrl?: string;
  imageCredit?: string;
  updatedAt: string;
}

export interface CityWithCost extends City {
  totalCost: number | null; // mealPrice*8(7박 8일) + flightPrice + stayPrice(7박 총액)
  pinColor: CostGrade | 'GRAY'; // City.Pin_Color
}
