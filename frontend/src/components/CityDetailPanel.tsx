import type { CityWithCost, Country } from '../types';
import { formatKRW } from '../utils/format';
import { useAppStore } from '../store/useAppStore';
import { ALARM_INFO, KOREA_BIGMAC_KRW } from '../utils/travelAdvisory';

interface CityDetailPanelProps {
  city: CityWithCost;
  country: Country | undefined;
}

// 생필품 가격은 실제 물가 API가 붙기 전까지 1인 1일 식비 기준 배율로 추정한 목업치.
function necessitiesBreakdown(mealPrice: number) {
  return [
    { label: '생수 (500ml)', price: Math.round(mealPrice * 0.03) },
    { label: '대중교통 1회', price: Math.round(mealPrice * 0.06) },
    { label: '카페 커피 한 잔', price: Math.round(mealPrice * 0.15) },
    { label: '현지 맥주 1병', price: Math.round(mealPrice * 0.12) },
  ];
}

// 환율 고시 단위(예: JPY(100), VND(1,000))는 통화별 스케일 차이가 커서 프런트가
// 추측(자릿수 기준 반올림)하지 않고 백엔드가 내려준 exchangeRateUnit을 그대로 쓴다.
function formatExchangeRate(unit: number, rate: number, currencyCode: string) {
  return `${unit.toLocaleString('ko-KR')} ${currencyCode} = ${formatKRW(rate)}`;
}

export default function CityDetailPanel({ city, country }: CityDetailPanelProps) {
  const closeDetail = useAppStore((s) => s.closeDetail);

  const alarm = ALARM_INFO[country?.alarmLevel ?? 0];
  const bigMac = country?.bigMac;
  const bigMacDiffPct = bigMac != null ? Math.round(((bigMac - KOREA_BIGMAC_KRW) / KOREA_BIGMAC_KRW) * 100) : null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end max-[768px]:items-end">
      <div className="absolute inset-0 bg-black/35" onClick={closeDetail} />
      <div className="relative h-full w-[380px] max-w-full animate-[slide-in-right_0.25s_ease] overflow-y-auto border-l border-white/10 bg-[#14161e] max-[768px]:h-auto max-[768px]:max-h-[85vh] max-[768px]:w-full max-[768px]:animate-[slide-in-up_0.25s_ease] max-[768px]:rounded-t-[20px] max-[768px]:border-l-0 max-[768px]:border-t">
        <div className="mx-auto mt-3 hidden h-1 w-10 rounded-full bg-white/25 max-[768px]:block" />

        <div className="relative">
          <img
            src={`https://picsum.photos/seed/${city.cityId}/640/360`}
            alt={`${city.nameKo} 대표 이미지`}
            className="h-44 w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#14161e] via-transparent to-transparent" />
          <button
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-xl leading-none text-white"
            onClick={closeDetail}
            aria-label="닫기"
          >
            ×
          </button>
          <div className="absolute bottom-2 left-5">
            <h3 className="m-0 text-xl font-bold text-white drop-shadow">{city.nameKo}</h3>
            <p className="m-0 text-xs text-white/70">
              {country?.nameKo ?? city.countryId} · {city.nameEn}
            </p>
          </div>
        </div>

        <div className="p-6 pt-5">
          {/* 물가 정보 (환율 / 빅맥지수 / 생필품) */}
          <section className="mb-6">
            <h4 className="mb-3 text-sm font-bold text-white/90">물가 정보</h4>
            <div className="mb-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm text-white/60">환율</span>
              <strong className="text-sm text-white">
                {country
                  ? formatExchangeRate(country.exchangeRateUnit, country.exchangeRate, country.currencyCode)
                  : '정보 없음'}
              </strong>
            </div>
            <div className="mb-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-sm text-white/60">빅맥지수</span>
              <div className="text-right">
                <strong className="block text-sm text-white">{bigMac != null ? formatKRW(bigMac) : '정보 없음'}</strong>
                {bigMacDiffPct != null && (
                  <span
                    className={`text-xs ${
                      bigMacDiffPct > 0 ? 'text-red-400' : bigMacDiffPct < 0 ? 'text-emerald-400' : 'text-white/50'
                    }`}
                  >
                    {bigMacDiffPct > 0
                      ? `한국 대비 ${bigMacDiffPct}% 비쌈`
                      : bigMacDiffPct < 0
                        ? `한국 대비 ${Math.abs(bigMacDiffPct)}% 저렴`
                        : '한국과 비슷한 수준'}
                  </span>
                )}
              </div>
            </div>

            {city.mealPrice != null && (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {necessitiesBreakdown(city.mealPrice).map((row) => (
                  <li key={row.label} className="flex justify-between border-b border-white/10 py-2 text-sm">
                    <span className="text-white/70">{row.label}</span>
                    <strong>{formatKRW(row.price)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 외교부 여행경보 */}
          <section>
            <h4 className="mb-3 text-sm font-bold text-white/90">외교부 여행경보</h4>
            <div className="mb-3 flex items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-xs font-bold"
                style={{ background: alarm.color, color: alarm.textColor }}
              >
                {alarm.label}
              </span>
            </div>
            <p className="m-0 mb-3 text-sm leading-relaxed text-white/70">{alarm.description}</p>

            {country?.specialAdvisory && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
                <p className="m-0 mb-1 text-xs font-bold text-red-400">⚠ 특별여행주의보 발령 중</p>
                <p className="m-0 text-xs leading-relaxed text-white/80">{country.specialAdvisory}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
