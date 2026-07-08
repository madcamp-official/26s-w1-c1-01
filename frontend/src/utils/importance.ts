// F-03: 줌 레벨(카메라 고도)에 따라 핀 노출 개수를 조절하기 위한 도시 중요도 등급.
// 3=글로벌 허브(항상 노출) 2=주요 도시(중간 확대부터) 1=나머지(도시 단위로 확대해야 노출)

const TIER3 = new Set([
  'HND', 'KIX', 'PEK', 'PVG', 'CAN', 'HKG', 'TPE', 'SIN', 'BKK', 'KUL', 'MNL', 'CGK',
  'DEL', 'BOM', 'DXB', 'DOH', 'ISL', 'LHR', 'CDG', 'FRA', 'AMS', 'JFK', 'LAX', 'ORD',
  'SYD', 'SVO', 'YYZ',
]);

const TIER2 = new Set([
  'FUK', 'CTS', 'NGO', 'OKA', 'SZX', 'CTU', 'XIY', 'MFM', 'KHH', 'CJU', 'TAE',
  'HAN', 'SGN', 'DAD', 'DPS', 'CEB', 'BNE', 'AKL', 'NAN',
  'YVR', 'SFO', 'SEA', 'IAD', 'ATL', 'HNL', 'GUM', 'DFW',
  'VIE', 'PRG', 'MAD', 'MUC', 'MXP', 'HEL',
  'TLV', 'RUH', 'AUH', 'CMB', 'KTM', 'ALA', 'TAS', 'ULN', 'NBO',
  'RGN', 'PNH', 'VTE', 'HKT',
]);

export function getCityTier(cityId: string): 1 | 2 | 3 {
  if (TIER3.has(cityId)) return 3;
  if (TIER2.has(cityId)) return 2;
  return 1;
}
