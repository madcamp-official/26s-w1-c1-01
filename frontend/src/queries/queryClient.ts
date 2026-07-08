import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 목업 단계에서는 데이터가 정적이라 재요청이 불필요. 실제 배치 캐시 API 연동 시
      // staleTime을 배치 주기(예: 1일)에 맞춰 조정한다.
      staleTime: Infinity,
      retry: false,
    },
  },
});
