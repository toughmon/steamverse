/**
 * 탐색기에 보일 노드·엣지 계산. React·sigma에 기대지 않아 화면(메인 스레드)과 그래프 엔진(Worker)이 같이 쓴다.
 */
import { RELATIONS, type ClassId, type OntEdge, type OntNode, type OntologyGraph, type PlayStatus } from '@steamverse/shared';

export interface ViewQuery {
  classes: Record<ClassId, boolean>;
  statuses: Record<PlayStatus, boolean>;
  showInferred: boolean;
  focus: { id: string; depth: number } | null;
}

/** 게임을 숨겼을 때, 같은 게임을 공유하는 두 노드를 직접 잇는 투영 엣지 */
export type SharedEdge = { id: string; source: string; target: string; rel: 'sharesGames'; weight: number };
export type ViewEdge = OntEdge | SharedEdge;


/** 투영 엣지는 노드마다 가장 강한 몇 개만 남긴다 (태그처럼 많은 클래스에서 선이 폭발하지 않게) */
const SHARED_TOP_K = 5;
const SHARED_MIN = 2;

function sharedEdges(graph: OntologyGraph, ids: Set<string>, statuses: Record<PlayStatus, boolean>): SharedEdge[] {
  const pair = new Map<string, number>();
  for (const game of graph.nodes) {
    if (game.cls !== 'Game' || !statuses[game.game!.status]) continue;
    const around = new Set<string>();
    for (const e of graph.adjacency.get(game.id) ?? []) {
      if (e.rel === 'owns' && e.source === graph.meId) continue;
      const other = e.source === game.id ? e.target : e.source;
      if (ids.has(other) && graph.nodeById.get(other)?.cls !== 'Game') around.add(other);
    }
    const list = [...around].sort();
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}|${list[j]}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
      }
  }
  const all = [...pair].filter(([, w]) => w >= SHARED_MIN).sort((a, b) => b[1] - a[1]);
  const used = new Map<string, number>();
  const out: SharedEdge[] = [];
  for (const [key, w] of all) {
    const [a, b] = key.split('|') as [string, string];
    // 둘 중 하나라도 아직 상위 K개를 못 채웠으면 남긴다 → 모든 노드가 최소한 연결된다
    if ((used.get(a) ?? 0) >= SHARED_TOP_K && (used.get(b) ?? 0) >= SHARED_TOP_K) continue;
    used.set(a, (used.get(a) ?? 0) + 1);
    used.set(b, (used.get(b) ?? 0) + 1);
    out.push({ id: `shared:${key}`, source: a, target: b, rel: 'sharesGames', weight: w });
  }
  // 기준(SHARED_MIN)에 못 미쳐 혼자 떠도는 노드는 가장 강한 연결 하나만이라도 남긴다
  for (const [key, w] of [...pair].sort((x, y) => y[1] - x[1])) {
    const [a, b] = key.split('|') as [string, string];
    if (used.has(a) && used.has(b)) continue;
    used.set(a, (used.get(a) ?? 0) + 1);
    used.set(b, (used.get(b) ?? 0) + 1);
    out.push({ id: `shared:${key}`, source: a, target: b, rel: 'sharesGames', weight: w });
  }
  return out;
}

export const DEFAULT_CLASSES: Record<ClassId, boolean> = {
  Game: true,
  Organization: false,
  Franchise: false,
  Genre: true,
  Tag: false,
  Player: false,
};
export const ALL_STATUS: Record<PlayStatus, boolean> = { backlog: true, tried: true, played: true, favorite: true };

/** 보이는 노드·엣지 계산: 클래스·상태 필터 → (포커스 모드면) 선택 노드 중심 n단계 */
export function computeVisible(
  graph: OntologyGraph,
  classes: Record<ClassId, boolean>,
  statuses: Record<PlayStatus, boolean>,
  showInferred: boolean,
  focus: { id: string; depth: number } | null,
): { nodes: OntNode[]; edges: ViewEdge[] } {
  let nodes = graph.nodes.filter((n) => classes[n.cls] && (n.cls !== 'Game' || statuses[n.game!.status]));
  let ids = new Set(nodes.map((n) => n.id));
  let edges: ViewEdge[] = graph.edges.filter(
    (e) =>
      ids.has(e.source) &&
      ids.has(e.target) &&
      (showInferred || !RELATIONS[e.rel].inferred) &&
      // "내가 모든 게임을 보유" 관계는 그래프를 한 점으로 모아버리므로 탐색기에서는 생략
      !(e.rel === 'owns' && e.source === graph.meId),
  );
  // 게임을 숨기면 회사·장르·태그는 서로 직접 이어지지 않는다 → 같은 게임을 공유하는 만큼 잇는다
  if (!classes.Game) edges = [...edges, ...sharedEdges(graph, ids, statuses)];

  if (focus && ids.has(focus.id)) {
    const adj = new Map<string, string[]>();
    const link = (a: string, b: string) => {
      const list = adj.get(a);
      if (list) list.push(b);
      else adj.set(a, [b]);
    };
    for (const e of edges) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    const keep = new Set([focus.id]);
    let frontier = [focus.id];
    for (let d = 0; d < focus.depth; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!keep.has(nb)) (keep.add(nb), next.push(nb));
      frontier = next;
    }
    ids = keep;
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  }

  // 연결이 하나도 없는 비(非)게임 노드는 숨긴다 (예: 게임이 모두 필터된 회사)
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  // 게임을 숨긴 투영 보기에서는 고립된 노드도 남긴다 (사용자가 직접 켠 클래스이므로)
  nodes = nodes.filter((n) => n.cls === 'Game' || !classes.Game || n.id === focus?.id || (degree.get(n.id) ?? 0) > 0);
  return { nodes, edges };
}
