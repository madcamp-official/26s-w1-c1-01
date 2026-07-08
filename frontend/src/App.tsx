import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeView from './components/GlobeView';
import SearchBar from './components/SearchBar';
import PricePanel from './components/PricePanel';
import CityDetailPanel from './components/CityDetailPanel';
import RecommendQuiz from './components/RecommendQuiz';
import HelpPanel from './components/HelpPanel';
import { useCitiesData, useCountriesData } from './queries/useCitiesData';
import { useAppStore } from './store/useAppStore';
import { pickRandomCity } from './utils/random';

function App() {
  const {
    data: cities,
    isLoading: citiesLoading,
    isError: citiesError,
    refetch: refetchCities,
  } = useCitiesData();
  const {
    data: countries,
    isLoading: countriesLoading,
    isError: countriesError,
    refetch: refetchCountries,
  } = useCountriesData();

  const selectedCityId = useAppStore((s) => s.selectedCityId);
  const selectedCountryId = useAppStore((s) => s.selectedCountryId);
  const detailOpen = useAppStore((s) => s.detailOpen);
  const selectCity = useAppStore((s) => s.selectCity);
  const resetToDefaultView = useAppStore((s) => s.resetToDefaultView);
  const [quizOpen, setQuizOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const lastRandomCityId = useRef<string | null>(null);

  const countryById = useMemo(
    () => new Map((countries ?? []).map((c) => [c.countryId, c])),
    [countries],
  );

  const selectedCity = useMemo(
    () => (cities ?? []).find((c) => c.cityId === selectedCityId),
    [cities, selectedCityId],
  );
  const selectedCountry = useMemo(() => {
    if (selectedCity) return countryById.get(selectedCity.countryId);
    if (selectedCountryId) return countryById.get(selectedCountryId);
    return undefined;
  }, [selectedCity, selectedCountryId, countryById]);

  const isLoading = citiesLoading || countriesLoading;

  // 트랙패드 핀치 줌 시 브라우저 탭 전체가 확대되는 것을 막는다.
  // 사파리 데스크탑에서는 gesture 이벤트에 preventDefault를 걸면
  // 카메라 줌에 필요한 wheel 이벤트까지 차단되어 확대/축소가 먹통이 되는 버그가 있다.
  // 최신 사파리와 크롬 모두 ctrlKey가 켜진 wheel 이벤트를 막는 것만으로 데스크탑 페이지 줌을 방지할 수 있다.
  // (모바일 기기의 터치 핀치 줌은 GlobeView 컨테이너의 touch-none 클래스로 방지한다)
  useEffect(() => {
    const preventPageZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };

    window.addEventListener('wheel', preventPageZoom, { passive: false });

    return () => {
      window.removeEventListener('wheel', preventPageZoom);
    };
  }, []);

  function handleRandom() {
    if (!cities) return;
    // 현재 선택된 도시를 우선 제외한다 — 같은 도시가 다시 뽑히면 selectCity가 동일 상태
    // 쓰기가 되어 아무 구독자도 반응하지 않아 버튼이 무반응처럼 보인다. 선택이 없을 때는
    // 직전 랜덤 결과와의 연속 중복만 막는다.
    const city = pickRandomCity(cities, selectedCityId ?? lastRandomCityId.current);
    if (!city) return;
    lastRandomCityId.current = city.cityId;
    selectCity(city.cityId);
  }

  // retry: false 설정이라 fetch가 한 번 실패하면 자동 재시도가 없다 — 에러 분기 없이
  // `!cities` 조건만 있으면 스피너가 영원히 돌게 되므로 명시적인 재시도 UI를 제공한다.
  const isError = citiesError || countriesError;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {isError ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 text-white/70">
          <p className="text-sm">데이터를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.</p>
          <button
            className="rounded-full border border-white/15 bg-[#14161e]/75 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-sky-300"
            onClick={() => {
              if (citiesError) refetchCities();
              if (countriesError) refetchCountries();
            }}
          >
            다시 시도
          </button>
        </div>
      ) : isLoading || !cities || !countries ? (
        // 데이터 fetch는 사실상 즉시 끝나므로 스피너를 띄우면 오히려 한 프레임 깜빡이는
        // 로딩 화면만 보인다 — 준비될 때까지 빈 배경(어두운 화면)을 그대로 둔다.
        null
      ) : (
        <>
          <GlobeView cities={cities} countries={countries} />

          <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-6 p-5 max-[768px]:flex-col max-[768px]:items-stretch max-[768px]:gap-3 max-[768px]:p-4">
            <h1
              className="pointer-events-auto m-0 cursor-pointer whitespace-nowrap text-xl font-bold tracking-tight text-white"
              onClick={resetToDefaultView}
              title="처음 화면으로"
            >
              NomadList
            </h1>
            <div className="pointer-events-auto">
              <SearchBar cities={cities} countries={countries} />
            </div>
            <div className="pointer-events-auto flex gap-2 max-[768px]:justify-end">
              <button
                className="whitespace-nowrap rounded-full border border-white/15 bg-[#14161e]/75 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:border-sky-300"
                onClick={() => setHelpOpen(true)}
              >
                도움말
              </button>
              <button
                className="whitespace-nowrap rounded-full border border-white/15 bg-[#14161e]/75 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:border-sky-300"
                onClick={() => setQuizOpen(true)}
              >
                추천
              </button>
              <button
                className="whitespace-nowrap rounded-full border border-white/15 bg-[#14161e]/75 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition-colors hover:border-sky-300"
                onClick={handleRandom}
              >
                랜덤
              </button>
            </div>
          </header>

          {quizOpen && (
            <RecommendQuiz cities={cities} onClose={() => setQuizOpen(false)} onSelectCity={selectCity} />
          )}
          {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

          {selectedCountry && !selectedCity && (
            <div className="absolute left-7 top-24 z-10 flex flex-col rounded-2xl border border-white/10 bg-[#14161e]/75 px-5 py-3 backdrop-blur-md">
              <span className="text-lg font-bold text-white">{selectedCountry.nameKo}</span>
              <span className="text-xs text-white/50">{selectedCountry.nameEn}</span>
            </div>
          )}

          {selectedCity && <PricePanel city={selectedCity} country={selectedCountry} />}
          {selectedCity && detailOpen && (
            <CityDetailPanel city={selectedCity} country={selectedCountry} />
          )}
        </>
      )}
    </div>
  );
}

export default App;
