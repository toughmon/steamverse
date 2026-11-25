/**
 * 화면 쪽 엔진 연결.
 * - useGraphEngine: Worker를 띄워 그래프를 만들게 하고, 받은 배열로 '가벼운 그래프'를 만든다
 * - liteGraph: 노드는 객체 그대로, 엣지 객체는 필요할 때만 만든다 (수십만 개를 한꺼번에 만들지 않게)
 */
import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import type { OntEdge, OntologyGraph, PlayerRecord } from '@steamverse/shared';
import { REL_LIST, type EngineApi, type EngineSource, type GraphPayload } from './protocol';

export interface Engine {
  api: Comlink.Remote<EngineApi>;
  payload: GraphPayload;
}

export type EngineState =
  | { phase: 'off' }
  | { phase: 'loading'; startedAt: number }
  | { phase: 'ready'; engine: Engine; graph: OntologyGraph; player: PlayerRecord; buildMs: number; totalMs: number }
  | { phase: 'error'; message: string };

function edgeAt(p: GraphPayload, i: number): OntEdge {
  const source = p.nodes[p.edgeSrc[i]!]!.id;
  const target = p.nodes[p.edgeDst[i]!]!.id;
  const rel = REL_LIST[p.edgeRel[i]!] as OntEdge['rel'];
  const w = p.edgeW[i]!;
  return { id: `${rel}:${source}->${target}`, source, target, rel, weight: Number.isNaN(w) ? undefined : w };
}

/** 노드 id → 엣지 목록을 처음 물을 때 CSR 배열에서 만들어 둔다 */
class LazyAdjacency extends Map<string, OntEdge[]> {
  constructor(
    private p: GraphPayload,
    private index: Map<string, number>,
  ) {
    super();
  }
  override get(id: string): OntEdge[] | undefined {
    const cached = super.get(id);
    if (cached) return cached;
    const i = this.index.get(id);
    if (i === undefined) return undefined;
    const list: OntEdge[] = [];
    for (let k = this.p.incOffsets[i]!; k < this.p.incOffsets[i + 1]!; k++) list.push(edgeAt(this.p, this.p.incEdges[k]!));
    super.set(id, list);
    return list;
  }
  override has(id: string): boolean {
    return this.index.has(id);
  }
}

export function liteGraph(p: GraphPayload): OntologyGraph {
  const index = new Map(p.nodes.map((n, i) => [n.id, i]));
  let edges: OntEdge[] | null = null;
  const graph = {
    meId: p.meId,
    nodes: p.nodes,
    nodeById: new Map(p.nodes.map((n) => [n.id, n])),
    adjacency: new LazyAdjacency(p, index),
    clusters: p.clusters,
    stats: p.stats,
  } as Omit<OntologyGraph, 'edges'> as OntologyGraph;
  // 전체 엣지 목록이 꼭 필요한 화면(다른 탭)만 처음 물을 때 만든다
  Object.defineProperty(graph, 'edges', {
    get: () => (edges ??= Array.from({ length: p.edgeSrc.length }, (_, i) => edgeAt(p, i))),
  });
  return graph;
}

/** source가 있으면 Worker에서 그래프를 만든다. 같은 source(참조)면 다시 만들지 않는다 */
export function useGraphEngine(source: EngineSource | null): EngineState {
  const [state, setState] = useState<EngineState>(source ? { phase: 'loading', startedAt: performance.now() } : { phase: 'off' });
  useEffect(() => {
    if (!source) {
      setState({ phase: 'off' });
      return;
    }
    const startedAt = performance.now();
    setState({ phase: 'loading', startedAt });
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    const api = Comlink.wrap<EngineApi>(worker);
    let alive = true;
    api
      .init(source)
      .then((payload) => {
        if (!alive) return;
        setState({
          phase: 'ready',
          engine: { api, payload },
          graph: liteGraph(payload),
          player: payload.player,
          buildMs: payload.buildMs,
          totalMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((e: unknown) => alive && setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
      api[Comlink.releaseProxy]();
      worker.terminate();
    };
  }, [source]);
  return state;
}
