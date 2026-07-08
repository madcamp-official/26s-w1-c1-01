import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import type { CityWithCost, Country } from '../types';
import { GRADE_COLOR } from '../utils/pinColor';
import { useAppStore } from '../store/useAppStore';
import { findCountryFeature, loadCountryFeatures, type CountryFeature } from '../data/worldCountries';
import { getCityTier } from '../utils/importance';
import { computeFitView } from '../utils/countryFraming';

// 러시아 같은 국가의 GeoJSON은 좌표 수가 수만 개로, three-globe가 메인 스레드에서
// 동기적으로 폴리곤 메시를 생성할 때 UI가 수백 ms 동안 멈춘다. 좌표를 간소화하면
// 시각적 차이 없이 메시 생성 비용을 대폭 줄일 수 있다.
const SIMPLIFY_TOLERANCE = 0.15; // 도(degree) 단위. 0.1~0.2가 지구본 스케일에서 적절.
const simplifyCache = new Map<string, CountryFeature>();

/** Douglas-Peucker 알고리즘으로 좌표 배열을 간소화한다. */
function dpSimplify(coords: [number, number][], tolerance: number): [number, number][] {
  if (coords.length <= 2) return coords;
  let maxDist = 0;
  let maxIdx = 0;
  const [sx, sy] = coords[0];
  const [ex, ey] = coords[coords.length - 1];
  const dx = ex - sx;
  const dy = ey - sy;
  const lenSq = dx * dx + dy * dy;
  for (let i = 1; i < coords.length - 1; i++) {
    const [px, py] = coords[i];
    let dist: number;
    if (lenSq === 0) {
      dist = Math.hypot(px - sx, py - sy);
    } else {
      const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / lenSq));
      dist = Math.hypot(px - (sx + t * dx), py - (sy + t * dy));
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = dpSimplify(coords.slice(0, maxIdx + 1), tolerance);
    const right = dpSimplify(coords.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [coords[0], coords[coords.length - 1]];
}

function simplifyFeature(feature: CountryFeature): CountryFeature {
  const key = feature.id ?? feature.properties.name;
  const cached = simplifyCache.get(key);
  if (cached) return cached;
  const geom = feature.geometry as { type: string; coordinates: unknown };
  let simplified: unknown;
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates as [number, number][][];
    simplified = rings.map(r => dpSimplify(r, SIMPLIFY_TOLERANCE));
  } else if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as [number, number][][][];
    simplified = polys.map(poly => poly.map(r => dpSimplify(r, SIMPLIFY_TOLERANCE)));
  } else {
    simplifyCache.set(key, feature);
    return feature;
  }
  const result: CountryFeature = {
    ...feature,
    geometry: { type: geom.type, coordinates: simplified },
  };
  simplifyCache.set(key, result);
  return result;
}

interface GlobeViewProps {
  cities: CityWithCost[];
  countries: Country[];
}

// three-globe의 위성 타일 엔진(three-slippy-map-globe)은 카메라 고도(거리)만으로
// 타일 레벨을 정한다: 고도(거리, 지구 반지름 배수) >= 2일 때 레벨 2(90도짜리 거친
// 타일), < 2일 때 레벨 3 이상(45도 이하, 더 세밀한 타일)을 쓴다. 처음 켰을 때 화질이
// 안 좋다는 건 바로 이 레벨 2 구간에 걸려 있었기 때문 — react-globe.gl은 최소 타일
// 레벨을 지정하는 옵션을 따로 노출하지 않으므로, 기본 고도를 2 미만으로 낮춰 시작
// 화면이 항상 레벨 3 이상 타일을 쓰게 한다.
const DEFAULT_ALTITUDE = 1.8;
// 최대 축소 고도가 국가별 fitAltitude 최댓값보다 여유 있게 크도록 보장하는 마진.
// 이 한도가 fitAltitude보다 작으면 OrbitControls.maxDistance가 F-07 국가 자동확대
// (pointOfView)까지 잘라버려 큰 나라(러시아/미국/캐나다)를 검색해도 화면에 다 안 들어온다.
// 상수로 두는 대신 실제 countries 데이터에서 파생시켜 데이터가 바뀌어도 불변식이 유지되게 한다.
const MAX_ALTITUDE_MARGIN = 0.4;
const CITY_ALTITUDE = 0.6;

// 기본 화면(처음 접속 / 로고 클릭)의 중심 좌표 — 서울.
const SEOUL = { lat: 37.5665, lng: 126.978 };
// 서울로 카메라가 날아가는 데 걸리는 시간. 지구본이 아직 회전(팬/줌)하는 도중에 아크를
// 켜면, 카메라 움직임과 아크 자체의 이동이 뒤섞여 매번 속도가 달라 보이거나 화면 밖으로
// 씹혀 나가는 것처럼 보였다 — 카메라가 완전히 멈춘 뒤에야 아크를 켜서 이 간섭을 없앤다.
const CAMERA_FLY_MS = 800;
// 서울→도시 pulse 아크 하나가 시작점에서 도착점까지 흐르는 데 걸리는 시간(arcDashAnimateTime).
// three-globe의 대시 오프셋은 호의 상대 거리(0~1)를 기준으로 진행되므로, 실제 물리적
// 거리와 무관하게 모든 호(가장 먼 도시 포함)가 정확히 이 시간 안에 도착점까지 도달한다.
const ARC_TRAVEL_TIME_MS = 3000;
// 화면에서 아크를 완전히 지우기까지 기다리는 시간. ARC_TRAVEL_TIME_MS보다 넉넉히 길게
// 잡아야 대시(빛 덩어리)의 꼬리까지 도착점을 완전히 지나간 뒤에 지워진다 — 정확히
// 같은 값으로 두면 가장 늦게 그려지는 프레임에서 꼬리가 도착 직전에 잘려 보일 수 있다.
// 꼬리가 도착점을 지나는 데 걸리는 시간도 ARC_TRAVEL_TIME_MS에 비례하므로 배수로 잡는다.
const ARC_PULSE_DURATION_MS = Math.round(ARC_TRAVEL_TIME_MS * 1.5);
// 대시(빛 덩어리) 하나의 길이(호 전체 길이 대비 비율).
const ARC_DASH_LENGTH = 0.35;
// three-globe는 대시 애니메이션 방향을 맞추려고 relDistance를 "도착점=0, 출발점(서울)=1"로
// 뒤집어서 계산한다(실측 확인: 씬의 아크 지오메트리에서 서울 쪽 정점의 relDistance가 1,
// 도착지 쪽 정점이 0). 그런데 대시는 항상 relDistance가 작은 쪽(도착지)부터 채워지고
// 시간이 지날수록 relDistance가 큰 쪽(서울)으로 옮겨간다 — 즉 기본값(초기 갭 0)으로 두면
// 광선이 도착지에서 이미 시작해 서울 쪽으로 거꾸로 흐르는 것처럼 보여서 "서울에서 출발하는
// 모습"이 아예 안 보였다. 초기 갭을 (1 - 대시길이)로 주면 방향은 "서울 → 도착지"가 되지만,
// t=0에 이미 완성된 대시가 relDistance∈[1-길이, 1] 구간(서울 옆)에 통째로 나타나 광선이
// "뿜어져 나온다"기보다 "갑자기 생긴다"로 보였다. 초기 갭을 정확히 1로 주면 t=0의 대시가
// relDistance∈[1, 1+길이] — 호 밖(서울 뒤) — 에 통째로 숨고, 애니메이션이 진행되면서
// 머리부터 서울 지점을 통과해 나오므로 광선이 서울에서 자라나며 발사되는 모습이 된다.
// 머리가 정확히 relDistance=1(서울)에서 출발하므로 도착까지 걸리는 시간은 그대로
// ARC_TRAVEL_TIME_MS이고, 꼬리가 다 빠지는 시점도 (1+길이)×이동시간 < PULSE_DURATION이라
// 기존 타이머로 잘리지 않는다.
const ARC_DASH_INITIAL_GAP = 1;

interface PulseArc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

// F-03: 축소할수록 핀이 너무 빽빽해 가독성이 떨어지므로, 카메라 고도에 따라 중요도
// 등급이 낮은 도시는 숨긴다. 확대할수록 임계값을 낮춰 더 많은 도시가 드러난다.
function tierForAltitude(altitude: number): 1 | 2 | 3 {
  if (altitude >= 1.4) return 3;
  if (altitude >= 0.7) return 2;
  return 1;
}

// react-globe.gl은 기본적으로 회전 감도(rotateSpeed)를 고도 × 0.3으로 계산한다.
// 축소 상태(고도가 큼)에서는 이 값이 너무 커서 핀을 클릭하려는 미세한 마우스 움직임에도
// 지구본이 크게 튀어 클릭이 씹히는 문제가 있었다. 처음엔 감도를 고정값으로 눌러
// 고쳤는데, 그러면 반대로 확대했을 때(고도가 작음) 원래는 더 낮아야 할 감도가 그
// 고정값 그대로 유지돼 커서 이동량 대비 지구본이 과하게 많이 돌아가 버렸다.
// → 원래 공식(고도 비례)은 유지하되 "위쪽 한계"만 씌워서, 축소 시엔 상한선에
// 걸려 안정적이고 확대 시엔 원래대로 고도에 비례해 자연스럽게 감도가 낮아지게 한다.
const ROTATE_SPEED_CAP = 0.3;
const rotateSpeedForAltitude = (altitude: number) => Math.min(altitude * 0.3, ROTATE_SPEED_CAP);

interface TileEngineLike {
  minLevel: number;
  maxLevel: number;
  level: number;
  thresholds: unknown[];
  tileUrl: unknown;
  children: unknown[];
  add: (...objects: unknown[]) => unknown;
  updatePov: (camera: unknown) => void;
}

// 위성 타일 화질 부스트(강제 최소 레벨)의 최종 목표치. 레벨 4(적도 4096px)는 일반
// 디스플레이에서도 지구본이 차지하는 화면 픽셀 수 대비 흐릿해 보여 레벨 5, 레티나에서는
// 6까지 올린다. 단, 이 값을 마운트 직후 한 번에 강제하면 안 된다 — 카메라가 넓은 영역을
// 보는 상태에서 레벨 5/6에 맞물리는 타일 수는 수백 장에 달하고, 그 타일들의 메시 생성과
// 텍스처 업로드가 메인 스레드를 잘게 끊어 먹어 초기 pulse 아크 애니메이션이 아예 안 보일
// 정도로 프레임을 빼앗겼다. 그래서 시작은 엔진의 자연 판정(고도 1.8 기준 레벨 3, 약 80장)에
// 맡겨 첫 화면과 pulse를 부드럽게 재생하고, 카메라/애니메이션이 유휴 상태가 된 뒤에
// 한 레벨씩 단계적으로 올린다 — 각 단계의 타일 배치가 작게 쪼개져 프레임 드랍이 체감되지
// 않고, 최종 화질은 예전과 동일하다.
const TILE_BOOST_MAX_LEVEL = window.devicePixelRatio > 1.5 ? 6 : 5;
// 카메라가 이보다 더 가까이 파고들면 타일 엔진의 자연 판정 레벨이 TILE_BOOST_MAX_LEVEL을
// 넘어서지만, maxLevel 캡 때문에 실제로는 그 이상 세밀해지지 못한 채 같은 타일을 계속
// 확대해서 보여준다 — 그 초과분이 1단계를 넘어가면 타일 한 장을 너무 심하게 확대해 화면이
// 흐릿한 단색 얼룩(회색 뭉갬)처럼 보인다(실측: 도쿄를 한계까지 확대하면 재현). 타일 엔진이
// 레벨을 판정할 때 쓰는 것과 정확히 같은 thresholds 공식(8 / 2^level, 아래 thresholds 배열
// 참고)을 거꾸로 풀어, "자연 판정이 TILE_BOOST_MAX_LEVEL보다 딱 한 단계까지만 앞서 나가는"
// 고도를 하한으로 잡는다 — 실측상 이 한 단계 초과까지는 자연스럽고, 그 이상부터 급격히
// 뭉개졌다. minLevel/maxLevel처럼 유지보수 중 서로 어긋나지 않도록 상수 대신 여기서 계산한다.
const MIN_ALTITUDE = 8 / Math.pow(2, TILE_BOOST_MAX_LEVEL + 1);
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 아래 controls.minDistance 적용부가 아직 주석 처리된 미완성 작업이라 임시로 미사용 억제
void MIN_ALTITUDE;
// 램프 시작 레벨. 자연 판정(레벨 3)의 바로 다음 단계부터 올린다.
const TILE_BOOST_START_LEVEL = 4;
// 램프 단계 사이 간격. 실측(Chrome performance trace)으로는 단계 하나의 타일 메시 생성
// 자체가 메인 스레드를 90ms 넘게 막은 적이 없었고, 텍스처는 어차피 네트워크 도착 순서대로
// 흩어져 들어와 한 프레임에 몰리지 않는다 — 그래서 "이전 단계가 완전히 끝나길" 기다릴
// 필요 없이 짧은 간격으로도 다음 단계를 시작할 수 있다. 단, 이건 "정지된 화면" 기준이다 —
// 이 비용이 서울→도시 pulse 아크가 한창 애니메이션 중인 구간과 겹치면 매 프레임 진행돼야
// 할 대시 오프셋 갱신이 그 90ms만큼 밀려 광선이 눈에 띄게 끊겨 보인다(실측: 램프 시작을
// pulse 재생 중으로 앞당겼더니 바로 재현됨). 그래서 단계 간격만 짧게 유지하고, 램프의
// 시작 시점은 반드시 pulse가 완전히 끝난 뒤로 고정한다(마운트 busy 게이트 참고).
const TILE_BOOST_STEP_MS = 600;
// 카메라 busy 구간이 끝난 뒤 타일 갱신/램프 재시도까지 두는 여유. 트윈 마지막 프레임이나
// 관성(damping)이 명목 종료 시각을 살짝 넘길 수 있어 최소한의 여유만 둔다.
const CAMERA_IDLE_BUFFER_MS = 50;
// 휠/드래그 이벤트 한 번이 카메라를 busy로 표시하는 시간. 연속 제스처 동안은 이벤트마다
// 갱신되어 계속 busy로 유지되고, 마지막 입력 후 이 시간 + 여유가 지나면 타일이 갱신된다.
// 화질 개선(타일 업데이트) 반응 속도를 높이기 위해 이전 400ms에서 150ms로 줄인다.
const ZOOM_BUSY_MS = 150;
// 렌더 해상도(pixel ratio).
const FULL_PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);

// three-globe/three-slippy-map-globe의 타일 엔진 인스턴스는 react-globe.gl이 별도로
// 노출하지 않아, Three.js 씬 그래프를 직접(children 재귀 순회) 뒤져 덕타이핑으로 찾는다.
// 'three' 타입 선언이 이 프로젝트 moduleResolution에서 해석되지 않아 Object3D 타입을
// 직접 import하는 대신 최소 형태(children 배열)만 unknown으로 다룬다.
function findTileEngine(root: unknown): TileEngineLike | undefined {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    const candidate = node as Partial<TileEngineLike> & { children?: unknown[] };
    if (Array.isArray(candidate.thresholds) && 'tileUrl' in candidate && typeof candidate.minLevel === 'number') {
      return candidate as TileEngineLike;
    }
    if (Array.isArray(candidate.children)) queue.push(...candidate.children);
  }
  return undefined;
}

// three.js CSS2DRenderer는 매 애니메이션 프레임마다 el.style.zIndex를 카메라 거리
// 기반으로 다시 계산해 덮어쓴다. 일반 인라인 스타일(setProperty/style.zIndex=…)로는
// 아무리 큰 값을 넣어도 다음 프레임에 즉시 지워지므로 절대 이길 수 없다.
// CSS 캐스케이드 규칙에 의해 **stylesheet의 !important > 일반 인라인 스타일**이므로,
// <style> 태그에 !important 규칙을 넣고 CSS 커스텀 프로퍼티(--pin-z)로 값을 전달하면
// CSS2DRenderer가 매 프레임 덮어쓰는 일반 인라인 z-index를 확실히 이길 수 있다.
const PIN_Z_STYLE_ID = 'pin-z-override-style';
function ensurePinZStyle() {
  if (document.getElementById(PIN_Z_STYLE_ID)) return;
  try {
    const style = document.createElement('style');
    style.id = PIN_Z_STYLE_ID;
    style.textContent = `.pin-z-elevated { z-index: var(--pin-z) !important; }`;
    document.head.appendChild(style);
  } catch { /* SSR 등 document가 없는 환경에서는 무시 */ }
}

/** 핀의 루트 엘리먼트(CSS2DRenderer가 관리하는 el)의 z-index를 강제로 올리거나 해제한다. */
function elevatePinZ(el: HTMLElement, zIndex: string) {
  ensurePinZStyle();
  el.style.setProperty('--pin-z', zIndex);
  el.classList.add('pin-z-elevated');
}
function resetPinZ(el: HTMLElement) {
  el.classList.remove('pin-z-elevated');
  el.style.removeProperty('--pin-z');
}

function buildPinElement(
  city: CityWithCost,
  onSelect: (cityId: string) => void,
  initiallyVisible: boolean,
  forwardWheel: (e: WheelEvent) => void,
): { root: HTMLElement; wrapper: HTMLElement } {
  // react-globe.gl(CSS2DRenderer)이 매 프레임 이 루트 엘리먼트의 style.transform을
  // 강제로 덮어써 좌표에 위치시킨다. 그래서 앵커 오프셋(-50%,-100%)을 여기 걸면 매번 지워진다.
  // 루트는 크기 0짜리 순수 좌표 앵커로만 두고, 실제 보이는 핀은 내부 자식에서
  // 우리가 직접 제어하는 transform으로 앵커링한다.
  const el = document.createElement('div');
  el.style.width = '0px';
  el.style.height = '0px';

  // 앵커 레이어: 마커(핀 끝)만 감싸서 그 바운딩 박스 기준으로 -50%,-100% 이동시킨다.
  // 라벨(도시명)은 아래에서 절대 위치로 마커 위에 겹쳐 올릴 뿐 이 박스 크기에 영향을
  // 주지 않는다 — 라벨을 같은 flex 박스 안에 두면 라벨 높이만큼 마커가 실제 좌표보다
  // 위로 뜨는 오차가 생긴다(핀이 크고 대상 국토가 작을 때 특히 도드라짐).
  const anchor = document.createElement('div');
  anchor.className = 'absolute left-0 top-0 -translate-x-1/2 -translate-y-full';

  const wrapper = document.createElement('div');
  // select-none: 지구본을 드래그로 돌릴 때 핀 안의 $/문자 텍스트가 브라우저 기본
  // 텍스트 선택(파란 하이라이트)으로 잡히는 것을 막는다.
  // 마운트 이후의 등장/은닉(F-03 줌 필터, 국가 하이라이트 등)은 GlobeView의 pin 표시
  // 상태 effect가 담당하지만 그 effect는 상태가 "바뀔 때"만 돌므로, 생성 시점의 초기
  // 표시 여부는 여기서 직접 확정해야 한다.
  wrapper.className = `group relative cursor-pointer select-none drop-shadow-lg opacity-0 transition-opacity duration-500 ease-out ${
    initiallyVisible ? 'pointer-events-auto' : 'pointer-events-none'
  }`;
  wrapper.dataset.cityId = city.cityId;

  // 이 핀이 만들어지는 시점에 이미 선택된 도시라면(예: 데이터 갱신으로 핀 DOM이 통째로
  // 재생성되는 경우) 강조 상태를 처음부터 입혀둔다 — 선택 강조 effect는 selectedCityId가
  // "바뀔 때"만 돌므로 재생성된 핀은 그 effect가 다시 칠해주지 않는다.
  const isSelected = useAppStore.getState().selectedCityId === city.cityId;

  // 기호(−/=/+, $/$$/$$$ 등) 대신 표준 지도 핀처럼 흰 점 하나만 찍는다 — 원 모양이라
  // 마커 회전(-45deg)과 무관하게 항상 그대로 보여서 문자처럼 반대로 되돌릴 필요가 없다.
  // 마커는 정적 마크업 + 우리가 관리하는 색상 상수뿐이라 innerHTML로 만들지만,
  // 도시명은 외부 데이터라 textContent로 넣어 HTML로 해석될 여지를 없앤다.
  wrapper.innerHTML = `
    <div class="pin-marker flex h-5 w-5 items-center justify-center rounded-[50%_50%_50%_0] border-2 border-white/85 -rotate-45 transition-transform duration-150 group-hover:scale-125${
      city.pinColor === 'GRAY' ? ' opacity-60' : ''
    }${isSelected ? ' scale-125' : ''}" style="background-color:${GRADE_COLOR[city.pinColor]}">
      <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
    </div>
  `;
  // 라벨을 핀 항상 아래에 배치한다. 평상시에는 투명(opacity-0)하지만 호버 시 나타난다(group-hover:opacity-100).
  // 줌이나 선택 상태에 따라 강제로 켜야 할 때는 JS에서 opacity-100 클래스를 제어한다.
  const label = document.createElement('div');
  label.className = `pin-label absolute top-full left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap select-none rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white transition-opacity duration-150 opacity-0 group-hover:opacity-100`;
  // Tailwind 클래스 대신 인라인 스타일로 폰트 안티앨리어싱과 GPU 컴포지팅을 강제 고정한다.
  // opacity 트랜지션이 끝날 때 브라우저가 GPU 레이어를 해제하면서 폰트 렌더링이 바뀌는
  // 깜빡임을 방지한다. will-change: opacity가 레이어를 영구 유지시키고,
  // -webkit-font-smoothing: antialiased가 렌더링 방식을 고정한다.
  label.style.willChange = 'opacity';
  (label.style as unknown as Record<string, string>).webkitFontSmoothing = 'antialiased';
  (label.style as unknown as Record<string, string>).MozOsxFontSmoothing = 'grayscale';
  label.textContent = city.nameKo;
  wrapper.appendChild(label);
  // 핀이 뜨자마자 팍 나타나지 않고 서서히 페이드인 하도록 한다. opacity-0으로 만든 뒤
  // 다음 프레임에 opacity-100으로 바꿔야 transition이 실제로 애니메이션된다(같은 프레임에서
  // 값을 바꾸면 브라우저가 초기 상태를 페인트하지 않고 바로 최종 상태로 건너뛴다).
  if (initiallyVisible) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrapper.classList.remove('opacity-0');
        wrapper.classList.add('opacity-100');
      });
    });
  }
  // F-15: 핀 클릭 시 가격 정보 패널 노출.
  // three-render-objects가 CSS2D 레이어 컨테이너 전체에 pointer-events:none을 걸어 지구본 드래그와
  // 충돌을 막기 때문에, 클릭 가능해야 하는 이 엘리먼트에는 pointer-events-auto를 명시해야 한다.
  // 'click'만 막으면 안 된다 — three-render-objects는 지구본 클릭(레이캐스팅) 판정을
  // pointerdown/pointerup으로 직접 추적하는데, 이 이벤트들은 DOM 위에 핀이 있어도
  // 무시하고 그 아래 지구본 표면을 향해 별도로 히트테스트한다. pointerdown/up까지
  // 막지 않으면 핀 클릭과 "지구본 배경 클릭(선택 해제)"이 거의 동시에 발생해서
  // 방금 선택한 도시가 곧바로 취소돼 버린다(줌이 살짝 시작됐다가 원상복귀되는 것처럼 보임).
  // 브라우저 최대 z-index 한계(2,147,483,647)를 넘지 않도록 안전하게 10억, 20억으로 설정
  const baseAlwaysVisibleZ = 1000000000;
  const baseHoverZ = 2000000000;
  // 더 싼 도시(숫자가 작음)가 더 높은 z-index를 갖도록 뒤집는다.
  const cost = Number(city.totalCost) || 0;
  const costOffset = 100000000 - cost;
  const hoverZIndex = String(baseHoverZ + costOffset);
  const alwaysZIndex = String(baseAlwaysVisibleZ + costOffset);

  // 호버 시 이름이 다른 핀들에 가려지지 않도록 stylesheet !important로 z-index를 강제 격상한다.
  wrapper.addEventListener('pointerenter', () => {
    wrapper.dataset.hovered = 'true';
    elevatePinZ(el, hoverZIndex);
  });
  wrapper.addEventListener('pointerleave', () => {
    wrapper.dataset.hovered = 'false';
    if (wrapper.dataset.alwaysVisible === 'true') {
      elevatePinZ(el, alwaysZIndex);
    } else {
      resetPinZ(el);
    }
  });

  const stop = (e: Event) => e.stopPropagation();
  wrapper.addEventListener('pointerdown', stop);
  wrapper.addEventListener('pointerup', stop);
  wrapper.addEventListener('mousedown', stop);
  wrapper.addEventListener('mouseup', stop);
  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect(city.cityId);
  });
  // 선택된 도시는 화면 정중앙으로 카메라가 정렬되는데(F-11), 커진 핀 마커도 정확히 그
  // 지점에 위치해 커서가 자연스럽게 그 위에 놓인다. 핀 클릭을 받으려면 pointer-events:auto가
  // 필요한데, CSS2DRenderer가 만드는 핀 레이어는 캔버스의 형제(sibling) 노드라서 핀 위에서
  // 발생한 wheel 이벤트는 버블링으로 절대 캔버스(컨트롤)에 도달하지 못한다 — 그 결과
  // "선택한 도시를 확대하려고 스크롤"하는 가장 흔한 동작에서 지구본이 전혀 반응하지 않는
  // 것처럼 보였다. 핀 위의 휠 이벤트를 가로채 같은 값으로 캔버스에 다시 발사해 정상적으로
  // 확대/축소되게 한다.
  wrapper.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      forwardWheel(e);
    },
    { passive: false },
  );

  anchor.appendChild(wrapper);
  el.appendChild(anchor);
  return { root: el, wrapper };
}

export default function GlobeView({ cities, countries }: GlobeViewProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const selectedCityId = useAppStore((s) => s.selectedCityId);
  const selectedCountryId = useAppStore((s) => s.selectedCountryId);
  const selectCity = useAppStore((s) => s.selectCity);
  const viewResetNonce = useAppStore((s) => s.viewResetNonce);
  const [countryFeatures, setCountryFeatures] = useState<CountryFeature[]>([]);
  const [minTier, setMinTier] = useState<1 | 2 | 3>(() => tierForAltitude(DEFAULT_ALTITUDE));
  const [arcsActive, setArcsActive] = useState(false);
  const arcStartTimeoutRef = useRef<number | undefined>(undefined);
  const arcEndTimeoutRef = useRef<number | undefined>(undefined);
  // 트리거가 겹칠 때(예: 로고를 빠르게 여러 번 클릭) 오래된 타이머의 콜백이 나중에
  // 실행돼 최신 트리거를 덮어써 버리는 것을 막는 세대 번호. 매 트리거마다 증가시키고,
  // 콜백 실행 시점에 세대가 그대로인 경우에만(= 그 사이 더 최신 트리거가 없었을 때만) 반영한다.
  const arcPulseGenerationRef = useRef(0);
  const tileEngineRef = useRef<TileEngineLike | null>(null);

  const countryById = useMemo(() => {
    const map = new Map<string, Country>();
    countries.forEach((c) => map.set(c.countryId, c));
    return map;
  }, [countries]);

  const cityById = useMemo(() => {
    const map = new Map<string, CityWithCost>();
    cities.forEach((c) => map.set(c.cityId, c));
    return map;
  }, [cities]);

  // F-09: 국가 윤곽선. world-atlas countries-50m.json(약 750KB)을 topojson→GeoJSON으로
  // 변환하는 작업 자체가 동기적으로 무거워서, 마운트 직후 곧바로 시작하면 초기 카메라
  // pointOfView 트윈(TWEEN.js, 실제 경과 시간 기준으로 진행)이 그 사이 여러 프레임을
  // 못 그리고 건너뛴 뒤 한 번에 따라잡아 "지구본이 잠깐 멈췄다가 훅 움직이는" 렉으로
  // 보였다. 초기 화면엔 하이라이트할 국가가 없어 이 데이터가 당장 필요하지 않으므로,
  // 브라우저가 한가할 때(requestIdleCallback)까지 미뤄 초기 카메라 애니메이션과 메인
  // 스레드를 두고 경쟁하지 않게 한다. 사파리는 requestIdleCallback이 없어 타임아웃으로 대체.
  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const scheduleIdle = win.requestIdleCallback
      ? (cb: () => void) => win.requestIdleCallback!(cb, { timeout: 2000 })
      : (cb: () => void) => window.setTimeout(cb, 500);
    const cancelIdle = win.cancelIdleCallback ?? window.clearTimeout;
    const handle = scheduleIdle(() => {
      loadCountryFeatures()
        .then(setCountryFeatures)
        .catch(() => setCountryFeatures([]));
    });
    return () => cancelIdle(handle);
  }, []);

  // 검색/선택된 국가(또는 선택된 도시가 속한 국가)의 국경선만 하이라이트
  const highlightedCountryId = selectedCountryId ?? (selectedCityId ? cityById.get(selectedCityId)?.countryId : undefined);
  const highlightedFeature = useMemo(() => {
    if (!highlightedCountryId || countryFeatures.length === 0) return undefined;
    const country = countryById.get(highlightedCountryId);
    if (!country) return undefined;
    const feature = findCountryFeature(countryFeatures, country.countryId, country.nameEn);
    // 러시아 등 복잡한 국가의 폴리곤 메시 생성 비용을 줄이기 위해 좌표를 간소화한다.
    return feature ? simplifyFeature(feature) : undefined;
  }, [highlightedCountryId, countryFeatures, countryById]);

  const polygons = useMemo(() => (highlightedFeature ? [highlightedFeature] : []), [highlightedFeature]);

  // F-07 카메라 프레이밍(중심/고도)을 국경 GeoJSON에서 계산한 값으로 대체한다.
  // mockData.ts의 손튜닝 값(center/fitAltitude)은 GeoJSON이 아직 로드되지 않은 첫
  // 순간에만 임시 대체값으로 쓰인다.
  const fitViewByCountryId = useMemo(() => {
    const map = new Map<string, { center: { lat: number; lng: number }; fitAltitude: number }>();
    if (countryFeatures.length === 0) return map;
    countries.forEach((country) => {
      const feature = findCountryFeature(countryFeatures, country.countryId, country.nameEn);
      const computed = feature && computeFitView(feature);
      if (computed) map.set(country.countryId, computed);
    });
    return map;
  }, [countryFeatures, countries]);

  const resolveFitView = useCallback(
    (country: Country) => {
      const computed = fitViewByCountryId.get(country.countryId);
      if (!computed) {
        return { lat: country.center.lat, lng: country.center.lng, fitAltitude: country.fitAltitude };
      }
      return { lat: computed.center.lat, lng: computed.center.lng, fitAltitude: computed.fitAltitude };
    },
    [fitViewByCountryId],
  );

  // F-03: 도시가 이 조건을 만족하면 보여야 한다 — 하이라이트된 국가나 선택된 도시는
  // 등급과 무관하게 항상 보여준다(특정 국가를 검색해서 봤는데 그 나라 도시가 안 보이면 안 된다).
  // 예전엔 이 필터로 htmlElementsData 배열 자체를 걸렀는데, 그러면 등급 미달 도시의 핀
  // DOM이 즉시 파괴돼 사라지는 게 뚝뚝 끊겨 보였다. 이제 데이터는 항상 cities 전체를
  // 넘기고, 아래 pin 표시 상태 effect가 opacity를 페이드시킨 뒤에만 실제로 숨긴다.
  const shouldShowCity = useCallback(
    (c: CityWithCost) =>
      getCityTier(c.cityId) >= minTier || c.cityId === selectedCityId || c.countryId === highlightedCountryId,
    [minTier, selectedCityId, highlightedCountryId],
  );
  // htmlElement 접근자(아래)는 참조 안정성 때문에 shouldShowCity를 직접 의존성으로 잡을 수
  // 없다 — 그래서 렌더마다(effect가 아니라 렌더 본문에서 직접) ref를 최신값으로 갱신해두고,
  // 핀이 실제로 "생성되는 시점"에 그 시점 기준 최신 판정을 ref로 읽어 쓴다.
  const shouldShowCityRef = useRef(shouldShowCity);
  shouldShowCityRef.current = shouldShowCity;

  // 카메라 effect가 좌표 조회에 쓰는 맵. 맵 자체를 의존성으로 걸면 데이터 배열의
  // "정체성"만 바뀌어도(예: 추후 실제 API refetch) 선택은 그대로인데 카메라가 다시
  // 날아가는 문제가 있어, 렌더마다 ref로 최신 맵을 비춰두고 effect는 선택 id에만 반응한다.
  const lookupsRef = useRef({ cityById, countryById, resolveFitView });
  lookupsRef.current = { cityById, countryById, resolveFitView };

  // 로고 클릭(resetToDefaultView)은 선택 해제와 viewResetNonce 증가를 한 커밋으로 묶어
  // 보낸다. 이때 아래 선택 해제 effect가 "고도만 기본값으로" 카메라 트윈을 먼저 걸고,
  // 곧이어 nonce effect의 서울행 pointOfView가 시작되는데 — three-render-objects는 새
  // 트윈을 시작하기 전에 진행 중이던 트윈을 .end()로 "끝 지점까지 즉시 점프"시킨다.
  // 그 결과 카메라가 한 프레임 만에 도시 줌에서 기본 고도로 튀어 지구본이 깜빡였다.
  // 선택 해제가 로고 리셋의 일부인지(같은 커밋에 nonce도 바뀌었는지)를 이 ref와의
  // 비교로 판별해, 그 경우엔 중간 카메라 명령을 건너뛰고 서울행 트윈 하나만 남긴다.
  // (선택 해제 effect가 nonce effect보다 위에 정의돼 먼저 실행되므로, 그 시점엔 스토어의
  // nonce는 새 값, 이 ref는 아직 옛 값 — 불일치가 곧 "리셋 진행 중" 신호다.)
  const handledResetNonceRef = useRef(useAppStore.getState().viewResetNonce);

  // 카메라가 "움직이는 중"으로 간주되는 마지막 시각(epoch ms). 트윈·펄스·휠/드래그가
  // 각자 자기 지속시간만큼 이 값을 밀어 둔다. 아래 fetch 게이트와 화질 램프가 이 값을
  // 읽어, 카메라가 움직이는 동안에는 타일 작업을 미룬다.
  const busyUntilRef = useRef(0);
  // busy 구간이 끝난 직후 최종 카메라 기준으로 타일을 한 번 갱신하는 타이머.
  const idleRefreshTimerRef = useRef<number | undefined>(undefined);

  // 렌더러 pixel ratio를 필요할 때만 바꾼다(setPixelRatio는 내부적으로 드로잉 버퍼를
  // 재할당하므로 같은 값으로 반복 호출하지 않는다).
  const setPixelRatioSafe = useCallback((ratio: number) => {
    const renderer = globeRef.current?.renderer();
    if (renderer && renderer.getPixelRatio() !== ratio) {
      renderer.setPixelRatio(ratio);
    }
  }, []);

  // 타일 엔진을 찾고(캐시), 최초 1회 필요한 인스턴스 훅을 입힌다. 렌더 effect 외의
  // 지연 콜백(램프 타이머, idle 갱신)에서도 호출되므로, 캐시 미스 시 씬을 다시 뒤져
  // 조용히 no-op로 끝나는 일이 없게 한다.
  //
  // fetch 게이트 훅: three-globe는 카메라가 움직이는 매 프레임 엔진의 updatePov를 직접
  // 호출하고, 그 안에서 현재 시야에 맞물리는 타일을 전부 동기 생성·요청한다. 부스트
  // 레벨(5/6)에서 넓은 영역을 가로지르는 트윈이 걸리면(큰 나라 검색, 최대 축소) 수백 장
  // 규모의 배치가 트윈 도중 메인 스레드를 끊어 먹는다. 그렇다고 이동 중에 minLevel을
  // 잠시 낮출 수도 없다 — 이 엔진은 레벨이 내려가면 상위 레벨 타일을 전부 파괴(deallocate)
  // 해서, 복원할 때 수백 장을 다시 받아야 한다. 대신 busy 동안 updatePov 호출 자체를
  // 삼켜 레벨과 기존 타일은 그대로 동결하고, 카메라가 멈춘 뒤(markCameraBusy의 idle
  // 갱신 타이머) 최종 뷰 기준으로 딱 한 번 갱신한다 — 정지 화면에서의 일회성 배치는
  // 끊길 애니메이션이 없어 체감되지 않는다.
  const resolveTileEngine = useCallback((): TileEngineLike | null => {
    const globe = globeRef.current;
    if (!globe) return tileEngineRef.current;
    let engine = tileEngineRef.current;
    if (!engine) {
      engine = findTileEngine(globe.scene()) ?? null;
      tileEngineRef.current = engine;
    }
    if (!engine) return null;

    if (!(engine as any)._fetchGateHooked) {
      (engine as any)._fetchGateHooked = true;
      const originalUpdatePov = engine.updatePov.bind(engine);
      let lastActiveLevel = engine.level; // 화면에 빈 구멍이 생기지 않도록 보존할 마지막 로딩 완료 레벨

      engine.updatePov = (camera: unknown) => {
        if (Date.now() < busyUntilRef.current) return;
        
        const previousLevelBeforeUpdate = engine.level;
        originalUpdatePov(camera);
        const currentLevel = engine.level;

        // 줌으로 인해 타일 레벨이 변했다면, 직전까지 화면을 채우고 있던 레벨이
        // 가장 안전한(이미 로딩된) 폴백 레벨이 됩니다.
        if (currentLevel !== previousLevelBeforeUpdate) {
          lastActiveLevel = previousLevelBeforeUpdate;
        }

        // GPU 오버드로우(Overdraw) 방지 최적화:
        // three-slippy-map-globe는 줌 인을 할 때 이전 레벨 타일들을 삭제하지 않고 scene에
        // depthWrite=false 상태로 그대로 누적시킵니다. 줌 인을 깊게 할수록 10겹 이상의 타일이 
        // 겹쳐서 렌더링되므로 극심한 GPU 병목(드래그 렉)이 발생합니다.
        // 현재 레벨과, 빈 공간을 메워줄 "가장 최근 활성화 레벨(lastActiveLevel)" 타일만 보이게 하고 나머지는 숨깁니다.
        // 이렇게 하면 스크롤을 빨리 돌려 레벨 5에서 8로 한 번에 건너뛰더라도 
        // 5번 타일(저화질)이 배경으로 계속 남아있어 지도가 깜빡이거나 사라지지 않습니다.
        engine.children.forEach((obj: any) => {
          if (obj._tileLevel === undefined && obj.geometry?.parameters?.phiLength) {
            // SphereGeometry의 phiLength(가로 라디안) 역산으로 타일 레벨을 정확히 판별합니다.
            const widthDeg = (obj.geometry.parameters.phiLength * 180) / Math.PI;
            obj._tileLevel = Math.round(Math.log2(360 / widthDeg));
          }
          if (obj._tileLevel !== undefined) {
            // 기본 베이스가 되는 저해상도 레벨(로딩이 빠르고 바탕을 깔아주는 레벨)은 항상 보이게 유지합니다.
            // 이렇게 하면 줌 아웃이나 초기 로딩 시 파란 구멍(배경)이 생기지 않고 언제나 든든한 배경 역할을 합니다.
            obj.visible =
              obj._tileLevel <= TILE_BOOST_START_LEVEL ||
              obj._tileLevel === currentLevel ||
              obj._tileLevel === lastActiveLevel;
          }
        });
      };
    }

    // (maxLevel 캡을 해제하여 확대를 계속할 때 더 높은 레벨의 선명한 타일을 동적으로 가져올 수 있게 합니다)
    // if (engine.maxLevel !== TILE_BOOST_MAX_LEVEL) engine.maxLevel = TILE_BOOST_MAX_LEVEL;

    // 이방성 필터링 훅: 타일 텍스처가 비스듬한 시야각에서 뭉개지지 않게 한다.
    const renderer = globe.renderer();
    if (renderer && !(engine as any)._anisotropyHooked) {
      (engine as any)._anisotropyHooked = true;
      const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
      const sharpen = (obj: unknown) => {
        const map = (obj as any).material?.map;
        if (map && map.anisotropy < maxAnisotropy) {
          map.anisotropy = maxAnisotropy;
          map.needsUpdate = true;
        }
      };
      engine.children.forEach(sharpen);
      const originalAdd = engine.add.bind(engine);
      engine.add = (...objects: unknown[]) => {
        objects.forEach(sharpen);
        return originalAdd(...objects);
      };
    }
    return engine;
  }, []);

  // 카메라를 ms 동안 busy로 표시하고, busy가 끝난 뒤 최종 뷰 기준 타일 갱신을 예약한다.
  // 겹치는 호출은 더 늦은 종료 시각으로 병합되고, idle 갱신 타이머는 마지막 호출 기준으로
  // 다시 잡힌다(디바운스).
  const markCameraBusy = useCallback((ms: number) => {
    const now = Date.now();
    const until = now + ms;
    if (until > busyUntilRef.current) busyUntilRef.current = until;
    if (idleRefreshTimerRef.current) window.clearTimeout(idleRefreshTimerRef.current);
    idleRefreshTimerRef.current = window.setTimeout(() => {
      const engine = resolveTileEngine();
      const camera = globeRef.current?.camera();
      // 게이트가 열린 시점이므로 updatePov가 그대로 통과해 현재 뷰의 타일을 채운다.
      if (engine && camera) engine.updatePov(camera);
    }, busyUntilRef.current - now + CAMERA_IDLE_BUFFER_MS);

  }, [resolveTileEngine]);

  // F-11: 도시 선택 시 해당 도시가 화면 정중앙에 오도록 카메라 정렬/확대
  useEffect(() => {
    if (!globeRef.current) return;
    if (selectedCityId) {
      const city = lookupsRef.current.cityById.get(selectedCityId);
      if (city) {
        markCameraBusy(1000);
        globeRef.current.pointOfView({ lat: city.lat, lng: city.lng, altitude: CITY_ALTITUDE }, 1000);
      }
      return;
    }
    // F-07: 국가 선택 시 국가 전체가 보이도록 자동 확대
    if (selectedCountryId) {
      const country = lookupsRef.current.countryById.get(selectedCountryId);
      if (country) {
        const view = lookupsRef.current.resolveFitView(country);
        markCameraBusy(1000);
        globeRef.current.pointOfView({ lat: view.lat, lng: view.lng, altitude: view.fitAltitude }, 1000);
      }
      return;
    }
    // 로고 리셋에 의한 선택 해제 — 카메라는 nonce effect(서울행)가 전담한다.
    if (useAppStore.getState().viewResetNonce !== handledResetNonceRef.current) return;
    markCameraBusy(800);
    globeRef.current.pointOfView({ altitude: DEFAULT_ALTITUDE }, 800);
  }, [selectedCityId, selectedCountryId, markCameraBusy]);

  // 기본 화면(서울 중심) + 서울→전체 도시 pulse 아크를 한 번 트리거한다. 카메라
  // 이동(pointOfView)과 아크 pulse 표시 로직을 한 곳에 모아, 마운트 시 최초 1회
  // (onGlobeReady)와 로고 클릭마다(viewResetNonce) 완전히 동일한 동작을 보장한다 —
  // 트리거 경로가 둘로 나뉘어 있으면 그중 하나만 손보고 다른 쪽을 놓치기 쉽다.
  //
  // 카메라가 서울로 다 날아갈 때까지(CAMERA_FLY_MS) 기다린 뒤에야 아크를 켠다 — 지구본이
  // 아직 회전/줌 중일 때 아크가 같이 움직이면 카메라 이동과 아크 자체의 이동이 뒤섞여
  // "볼 때마다 속도가 달라 보이거나 화면 밖으로 씹혀 나가는" 것처럼 보였다.
  // 로고를 연타하는 등 트리거가 겹칠 수 있어 매번 새 "세대" 번호를 발급하고, 지연된 콜백은
  // 실행 시점에 자기 세대가 최신인지 확인한 뒤에만 상태를 바꾼다 — 오래된 트리거의 콜백이
  // 나중에 실행되며 최신 트리거의 애니메이션을 끊어버리는 것을 막기 위함이다. 아크는 항상
  // false로 리셋했다가 다시 true로 켜서, 이전에 재생 중이던(다른 시작 시각의) 아크 객체를
  // 반드시 새로 만들어 처음부터 재생하게 한다.
  //
  // instant=true(마운트 전용)일 땐 카메라를 애니메이션 없이 즉시 서울에 스냅한다.
  // three-globe의 pointOfView 트윈은 실제 경과 시간 기준(TWEEN.js)으로 진행되는데, 마운트
  // 직후엔 국가 GeoJSON 로딩·핀 129개 생성 등 동기 작업이 메인 스레드를 잠깐씩 막아 트윈이
  // 프레임을 건너뛰었다가 한 번에 따라잡는 "멈췄다 훅 움직이는" 렉으로 보였다. 페이지를 막
  // 열었을 때 굳이 기본 위치→서울로 날아가는 모습을 보여줄 필요도 없으므로, 마운트 시점만
  // 애니메이션을 생략해 애초에 방해받을 트윈 자체를 없앤다(로고 클릭 리셋은 여전히 애니메이션).
  const triggerDefaultViewPulse = useCallback((instant = false) => {
    const flyMs = instant ? 0 : CAMERA_FLY_MS;
    // 순서 주의: instant(0ms) 스냅은 pointOfView 안에서 동기적으로 카메라를 옮기며 타일
    // fetch까지 일어나므로, busy 표시(게이트 닫힘)는 그 "다음"이어야 첫 화면 타일이 뜬다.
    // 애니메이션 트윈은 다음 프레임부터 움직이므로 이 순서로도 게이트가 제때 닫힌다.
    // busy 구간은 카메라 이동 + 아크 pulse 재생 전체 — 램프가 pulse를 방해하지 않게 한다.
    globeRef.current?.pointOfView({ lat: SEOUL.lat, lng: SEOUL.lng, altitude: DEFAULT_ALTITUDE }, flyMs);
    markCameraBusy(flyMs + ARC_PULSE_DURATION_MS);
    const generation = ++arcPulseGenerationRef.current;
    if (arcStartTimeoutRef.current) window.clearTimeout(arcStartTimeoutRef.current);
    if (arcEndTimeoutRef.current) window.clearTimeout(arcEndTimeoutRef.current);
    setArcsActive(false);
    arcStartTimeoutRef.current = window.setTimeout(() => {
      if (arcPulseGenerationRef.current !== generation) return;
      setArcsActive(true);
      arcEndTimeoutRef.current = window.setTimeout(() => {
        if (arcPulseGenerationRef.current !== generation) return;
        setArcsActive(false);
      }, ARC_PULSE_DURATION_MS);
    }, flyMs);
  }, [markCameraBusy]);

  // 마운트 시점에는 <Globe>가 onGlobeReady를 호출할 때(아래) 펄스를 딱 한 번 트리거한다
  // — react-globe.gl/three-globe는 내부 레이어(타일 엔진, 아크 레이어 등) 구성이 비동기라,
  // 마운트 직후 바로 arcsData를 채우면 아직 준비 안 된 아크 레이어에 값이 씹혀 첫 실행에서만
  // 광선이 하나도 안 뜨는 문제가 있었다. 로고 클릭(viewResetNonce 증가)은 이미 다 준비된
  // 이후의 이벤트이므로 별문제 없이 바로 트리거한다 — 첫 번째(마운트) 값만 건너뛴다.
  // 마운트 시점의 nonce 값을 고정 캡처해두고, effect 안에서는 그 고정값과 비교만 한다
  // (실행 횟수를 세는 가변 플래그 대신). StrictMode(개발 모드)가 마운트 시 이 effect를
  // setup→cleanup→setup으로 두 번 실행해도 두 번 다 "현재 nonce === 마운트 시 nonce"라는
  // 같은 참을 보고 그냥 건너뛴다 — 실행 횟수 기반 플래그(마운트 후 뒤집혀 유지되는 값)였다면
  // 두 번째 setup이 "이미 처리됨"으로 오인해 진짜 카메라 트윈 + pulse를 불필요하게 한 번 더
  // 쏘고, 그 busy 게이트(~5.3초)가 실제 마운트 pulse의 짧은 게이트를 덮어써 화질 부스트가
  // 5초 넘게 밀리는 원인이 됐다. 로고 클릭으로 nonce가 실제로 바뀌는 경우에만(마운트 값과
  // 달라짐) 정상적으로 한 번 발사된다.
  const mountNonceRef = useRef(viewResetNonce);
  useEffect(() => {
    // 이번 리셋을 처리했다고 기록한다 — 위 선택 해제 effect가 "로고 리셋 진행 중"을
    // 판별하는 기준값. 이후의 순수 선택 해제(배경 클릭 등)는 다시 고도 리셋을 수행한다.
    handledResetNonceRef.current = viewResetNonce;
    if (viewResetNonce === mountNonceRef.current) return;
    triggerDefaultViewPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewResetNonce]);

  // 언마운트 시 남아있는 pulse 타이머 정리.
  useEffect(() => () => {
    if (arcStartTimeoutRef.current) window.clearTimeout(arcStartTimeoutRef.current);
    if (arcEndTimeoutRef.current) window.clearTimeout(arcEndTimeoutRef.current);
  }, []);

  // 서울 → 전체 도시 pulse 아크. arcsActive가 꺼지면(펄스 1회 종료) 배열이 비어 사라진다.
  const pulseArcs = useMemo<PulseArc[]>(() => {
    if (!arcsActive) return [];
    return cities.map((c) => ({ startLat: SEOUL.lat, startLng: SEOUL.lng, endLat: c.lat, endLng: c.lng }));
  }, [arcsActive, cities]);

  // 마운트 시점 고도(기본값) 기준으로 초기 감도를 맞춰둔다. 실제 값은 onZoom에서
  // 매번 현재 고도 기준으로 다시 계산된다. 최대 축소 거리도 여기서 함께 제한하는데,
  // 국가 자동확대(F-07)가 잘리지 않도록 fitAltitude 최댓값에서 파생시킨다.
  useEffect(() => {
    const globe = globeRef.current;
    const controls = globe?.controls();
    if (!controls || !globe) return;
    controls.rotateSpeed = rotateSpeedForAltitude(DEFAULT_ALTITUDE);
    const maxFitAltitude = countries.reduce(
      (max, c) => Math.max(max, resolveFitView(c).fitAltitude),
      DEFAULT_ALTITUDE,
    );
    controls.maxDistance = globe.getGlobeRadius() * (1 + maxFitAltitude + MAX_ALTITUDE_MARGIN);
    // (확대 한계를 해제하여 줌인 시 높은 레벨의 타일을 띄울 수 있게 합니다)
    // controls.minDistance = globe.getGlobeRadius() * (1 + MIN_ALTITUDE);
  }, [countries, resolveFitView]);

  // 렌더러 해상도와 타일 엔진 훅은 react-globe.gl 마운트 타이밍이나 핫 리로드에 따라
  // 누락될 수 있으므로 매 렌더링마다 확실하게 확인한다(엔진 탐색·훅은 resolveTileEngine이
  // 캐시/1회 플래그로 중복 작업을 막는다).
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    // WebGL 렌더러의 픽셀 비율을 디스플레이 DPR에 맞춥니다.
    setPixelRatioSafe(FULL_PIXEL_RATIO);

    resolveTileEngine();
  });

  // 화질 부스트 램프 타이머들. 언마운트 시 idle 갱신·해상도 복원 타이머와 함께 정리.
  const boostTimeoutsRef = useRef<number[]>([]);
  useEffect(() => () => {
    boostTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    if (idleRefreshTimerRef.current) window.clearTimeout(idleRefreshTimerRef.current);
  }, []);

  // 타일 최소 레벨을 한 단계 올리고, 다음 단계를 예약한다. 카메라가 busy면(초기 pulse,
  // 도시/국가 이동 트윈, 사용자 제스처) 그 구간이 끝난 뒤로 스스로를 미룬다 — 벽시계
  // 기준 고정 스케줄이 아니라 실제 유휴 상태를 따라가므로, 램프 도중 사용자가 검색하거나
  // 로고를 눌러도 애니메이션과 타일 배치가 겹치지 않는다.
  // minLevel을 바꾸는 것만으로는 엔진이 타일을 다시 가져오지 않는다 — 레벨 재판정과
  // 타일 fetch는 updatePov 호출 시에만 일어나므로 명시적으로 갱신을 트리거한다.
  const applyBoostLevel = useCallback((level: number) => {
    const now = Date.now();
    if (now < busyUntilRef.current) {
      boostTimeoutsRef.current.push(
        window.setTimeout(() => applyBoostLevel(level), busyUntilRef.current - now + CAMERA_IDLE_BUFFER_MS),
      );
      return;
    }
    const engine = resolveTileEngine();
    const camera = globeRef.current?.camera();
    if (!engine || !camera) {
      // 엔진/카메라가 아직 준비 전이면 이 레벨을 건너뛰지 말고 잠시 뒤 재시도한다 —
      // 조용히 no-op로 끝나면 화질 부스트가 아무 신호 없이 누락된다.
      boostTimeoutsRef.current.push(window.setTimeout(() => applyBoostLevel(level), TILE_BOOST_STEP_MS));
      return;
    }
    engine.minLevel = level;
    engine.updatePov(camera);
    if (level < TILE_BOOST_MAX_LEVEL) {
      boostTimeoutsRef.current.push(
        window.setTimeout(() => applyBoostLevel(level + 1), TILE_BOOST_STEP_MS),
      );
    }
  }, [resolveTileEngine]);

  // 최초 펄스는 한 번만 실행 — 마운트 시점은 instant=true로 애니메이션 없이 서울에 스냅한다.
  // 화질 램프는 바로 시작하되, applyBoostLevel의 busy 대기가 펄스 종료까지 알아서 미룬다.
  const handleGlobeReady = useCallback(() => {
    triggerDefaultViewPulse(true);
    applyBoostLevel(TILE_BOOST_START_LEVEL);
  }, [triggerDefaultViewPulse, applyBoostLevel]);

  // 우리가 만든 핀 엘리먼트를 cityId로 직접 보관한다. document.querySelector로 다시
  // 찾으면 안 된다 — three.js CSS2DRenderer는 핀이 "처음 화면에 보일 때"에야 DOM에
  // 붙이고, three-globe는 지구 뒷면 핀을 컬링하므로 뒷면 핀은 회전해 들어오기 전까지
  // 문서에 존재하지 않는다. 분리(detached) 노드도 classList 조작은 그대로 동작하므로
  // 생성 시점에 참조를 붙잡아 두면 부착 타이밍과 무관하게 항상 전체 핀을 갱신할 수 있다.
  const pinElsRef = useRef(new Map<string, HTMLElement>());

  // 핀 위에서 발생한 wheel을 실제 컨트롤 DOM(캔버스)에 재발사한다 — 상세 설명은
  // buildPinElement 내부 wheel 리스너 주석 참고.
  const forwardWheelToGlobe = useCallback((e: WheelEvent) => {
    const target = globeRef.current?.controls()?.domElement;
    if (!target) return;
    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  // htmlElement 접근자는 반드시 참조가 안정적이어야 한다. three-globe는 이 함수의 참조가
  // 바뀌면(예: 렌더마다 새로 만드는 인라인 함수) 핀 DOM 전체를 캐시 무효화하고 처음부터
  // 다시 만든다 — 도시를 클릭해 selectedCityId가 바뀔 때마다 30개 핀이 전부 파괴되고
  // 재생성되면서 화면이 깨지는 것처럼 보이는 "글리치"의 원인이었다. 선택 여부에 따른
  // 강조 표시는 아래 별도 useEffect에서 기존 엘리먼트를 직접 갱신하는 방식으로 분리한다.
  const htmlElement = useCallback(
    (d: object) => {
      const city = d as CityWithCost;
      const { root, wrapper } = buildPinElement(
        city,
        selectCity,
        shouldShowCityRef.current(city),
        forwardWheelToGlobe,
      );
      wrapper.dataset.tier = String(getCityTier(city.cityId));
      pinElsRef.current.set(city.cityId, wrapper);
      return root;
    },
    [selectCity, forwardWheelToGlobe],
  );

  // 선택된 도시 핀을 강조(마커 확대)한다. 
  // 추가로, 줌이 최대로 확대(minTier === 1)되었을 때는 중요도가 가장 높은 기본 도시(tier === 3)들의 라벨을 항상 노출한다.
  useEffect(() => {
    pinElsRef.current.forEach((wrapper, cityId) => {
      const city = cityById.get(cityId);
      if (!city) return;

      const isSelected = cityId === selectedCityId;
      wrapper.querySelector('.pin-marker')?.classList.toggle('scale-125', isSelected);
      
      const isTier3 = wrapper.dataset.tier === '3';
      const isAlwaysVisible = isSelected || (minTier === 1 && isTier3);
      wrapper.dataset.alwaysVisible = String(isAlwaysVisible);
      
      const label = wrapper.querySelector('.pin-label');
      if (label) {
        label.classList.toggle('opacity-100', isAlwaysVisible);
        label.classList.toggle('opacity-0', !isAlwaysVisible);
      }

      // 항상 보이는 라벨도 다른 핀 위로 떠야 한다.
      // root(el)는 wrapper의 조부모(anchor의 부모)이다.
      const root = wrapper.parentElement?.parentElement;
      if (root) {
        if (isAlwaysVisible) {
          const cost = Number(city.totalCost) || 0;
          const alwaysZIndex = String(1000000000 + (100000000 - cost));
          if (wrapper.dataset.hovered !== 'true') {
            elevatePinZ(root, alwaysZIndex);
          }
        } else if (wrapper.dataset.hovered !== 'true') {
          resetPinZ(root);
        }
      }
    });
  }, [selectedCityId, minTier, cityById]);

  // 마운트 이후(F-03 줌 필터, 국가/도시 하이라이트 변경 등)의 핀 등장/은닉을 갱신한다.
  // 최초 생성 시점의 표시 여부는 buildPinElement가 자체적으로 처리한다(위 htmlElement 참고).
  useEffect(() => {
    pinElsRef.current.forEach((wrapper, cityId) => {
      const city = cityById.get(cityId);
      if (!city) {
        // 데이터에서 사라진 도시의 잔여 엔트리 정리
        pinElsRef.current.delete(cityId);
        return;
      }
      const visible = shouldShowCity(city);
      wrapper.classList.toggle('opacity-0', !visible);
      wrapper.classList.toggle('opacity-100', visible);
      wrapper.classList.toggle('pointer-events-auto', visible);
      wrapper.classList.toggle('pointer-events-none', !visible);
    });
  }, [cityById, shouldShowCity]);

  return (
    <div className="isolate h-full w-full touch-none">
      <Globe
        ref={globeRef}
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        // 고정 해상도 텍스처 한 장 대신 슬리피맵 타일 엔진을 사용한다 — 확대할수록
        // 더 높은 줌 레벨의 위성 타일을 자동으로 불러와 화질이 함께 좋아진다
        // (기존 4096x2048 고정 텍스처는 가까이 확대하면 흐려질 수밖에 없었다).
        globeTileEngineUrl={(x, y, l) =>
          `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`
        }
        htmlElementsData={cities}
        htmlLat={(d) => (d as CityWithCost).lat}
        htmlLng={(d) => (d as CityWithCost).lng}
        htmlAltitude={0}
        htmlElement={htmlElement}
        polygonsData={polygons}
        polygonCapColor={() => 'rgba(125, 211, 252, 0.12)'}
        polygonSideColor={() => 'rgba(125, 211, 252, 0.06)'}
        polygonStrokeColor={() => '#7dd3fc'}
        polygonAltitude={0.005}
        polygonsTransitionDuration={0}
        arcsData={pulseArcs}
        arcStartLat={(d) => (d as PulseArc).startLat}
        arcStartLng={(d) => (d as PulseArc).startLng}
        arcEndLat={(d) => (d as PulseArc).endLat}
        arcEndLng={(d) => (d as PulseArc).endLng}
        // arcStroke를 아예 지정하지 않으면(undefined) three-globe가 굵기 있는 튜브(Mesh)
        // 대신 화면 공간 1px짜리 얇은 THREE.Line으로 그린다 — 참고 예제(react-globe.gl
        // airline-routes 데모)가 쓰는 방식으로, 확대/축소해도 두께가 늘어나지 않는 얇은
        // 광선처럼 보인다.
        arcColor={() => ['rgba(250,204,21,0.15)', '#fef08a']}
        arcAltitudeAutoScale={0.35}
        arcDashLength={ARC_DASH_LENGTH}
        arcDashGap={2.5}
        arcDashInitialGap={ARC_DASH_INITIAL_GAP}
        arcDashAnimateTime={ARC_TRAVEL_TIME_MS}
        // 0 — 트랜지션(길이/색 등 보간)을 끈다. 켜져 있으면 매번 새로 생기는 아크가
        // 트랜지션 도중에 대시 애니메이션과 겹쳐, 클릭할 때마다 광선이 조금씩 다른
        // 속도로 흐르는 것처럼 보였다.
        arcsTransitionDuration={0}
        onGlobeReady={handleGlobeReady}
        onGlobeClick={() => useAppStore.getState().clearSelection()}
        // 하이라이트된 국가 폴리곤이 표면보다 살짝 위에 떠서 레이캐스트를 가로채므로,
        // 폴리곤 클릭도 배경(지구본) 클릭과 동일하게 선택 해제로 처리해야 국경 안팎의
        // 클릭 동작이 일관된다.
        onPolygonClick={() => useAppStore.getState().clearSelection()}
        onZoom={(pov) => {
          console.log('[DEBUG] onZoom', performance.now(), 'altitude', pov.altitude);
          const controls = globeRef.current?.controls();
          if (controls) controls.rotateSpeed = rotateSpeedForAltitude(pov.altitude);

          // 휠/드래그가 이어지는 동안은 카메라를 busy로 표시해 fetch 게이트로 타일
          // 작업(부스트 레벨에서는 수백 장 배치)을 막고, 제스처가 멈춘 뒤
          // markCameraBusy의 idle 갱신이 최종 뷰 기준으로 한 번에 타일을 채운다 —
          // 예전에 여기서 직접 updatePov를 호출해 해결했던 "줌 해도 화질이 안 오르는"
          // 문제도 이 idle 갱신이 그대로 담당한다.
          markCameraBusy(ZOOM_BUSY_MS);

          const nextTier = tierForAltitude(pov.altitude);
          setMinTier((prev) => (prev === nextTier ? prev : nextTier));
        }}
      />
    </div>
  );
}
