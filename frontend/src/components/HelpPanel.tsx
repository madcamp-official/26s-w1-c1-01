import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { GRADE_COLOR, GRADE_LABEL, GRADE_SYMBOL } from '../utils/pinColor';

interface HelpPanelProps {
  onClose: () => void;
}

interface HelpItem {
  label: string;
  body: ReactNode;
  visual?: ReactNode;
}

const pillButton = (text: string) => (
  <span className="inline-block whitespace-nowrap rounded-full border border-white/15 bg-[#14161e] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm">
    {text}
  </span>
);

const BUTTON_ITEMS: HelpItem[] = [
  {
    label: '검색창',
    body: '도시/국가 이름으로 검색해 바로 이동합니다.',
    visual: (
      <div className="flex w-full max-w-[200px] items-center rounded-full border border-white/15 bg-[#14161e] px-4 py-2 text-xs text-white/45">
        <svg className="mr-2 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        도시, 국가 검색
      </div>
    ),
  },
  {
    label: '추천',
    body: '예산 · 날씨 · 선호 대륙 3가지 질문에 답하면 어울리는 도시 3곳을 추천합니다.',
    visual: pillButton('추천'),
  },
  {
    label: '랜덤',
    body: '전체 도시 중 하나를 무작위로 골라 보여줍니다.',
    visual: pillButton('랜덤'),
  },
  {
    label: '도움말',
    body: '지금 보고 있는 이 안내 패널을 엽니다.',
    visual: pillButton('도움말'),
  },
  {
    label: 'NomadList 로고',
    body: '클릭하면 서울을 중심으로 한 처음 화면으로 돌아갑니다.',
    visual: <span className="text-lg font-black tracking-tight text-white drop-shadow-md">NomadList</span>,
  },
  {
    label: '지구본 위 핀',
    body: '색상은 비용 등급을 나타내며, 클릭하면 해당 도시의 예상 비용 요약을 볼 수 있습니다.',
    visual: (
      <span className="flex flex-wrap items-center justify-center gap-3">
        {(['LOW', 'MID', 'HIGH'] as const).map((grade) => (
          <span key={grade} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-full shadow-sm ring-1 ring-white/10"
              style={{ background: GRADE_COLOR[grade] }}
            />
            <span className="text-[11px] font-medium text-white/80">{GRADE_LABEL[grade]}</span>
          </span>
        ))}
      </span>
    ),
  },
];

const INFO_ITEMS: HelpItem[] = [
  {
    label: '총 예상 비용',
    body: '1인 기준, 내일 출발하는 7박 8일 여행(평균 식비 8일치 + 숙박 7박 최저가 + 인천 출발 왕복 항공권 최저가)의 합산 금액입니다.',
    visual: (
      <div className="flex w-full max-w-[220px] items-center justify-center gap-2.5">
        <img
          src="https://picsum.photos/seed/nomadlist-help/160/120"
          alt="도시 예시 사진"
          className="h-12 w-16 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-white/10"
        />
        <div className="flex flex-col text-left">
          <div className="mb-0.5 text-[12px] font-bold text-white whitespace-nowrap">예시 도시</div>
          <div className="mb-0.5 text-[10px] font-medium text-white/50 whitespace-nowrap">총 예상 비용 (7박)</div>
          <div className="text-[12px] font-bold text-sky-400 whitespace-nowrap">1,234,000원</div>
        </div>
      </div>
    ),
  },
  {
    label: '가격 등급',
    body: '전체 도시의 총 예상 비용을 3등분(하위 · 중위 · 상위)해 상대적으로 매긴 등급이며, 도시 목록이 갱신되면 등급도 함께 바뀔 수 있습니다.',
    visual: (
      <span className="flex flex-wrap items-center justify-center gap-2">
        {(['LOW', 'MID', 'HIGH'] as const).map((grade) => (
          <span
            key={grade}
            className="whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold text-[#05060a] shadow-sm"
            style={{ background: GRADE_COLOR[grade] }}
          >
            {GRADE_SYMBOL[grade]} {GRADE_LABEL[grade]}
          </span>
        ))}
      </span>
    ),
  },
  {
    label: '항공권 · 숙박 가격',
    body: (
      <>
        내일 출발하는 7박 8일 일정으로 매시간 자동 수집되는 최저가 기준입니다. 실제 예약 시점과 다를 수 있습니다.
        <div className="mt-1.5 font-medium text-[10px] text-white/40">출처: 네이버 항공권, 네이버 호텔</div>
      </>
    ),
  },
  {
    label: '환율',
    body: (
      <>
        각국 통화 고시 단위 기준 원화 환산 환율입니다.
        <div className="mt-1.5 font-medium text-[10px] text-white/40">출처: 한국수출입은행 환율정보 API</div>
      </>
    ),
  },
  {
    label: '빅맥지수',
    body: (
      <>
        한국 빅맥 가격(5,500원)과 비교해 현지 물가 수준을 직관적으로 가늠할 수 있는 참고 지표입니다.
        <div className="mt-1.5 font-medium text-[10px] text-white/40">출처: The Economist</div>
      </>
    ),
  },
  {
    label: '외교부 여행경보',
    body: (
      <>
        대한민국 외교부 4단계 기준 국가별 경보입니다. 국가 내 가장 위험한 지역 단계를 대표로 표시합니다.
        <div className="mt-1.5 font-medium text-[10px] text-white/40">출처: 공공데이터포털 외교부 여행경보 API</div>
      </>
    ),
  },
];

function HelpItemCard({ item }: { item: HelpItem }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-white/10 bg-white/5 p-3.5 transition-colors hover:bg-white/[0.07]">
      {item.visual && (
        <div className="mb-2.5 flex min-h-[60px] w-full items-center justify-center rounded-lg bg-[#05060a]/60 p-2.5 shadow-inner">
          {item.visual}
        </div>
      )}
      <div className="flex-1 flex flex-col justify-center">
        <dt className="mb-1.5 text-sm font-bold text-sky-300">{item.label}</dt>
        <dd className="m-0 break-keep text-xs leading-relaxed text-white/70">{item.body}</dd>
      </div>
    </div>
  );
}

export default function HelpPanel({ onClose }: HelpPanelProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/10 bg-[#14161e] p-6 shadow-2xl sm:p-8">
        <button
          className="absolute right-4 top-4 border-none bg-transparent text-xl leading-none text-white/50"
          onClick={onClose}
          aria-label="닫기"
        >
          ×
        </button>

        <h2 className="mb-1 text-lg font-bold text-white">NomadList란?</h2>
        <p className="mb-6 break-keep text-sm leading-relaxed text-white/70">
          내일 혼자 여행을 떠나고 싶은 여행자들을 위한 사이트로,<br />
          인천발 직항 도시의 예상 비용(식비 · 숙박 · 항공)과 환율, 외교부 여행경보를 3D 지구본 위에서 한눈에 비교할 수 있는 <span className="whitespace-nowrap">여행 정보 서비스입니다.</span>
        </p>

        <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-3 text-sm font-bold text-white/90">버튼 설명</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {BUTTON_ITEMS.map((item) => (
                <HelpItemCard key={item.label} item={item} />
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-bold text-white/90">정보 기준</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {INFO_ITEMS.map((item) => (
                <HelpItemCard key={item.label} item={item} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
