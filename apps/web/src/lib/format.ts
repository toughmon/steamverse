export function formatHours(hours: number): string {
  if (hours <= 0) return '0시간';
  if (hours < 1) return `${Math.round(hours * 60)}분`;
  if (hours < 10) return `${hours.toFixed(1).replace(/\.0$/, '')}시간`;
  return `${Math.round(hours).toLocaleString('ko-KR')}시간`;
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export function percent(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : '0%';
}
