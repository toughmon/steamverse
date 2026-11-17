import type { OntologyGraph } from '@steamverse/shared';
import type { Planet, World } from './world';

/**
 * 퀘스트 = "이 행성에 가 보세요". 안 해 본(또는 잠깐만 해 본) 게임 중에서
 * 많이 한 게임과 닮았거나 친구가 가진 게임을 고른다.
 */
export interface Quest {
  planet: Planet;
  kind: 'backlog' | 'revisit';
  reasons: string[];
}

export function questCandidates(graph: OntologyGraph, world: World): Quest[] {
  const out: (Quest & { score: number })[] = [];
  for (const p of world.planets) {
    const status = p.node.game!.status;
    if (status !== 'backlog' && status !== 'tried') continue;
    const edges = graph.adjacency.get(p.id) ?? [];

    // 가장 닮은, 많이 한 게임
    let anchor: { label: string; sim: number; score: number } | null = null;
    for (const e of edges) {
      if (e.rel !== 'similarTo') continue;
      const other = graph.nodeById.get(e.source === p.id ? e.target : e.source);
      if (!other?.game || other.hours < 10) continue;
      const sim = e.weight ?? 0;
      const score = sim * Math.log10(1 + other.hours);
      if (!anchor || score > anchor.score) anchor = { label: other.label, sim, score };
    }
    const friends = edges.filter((e) => e.rel === 'owns' && e.source !== graph.meId && e.target === p.id).length;

    const reasons: string[] = [];
    if (anchor) reasons.push(`${anchor.label}와(과) 닮음 · ${Math.round(anchor.sim * 100)}%`);
    if (friends > 0) reasons.push(`친구 ${friends}명이 가진 게임`);
    if (status === 'tried') reasons.push(`${Math.round(p.node.hours * 10) / 10}시간 해 보고 멈춤`);
    if (reasons.length === 0) reasons.push('아직 한 번도 플레이하지 않음');

    const score = (anchor?.score ?? 0) * 2 + friends * 0.6 + (status === 'backlog' ? 1 : 0);
    out.push({ planet: p, kind: status === 'backlog' ? 'backlog' : 'revisit', reasons, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
