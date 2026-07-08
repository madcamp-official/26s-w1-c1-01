export function formatKRW(value: number | null): string {
  if (value == null) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}
