import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import type { CityWithCost, Country } from '../types';
import { useAppStore } from '../store/useAppStore';

interface SearchBarProps {
  cities: CityWithCost[];
  countries: Country[];
}

type SearchResult =
  | { type: 'country'; id: string; label: string; sub: string }
  | { type: 'city'; id: string; label: string; sub: string };

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 250;
const FUSE_OPTIONS = { threshold: 0.35, ignoreLocation: true };

// 특수문자/숫자만 입력된 경우 검색 미실행 (F-04 예외 처리)
const ONLY_SYMBOLS_OR_DIGITS = /^[\s\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]*$/;

export default function SearchBar({ cities, countries }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectCity = useAppStore((s) => s.selectCity);
  const selectCountry = useAppStore((s) => s.selectCountry);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const countryById = useMemo(() => {
    const map = new Map<string, Country>();
    countries.forEach((c) => map.set(c.countryId, c));
    return map;
  }, [countries]);

  // 퍼지 매칭용 Fuse 인스턴스 (F-04: 오타·유사어에도 결과가 나오도록)
  const fuseCountries = useMemo(
    () => new Fuse(countries, { ...FUSE_OPTIONS, keys: ['nameKo', 'nameEn'] }),
    [countries],
  );
  const fuseCities = useMemo(
    () => new Fuse(cities, { ...FUSE_OPTIONS, keys: ['nameKo', 'nameEn', 'iata'] }),
    [cities],
  );

  const computeResults = useCallback(
    (rawQuery: string): SearchResult[] => {
      const q = rawQuery.trim();
      if (!q || ONLY_SYMBOLS_OR_DIGITS.test(q)) return [];

      const countryMatches: SearchResult[] = fuseCountries
        .search(q)
        .map(({ item }) => ({ type: 'country' as const, id: item.countryId, label: item.nameKo, sub: item.nameEn }));

      const cityMatches: SearchResult[] = fuseCities.search(q).map(({ item }) => ({
        type: 'city' as const,
        id: item.cityId,
        label: item.nameKo,
        sub: `${countryById.get(item.countryId)?.nameKo ?? ''} · ${item.iata}`,
      }));

      return [...countryMatches, ...cityMatches].slice(0, MAX_RESULTS);
    },
    [fuseCountries, fuseCities, countryById],
  );

  const results: SearchResult[] = useMemo(
    () => computeResults(debouncedQuery),
    [computeResults, debouncedQuery],
  );

  useEffect(() => {
    setActiveIndex(-1);
  }, [debouncedQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(result: SearchResult) {
    if (result.type === 'country') {
      selectCountry(result.id);
    } else {
      selectCity(result.id);
    }
    setQuery(result.label);
    setOpen(false);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    setOpen(value.trim().length > 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    // Escape는 결과 유무와 무관하게 항상 드롭다운("결과 없음" 팝업 포함)을 닫아야 한다.
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 디바운스(250ms)가 아직 입력을 따라오지 못한 채 Enter를 치면 results는 이전
      // 질의의 결과라서 엉뚱한 항목이 선택된다. 입력값과 디바운스 값이 다르면 현재
      // 입력값 기준으로 즉석에서 다시 매칭하고, 이때 이전 목록에 대한 activeIndex는
      // 의미가 없으므로 첫 결과를 고른다.
      const isStale = query.trim() !== debouncedQuery.trim();
      const chosen = isStale ? computeResults(query)[0] : (results[activeIndex] ?? results[0]);
      if (chosen) handleSelect(chosen);
      return;
    }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    }
  }

  const showNoResults =
    open && debouncedQuery.trim().length > 0 && !ONLY_SYMBOLS_OR_DIGITS.test(debouncedQuery) && results.length === 0;

  return (
    <div className="relative w-[min(420px,60vw)] max-[768px]:w-full" ref={containerRef}>
      <input
        type="text"
        className="w-full select-text rounded-full border border-white/15 bg-[#14161e]/75 px-4 py-3 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/45 focus:border-sky-300"
        placeholder="국가 또는 도시 검색 (예: 오사카, 일본)"
        value={query}
        onChange={handleChange}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label="국가/도시 검색"
      />
      {open && results.length > 0 && (
        <ul
          className="absolute inset-x-0 top-[calc(100%+8px)] z-10 m-0 max-h-[340px] list-none overflow-y-auto rounded-2xl border border-white/10 bg-[#14161e]/95 p-1.5 shadow-2xl"
          role="listbox"
        >
          {results.map((r, i) => (
            <li
              key={`${r.type}-${r.id}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm ${
                i === activeIndex ? 'bg-white/10' : 'hover:bg-white/10'
              }`}
              onMouseDown={() => handleSelect(r)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="flex-shrink-0 rounded-full bg-sky-300/15 px-2 py-0.5 text-[11px] text-sky-300">
                {r.type === 'country' ? '국가' : '도시'}
              </span>
              <span className="font-semibold text-white">{r.label}</span>
              <span className="ml-auto text-xs text-white/45">{r.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {showNoResults && (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-10 rounded-2xl border border-white/10 bg-[#14161e]/95 p-4 text-center text-sm text-white/50 shadow-2xl">
          검색 결과가 없습니다
        </div>
      )}
    </div>
  );
}
