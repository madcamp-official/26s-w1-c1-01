// F-07: 국가 검색 시 카메라가 "그 나라 국토만" 한눈에 들어오도록 중심 좌표(center)와
// 고도(fitAltitude)를 GeoJSON 국경선으로부터 계산한다. 주변국까지 넉넉히 보이는 화면이
// 아니라, 국경 경계가 화면 대부분을 채우는 타이트한 확대가 목표다.
import type { CountryFeature } from '../data/worldCountries';

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];
interface Geometry {
  type: string;
  coordinates: unknown;
}

// three-render-objects가 만드는 THREE.PerspectiveCamera는 fov 인자를 안 넘겨받아
// three.js 기본값 50도(수직 FOV)를 그대로 쓴다(three-render-objects 소스에서
// `new PerspectiveCamera()` 호출로 확인).
const VERTICAL_FOV_DEG = 50;
const HALF_FOV_DEG = VERTICAL_FOV_DEG / 2;
// 국가가 화면(카메라 시야각) 중 실제로 채우는 비율. 1에 가까울수록 국경이 화면 끝까지
// 꽉 차는 타이트한 확대, 값이 작을수록 주변 지역까지 넉넉히 보이는 확대다. "국토만
// 한눈에" 보이길 원하므로 시야각 대부분(85%)을 국경이 차지하도록 크게 잡는다.
const FOV_FILL_RATIO = 0.85;
// 마카오/싱가포르처럼 국경 폭이 거의 0에 가까운 초소형 국가까지 이 비율 그대로 적용하면
// 고도가 0에 수렴해 카메라가 지표면에 파묻힌다 — 최소한의 주변 맥락(바다/이웃나라)은
// 보이도록 바닥값을 둔다.
const MIN_FIT_ALTITUDE = 0.3;
// 러시아/미국처럼 대륙급으로 넓은 나라의 지오메트리 파싱이 잘못돼 폭이 비정상적으로
// 커지는 경우에 대비한 안전판. 정상적인 케이스에서는 도달하지 않는 값이다.
const MAX_FIT_ALTITUDE = 3.0;

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polyBbox(poly: Polygon) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  poly.forEach((ring) =>
    ring.forEach(([lng, lat]) => {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }),
  );
  return { minLat, maxLat, minLng, maxLng, cLat: (minLat + maxLat) / 2, cLng: (minLng + maxLng) / 2 };
}

// world-atlas는 해외 영토(프랑스령 기아나, 네덜란드령 카리브해 자치령 등)를 본토와
// 같은 MultiPolygon 안에 묶어두는 경우가 있다. 그대로 bounding box를 구하면 국경 하나
// 때문에 국가 확대 화면이 지구 반대편까지 걸쳐버린다. 가장 넓은 폴리곤(본토)을 기준으로
// 삼아 그로부터 일정 거리 이내(본토 자체 크기의 4배, 최소 20도) 폴리곤만 "같은 국토"로
// 취급하고 나머지(원거리 해외 영토)는 제외한다 — 일본의 홋카이도/오키나와처럼 본토와
// 가까운 섬들은 포함되고, 진짜 해외 영토만 제외된다.
function selectCorePolygons(geometry: Geometry): Polygon[] {
  const polys: Polygon[] = geometry.type === 'Polygon' ? [geometry.coordinates as Polygon] : (geometry.coordinates as MultiPolygon);
  const infos = polys.map((poly) => ({ poly, area: ringArea(poly[0]), bbox: polyBbox(poly) }));
  infos.sort((a, b) => b.area - a.area);
  const core = infos[0];
  const coreDiag = Math.hypot(
    core.bbox.maxLat - core.bbox.minLat,
    (core.bbox.maxLng - core.bbox.minLng) * Math.cos((core.bbox.cLat * Math.PI) / 180),
  );
  const threshold = Math.max(coreDiag * 4, 20);
  return infos
    .filter((info) => {
      const dLat = info.bbox.cLat - core.bbox.cLat;
      let dLng = info.bbox.cLng - core.bbox.cLng;
      if (dLng > 180) dLng -= 360;
      if (dLng < -180) dLng += 360;
      const dist = Math.hypot(dLat, dLng * Math.cos((core.bbox.cLat * Math.PI) / 180));
      return dist <= threshold;
    })
    .map((info) => info.poly);
}

interface AngularSpan {
  centerLat: number;
  centerLng: number;
  spanDeg: number;
}

function computeAngularSpan(polys: Polygon[]): AngularSpan {
  let minLat = Infinity;
  let maxLat = -Infinity;
  const lngs: number[] = [];
  polys.forEach((poly) =>
    poly.forEach((ring) =>
      ring.forEach(([lng, lat]) => {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        lngs.push(lng);
      }),
    ),
  );
  // 날짜변경선을 가로지르는 나라(러시아, 피지 등)는 단순 min/max로 재면 실제보다
  // 훨씬 넓게 계산되므로, -180/180 경계에서 이어붙인 폭과 원래 폭 중 더 좁은 쪽을 쓴다.
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanA = maxLng - minLng;
  const shifted = lngs.map((l) => (l < 0 ? l + 360 : l));
  const minLng2 = Math.min(...shifted);
  const maxLng2 = Math.max(...shifted);
  const spanB = maxLng2 - minLng2;
  const useShifted = spanB < spanA;
  const lngSpan = useShifted ? spanB : spanA;
  const centerLng = useShifted ? (((minLng2 + maxLng2) / 2 + 540) % 360) - 180 : (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const latSpan = maxLat - minLat;
  const lngSpanEffective = lngSpan * Math.cos((centerLat * Math.PI) / 180);
  return { centerLat, centerLng, spanDeg: Math.max(latSpan, lngSpanEffective) };
}

// 카메라가 원점(지구 중심)을 향해 정렬된 상태에서, 중심으로부터 각도 halfSpanRad만큼
// 떨어진 지점이 시야각 halfFovRad의 경계에 정확히 걸리는 고도(altitude, 지구 반지름
// 배수)를 구면 기하로 계산한다. (평면 근사 d*tan(FOV/2) 대신 구 위의 실제 점 위치를
// 카메라 시선축 기준 각도로 투영한 정확식 — 국가 폭이 넓을수록(러시아 등) 평면 근사와의
// 오차가 커진다.)
function altitudeForHalfSpan(halfSpanRad: number, halfFovRad: number): number {
  return Math.cos(halfSpanRad) - 1 + Math.sin(halfSpanRad) / Math.tan(halfFovRad);
}

export function computeFitView(feature: CountryFeature): { center: { lat: number; lng: number }; fitAltitude: number } | undefined {
  const geometry = feature.geometry as Geometry;
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return undefined;
  const corePolys = selectCorePolygons(geometry);
  const { centerLat, centerLng, spanDeg } = computeAngularSpan(corePolys);
  const halfSpanRad = ((spanDeg / 2) * Math.PI) / 180;
  const halfFovRad = ((HALF_FOV_DEG * FOV_FILL_RATIO) * Math.PI) / 180;
  const tight = altitudeForHalfSpan(halfSpanRad, halfFovRad);
  const fitAltitude = Math.min(MAX_FIT_ALTITUDE, Math.max(MIN_FIT_ALTITUDE, tight));
  return { center: { lat: centerLat, lng: centerLng }, fitAltitude };
}
