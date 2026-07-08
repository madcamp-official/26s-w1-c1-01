import type { AlarmLevel } from '../types';

// 외교부 해외안전여행 4단계 여행경보 체계
export const ALARM_INFO: Record<AlarmLevel, { label: string; color: string; textColor: string; description: string }> = {
  0: {
    label: '발령 없음',
    color: '#22c55e',
    textColor: '#05060a',
    description: '현재 특별한 여행경보가 발령되지 않은 지역입니다. 일반적인 안전 수칙을 지키며 여행하세요.',
  },
  1: {
    label: '남색경보 · 여행유의',
    color: '#3b82f6',
    textColor: '#ffffff',
    description: '신변안전에 유의해야 하는 지역입니다. 치안 상황을 수시로 확인하세요.',
  },
  2: {
    label: '황색경보 · 여행자제',
    color: '#eab308',
    textColor: '#05060a',
    description: '여행을 가급적 자제해야 하는 지역입니다. 불필요한 여행 계획은 미루는 것이 좋습니다.',
  },
  3: {
    label: '적색경보 · 출국권고',
    color: '#f97316',
    textColor: '#05060a',
    description: '긴급한 용무가 아니라면 즉시 출국을 고려해야 하는 지역입니다.',
  },
  4: {
    label: '흑색경보 · 여행금지',
    color: '#111827',
    textColor: '#ffffff',
    description: '법적으로 여행 및 체류가 금지된 지역입니다.',
  },
};

// 한국 빅맥 가격(KRW) 대비 물가 수준 비교 기준
export const KOREA_BIGMAC_KRW = 5500;
