import { useEffect, useRef, useState } from 'react';
import type { CityWithCost } from '../types';
import type { BudgetAnswer, ClimateAnswer, QuizAnswers, RegionAnswer } from '../utils/recommend';
import { recommendCities } from '../utils/recommend';
import { formatKRW } from '../utils/format';
import { GRADE_COLOR, GRADE_LABEL, GRADE_SYMBOL } from '../utils/pinColor';

interface RecommendQuizProps {
  cities: CityWithCost[];
  onClose: () => void;
  onSelectCity: (cityId: string) => void;
}

interface Question<T extends string> {
  id: keyof QuizAnswers;
  text: string;
  options: { value: T; label: string }[];
}

const QUESTIONS: [Question<BudgetAnswer>, Question<ClimateAnswer>, Question<RegionAnswer>] = [
  {
    id: 'budget',
    text: '이번 여행, 예산대는 어느 쪽에 가까운가요?',
    options: [
      { value: 'LOW', label: '가성비 좋게' },
      { value: 'MID', label: '적당한 예산으로' },
      { value: 'HIGH', label: '럭셔리하게' },
    ],
  },
  {
    id: 'climate',
    text: '선호하는 날씨는 무엇인가요?',
    options: [
      { value: 'TROPICAL', label: '따뜻한 남국' },
      { value: 'TEMPERATE', label: '온화한 날씨' },
      { value: 'COLD', label: '시원한 곳' },
    ],
  },
  {
    id: 'region',
    text: '어느 대륙이 끌리시나요?',
    options: [
      { value: 'ASIA', label: '아시아' },
      { value: 'EUROPE', label: '유럽' },
      { value: 'AMERICAS_OCEANIA', label: '아메리카 · 오세아니아' },
    ],
  },
];

export default function RecommendQuiz({ cities, onClose, onSelectCity }: RecommendQuizProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>({});
  const [results, setResults] = useState<CityWithCost[] | null>(null);
  const lastAnswerAt = useRef(0);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function handleAnswer(questionId: keyof QuizAnswers, value: string) {
    // 더블클릭하면 두 번째 클릭이 리렌더된 다음 질문의 같은 위치 버튼에 떨어져
    // 질문 하나를 건너뛰게 되므로, 연속 응답 사이에 짧은 간격을 강제한다.
    const now = Date.now();
    if (now - lastAnswerAt.current < 300) return;
    lastAnswerAt.current = now;

    const next = { ...answers, [questionId]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      setResults(recommendCities(cities, next as QuizAnswers));
    }
  }

  const question = QUESTIONS[step];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#14161e] p-6 shadow-2xl">
        <button
          className="absolute right-4 top-4 border-none bg-transparent text-xl leading-none text-white/50"
          onClick={onClose}
          aria-label="닫기"
        >
          ×
        </button>

        {!results ? (
          <>
            <p className="mb-1 text-xs font-semibold text-sky-300">
              추천 퀴즈 · {step + 1}/{QUESTIONS.length}
            </p>
            <h2 className="mb-6 text-lg font-bold text-white">{question.text}</h2>
            <div className="flex flex-col gap-3">
              {question.options.map((opt) => (
                <button
                  key={opt.value}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-medium text-white transition-colors hover:border-sky-300 hover:bg-sky-300/10"
                  onClick={() => handleAnswer(question.id, opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-1 text-lg font-bold text-white">이런 도시는 어때요?</h2>
            <p className="mb-6 text-xs text-white/50">응답을 바탕으로 3곳을 골라봤어요</p>
            <div className="flex flex-col gap-3">
              {results.map((city) => (
                <button
                  key={city.cityId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-2 pr-4 text-left transition-colors hover:border-sky-300 hover:bg-sky-300/10"
                  onClick={() => {
                    onSelectCity(city.cityId);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-4">
                    <img
                      src={city.imageUrl ?? `https://picsum.photos/seed/${city.cityId}/640/360`}
                      alt={`${city.nameKo} 사진`}
                      className="h-16 w-24 shrink-0 rounded-lg object-cover shadow-sm"
                    />
                    <div>
                      <div className="font-bold text-white text-base">{city.nameKo}</div>
                      <div className="text-xs text-white/50 mt-0.5">{city.nameEn}</div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold text-[#05060a]"
                      style={{ background: GRADE_COLOR[city.pinColor] }}
                    >
                      {GRADE_SYMBOL[city.pinColor]} {GRADE_LABEL[city.pinColor]}
                    </span>
                    <span className="text-xs text-white/70">{formatKRW(city.totalCost)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
