import type { OntNode, OntologyGraph, PlayStatus } from '@steamverse/shared';

/**
 * 시그널 탭 공통 색과 데이터 도우미.
 * 색은 dataviz 검증기를 어두운 표면(#06070d) 기준으로 통과한 값만 쓴다:
 * - CAT8: 범주 8색 (고정 순서, 9번째는 만들지 않고 '기타'로 접는다)
 * - STATUS_RAMP: 플레이 상태 순서형 램프 (한 색, 많이 할수록 밝게)
 */
export const CAT8 = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'] as const;
export const OTHER = 'rgba(255,255,255,0.28)';
export const SURFACE = '#06070d';

export const STATUS_ORDER: PlayStatus[] = ['backlog', 'tried', 'played', 'favorite'];
export const STATUS_RAMP: Record<PlayStatus, string> = {
  backlog: '#256abf',
  tried: '#3987e5',
  played: '#86b6ef',
  favorite: '#cde2fb',
};

export function gamesOf(graph: OntologyGraph): OntNode[] {
  return graph.nodes.filter((n) => n.cls === 'Game' && n.game);
}

/** 게임의 첫 번째 개발사·퍼블리셔 이름 (정규화된 회사 노드 라벨) */
export function orgOf(graph: OntologyGraph, gameId: string, rel: 'developedBy' | 'publishedBy'): string | undefined {
  const e = (graph.adjacency.get(gameId) ?? []).find((x) => x.rel === rel && x.source === gameId);
  return e ? graph.nodeById.get(e.target)?.label : undefined;
}

/** 값 순으로 상위 n개만 남기고 나머지 이름은 '기타'로 */
export function topNames(weights: Map<string, number>, n: number): Set<string> {
  return new Set([...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k));
}

export const fmtHours = (h: number) => (h >= 100 ? `${Math.round(h).toLocaleString()}시간` : `${Math.round(h * 10) / 10}시간`);
