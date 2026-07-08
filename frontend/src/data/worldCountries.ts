// 국가 윤곽선(F-09)용 GeoJSON. 번들 크기 때문에 동적 import로 필요 시점에만 불러온다.
export interface CountryFeature {
  type: 'Feature';
  id?: string;
  properties: { name: string };
  geometry: unknown;
}

// world-atlas feature는 ISO 3166-1 숫자 코드를 id로 갖는다. 표시용 이름 문자열로
// 매칭하면 atlas가 쓰는 이름 표기와 다를 때마다(예: MP는 'N. Mariana Is.') 조용히
// 국경선이 사라지므로, 표기가 바뀌지 않는 숫자 코드로 매칭한다.
// 아래 값은 실제 countries-50m.json의 feature.id와 대조해 생성·검증한 것.
const ISO_NUMERIC: Record<string, string> = {
  NZ: '554',
  KZ: '398',
  NL: '528',
  JP: '392',
  US: '840',
  AE: '784',
  MY: '458',
  TH: '764',
  AU: '036',
  IN: '356',
  CN: '156',
  FR: '250',
  PH: '608',
  ID: '360',
  KR: '410',
  LK: '144',
  VN: '704',
  QA: '634',
  DE: '276',
  GU: '316',
  FI: '246',
  HK: '344',
  GB: '826',
  ES: '724',
  MO: '446',
  IT: '380',
  FJ: '242',
  KE: '404',
  CZ: '203',
  MM: '104',
  PW: '585',
  SA: '682',
  SG: '702',
  MP: '580',
  RU: '643',
  TW: '158',
  TR: '792',
  NP: '524',
  KH: '116',
  UZ: '860',
  IL: '376',
  MN: '496',
  AT: '040',
  LA: '418',
  CA: '124',
};

let cache: CountryFeature[] | null = null;

export async function loadCountryFeatures(): Promise<CountryFeature[]> {
  if (cache) return cache;
  const [topojsonClient, atlasModule] = await Promise.all([
    import('topojson-client'),
    import('world-atlas/countries-50m.json'),
  ]);
  // world-atlas는 TopoJSON 형식이라 GeoJSON Feature로 변환해야 polygonsData에 바로 쓸 수 있다.
  const atlas = atlasModule.default as unknown as Parameters<typeof topojsonClient.feature>[0];
  const objects = (atlas as unknown as { objects: Record<string, unknown> }).objects;
  const geo = topojsonClient.feature(atlas, objects.countries as never);
  cache = (geo as unknown as { features: CountryFeature[] }).features;
  return cache;
}

export function findCountryFeature(
  features: CountryFeature[],
  countryId: string,
  nameEn: string,
): CountryFeature | undefined {
  const isoId = ISO_NUMERIC[countryId];
  const byId = isoId ? features.find((f) => f.id === isoId) : undefined;
  if (byId) return byId;
  // 매핑에 아직 없는 신규 국가를 위한 이름 매칭 폴백
  const target = nameEn.toLowerCase();
  return features.find((f) => f.properties.name.toLowerCase() === target);
}
