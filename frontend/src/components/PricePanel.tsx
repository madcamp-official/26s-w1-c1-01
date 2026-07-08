import type { CityWithCost, Country } from '../types';
import { GRADE_COLOR, GRADE_LABEL, GRADE_SYMBOL, STAY_NIGHTS } from '../utils/pinColor';
import { formatKRW } from '../utils/format';
import { useAppStore } from '../store/useAppStore';

interface PricePanelProps {
  city: CityWithCost;
  country: Country | undefined;
}

export default function PricePanel({ city, country }: PricePanelProps) {
  const openDetail = useAppStore((s) => s.openDetail);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const hasData = city.totalCost != null;

  return (
    <div className="absolute bottom-7 left-7 z-10 w-[min(340px,calc(100vw-56px))] rounded-2xl border border-white/10 bg-[#14161e]/90 p-5 shadow-2xl backdrop-blur-lg max-[768px]:inset-x-4 max-[768px]:bottom-4 max-[768px]:w-auto">
      <button
        className="absolute right-1.5 top-1.5 border-none bg-transparent p-1 text-lg leading-none text-white/50"
        onClick={clearSelection}
        aria-label="닫기"
      >
        ×
      </button>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl">{city.nameKo}</h2>
          <span className="text-xs text-white/50">
            {country?.nameKo ?? city.countryId} · {city.nameEn}
          </span>
        </div>
        <span
          className="flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold text-[#05060a]"
          style={{ background: GRADE_COLOR[city.pinColor] }}
          title={GRADE_LABEL[city.pinColor]}
        >
          {GRADE_SYMBOL[city.pinColor]} {GRADE_LABEL[city.pinColor]}
        </span>
      </div>

      {hasData ? (
        <>
          <dl className="mb-3 flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <dt className="text-white/60">식비 (1일)</dt>
              <dd className="m-0 font-semibold">{formatKRW(city.mealPrice)}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-white/60">숙박 (1박 가격)</dt>
              <dd className="m-0 font-semibold">
                {formatKRW(city.stayPrice != null ? Math.round(city.stayPrice / STAY_NIGHTS) : null)}
              </dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-white/60">항공 (왕복 최저가)</dt>
              <dd className="m-0 font-semibold">{formatKRW(city.flightPrice)}</dd>
            </div>
          </dl>
          <div className="mb-4 flex items-baseline justify-between border-t border-white/10 pt-3 text-sm text-white/70">
            <span>총 예상 비용 (7박 8일)</span>
            <strong className="text-lg text-white">{formatKRW(city.totalCost)}</strong>
          </div>
          <button
            className="w-full rounded-lg border-none bg-sky-300 py-3 text-sm font-bold text-[#05060a]"
            onClick={openDetail}
          >
            자세한 정보
          </button>
        </>
      ) : (
        <div className="text-sm text-white/60">
          <p className="mb-4">가격 정보를 준비 중입니다.</p>
          <button
            className="w-full cursor-not-allowed rounded-lg border-none bg-white/15 py-3 text-sm font-bold text-white/40"
            disabled
          >
            자세한 정보
          </button>
        </div>
      )}
    </div>
  );
}
