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
  /** exchangeRateUnit 단위당 KRW 환산액. 예: JPY(100), 945 → 100엔 = 945원 */
  exchangeRate: number; // Country.Exchange_Rate
  currencyCode: string;
  bigMac?: number; // Country.BigMac (KRW)
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
  /** 1박 숙박비 (KRW) — City.Stay_Price */
  stayPrice: number | null;
  updatedAt: string;
}

export interface CityWithCost extends City {
  totalCost: number | null; // mealPrice*9(8박 9일) + flightPrice + stayPrice*8(1박 가격 * 숙박일수)
  pinColor: CostGrade | 'GRAY'; // City.Pin_Color
}
