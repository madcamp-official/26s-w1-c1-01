import { create } from 'zustand';

interface AppState {
  /** 도시 검색후 페이지 / 핀 클릭(F-11, F-15) 상태 */
  selectedCityId: string | null;
  /** 국가 검색후 페이지(F-07) 상태 */
  selectedCountryId: string | null;
  /** 우측 상세 정보 패널(F-16) 노출 여부 */
  detailOpen: boolean;
  /** NomadList 로고 클릭 등으로 카메라를 새로고침 시점 기본 시점으로 완전히
   *  되돌려야 할 때마다 값을 올린다. GlobeView가 이 값의 변화를 감지해 위경도까지
   *  포함한 전체 리셋을 수행한다(clearSelection은 고도만 되돌리고 회전은 유지한다). */
  viewResetNonce: number;

  selectCity: (cityId: string) => void;
  selectCountry: (countryId: string) => void;
  openDetail: () => void;
  closeDetail: () => void;
  clearSelection: () => void;
  resetToDefaultView: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedCityId: null,
  selectedCountryId: null,
  detailOpen: false,
  viewResetNonce: 0,

  selectCity: (cityId) =>
    set({ selectedCityId: cityId, selectedCountryId: null, detailOpen: false }),
  selectCountry: (countryId) =>
    set({ selectedCountryId: countryId, selectedCityId: null, detailOpen: false }),
  openDetail: () => set({ detailOpen: true }),
  closeDetail: () => set({ detailOpen: false }),
  clearSelection: () =>
    set({ selectedCityId: null, selectedCountryId: null, detailOpen: false }),
  resetToDefaultView: () =>
    set((s) => ({
      selectedCityId: null,
      selectedCountryId: null,
      detailOpen: false,
      viewResetNonce: s.viewResetNonce + 1,
    })),
}));
