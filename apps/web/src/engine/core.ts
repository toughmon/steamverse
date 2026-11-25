/**
 * 그래프 엔진 본체. Worker 안에서 돈다 (DOM·React·sigma 없음 → Node에서도 그대로 측정할 수 있다).
 * - 그래프를 만들고 소유한다
 * - 필터에 맞는 보기를 계산한다
 * - 큰 보기는 배치(취향 군집 씨앗 + ForceAtlas2)까지 끝내 숫자 배열로 돌려준다. 배치는 한 번 하면 기억해 둔다
 */
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { buildOntologyGraph, CLASSES, PLAY_STATUS, type OntNode, type OntologyGraph, type PlayerRecord } from '@steamverse/shared';
import { makeStressLibrary } from '../data/stressLibrary';
import { computeVisible, type ViewQuery } from '../views/explorer/visible';
import { LARGE_VIEW, REL_INDEX, REL_LIST, type EngineSource, type GraphPayload, type LargeView, type ViewResult } from './protocol';

/** 보기 안에서 이웃이 이보다 많은 노드는 허브: 기본 화면에서 그 선들은 빼고 강조할 때만 그린다 */
const HUB_DEGREE = 1200;
/** 기본 화면에 그리는 엣지 상한 */
const BASE_EDGE_BUDGET = 150_000;
/** 처음 배치를 다듬는 ForceAtlas2 시간 예산 */
const LAYOUT_BUDGET_MS = 2500;
const LAYOUT_MAX_ITER = 60;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 대용량 노드 크기: 게임은 1.5~6px, 게임을 묶는 노드(장르·회사 등)는 묶은 수만큼 크게 */
function largeSize(n: OntNode): number {
  return n.cls === 'Game' ? Math.min(6, 1.5 + Math.sqrt(n.hours) * 0.18) : Math.min(16, 4 + Math.sqrt(n.gameCount) * 0.08);
}
const colorOf = (n: OntNode) => (n.cls === 'Game' ? PLAY_STATUS[n.game!.status].color : CLASSES[n.cls].color);

export class GraphEngine {
  private graph!: OntologyGraph;
  private index = new Map<string, number>();
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private placed = new Uint8Array(0);

  init(source: EngineSource): { payload: GraphPayload; transfer: ArrayBuffer[] } {
    const lib = source.kind === 'stress' ? makeStressLibrary(source.count) : source.library;
    const t = performance.now();
    const graph = buildOntologyGraph(lib);
    const buildMs = Math.round(performance.now() - t);
    this.graph = graph;
    const n = graph.nodes.length;
    this.index = new Map(graph.nodes.map((node, i) => [node.id, i]));
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.placed = new Uint8Array(n);

    const E = graph.edges.length;
    const edgeSrc = new Uint32Array(E);
    const edgeDst = new Uint32Array(E);
    const edgeRel = new Uint8Array(E);
    const edgeW = new Float32Array(E);
    const deg = new Uint32Array(n + 1);
    graph.edges.forEach((e, i) => {
      const a = this.index.get(e.source)!;
      const b = this.index.get(e.target)!;
      edgeSrc[i] = a;
      edgeDst[i] = b;
      edgeRel[i] = REL_INDEX.get(e.rel)!;
      edgeW[i] = e.weight ?? NaN;
      deg[a]!++;
      deg[b]!++;
    });
    const incOffsets = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) incOffsets[i + 1] = incOffsets[i]! + deg[i]!;
    const fill = incOffsets.slice(0, n);
    const incEdges = new Uint32Array(E * 2);
    for (let i = 0; i < E; i++) {
      incEdges[fill[edgeSrc[i]!]!++] = i;
      incEdges[fill[edgeDst[i]!]!++] = i;
    }

    const payload: GraphPayload = {
      meId: graph.meId,
      player: lib.player as PlayerRecord,
      nodes: graph.nodes,
      clusters: graph.clusters,
      stats: graph.stats,
      edgeSrc,
      edgeDst,
      edgeRel,
      edgeW,
      incOffsets,
      incEdges,
      buildMs,
    };
    return { payload, transfer: [edgeSrc, edgeDst, edgeRel, edgeW, incOffsets, incEdges].map((a) => a.buffer as ArrayBuffer) };
  }

  view(query: ViewQuery): { result: ViewResult; transfer: ArrayBuffer[] } {
    const t0 = performance.now();
    const graph = this.graph;
    const v = computeVisible(graph, query.classes, query.statuses, query.showInferred, query.focus);
    if (v.nodes.length <= LARGE_VIEW) return { result: { kind: 'small', nodeIds: v.nodes.map((n) => n.id), edges: v.edges }, transfer: [] };

    const m = v.nodes.length;
    const nodeIdx = Uint32Array.from(v.nodes, (node) => this.index.get(node.id)!);
    const viewOf = new Int32Array(graph.nodes.length).fill(-1);
    nodeIdx.forEach((f, i) => (viewOf[f] = i));

    // 보기 안의 엣지를 번호로. 같은 두 노드를 잇는 관계가 여럿이면 하나만 (그리기용)
    const ea: number[] = [];
    const eb: number[] = [];
    const er: number[] = [];
    const deg = new Uint32Array(m);
    const relations = new Set<string>();
    for (const e of v.edges) {
      const a = viewOf[this.index.get(e.source)!]!;
      const b = viewOf[this.index.get(e.target)!]!;
      if (a < 0 || b < 0) continue;
      relations.add(e.rel);
      ea.push(a);
      eb.push(b);
      er.push(REL_INDEX.get(e.rel)!);
      deg[a]!++;
      deg[b]!++;
    }

    const tl = performance.now();
    this.ensureLayout(nodeIdx, ea, eb, er);
    const layoutMs = Math.round(performance.now() - tl);

    // 기본 화면용 엣지: 허브의 부채꼴 선은 뺀다. 닮음(군집을 보여 주는 선)을 먼저 채운다
    const similar = REL_INDEX.get('similarTo')!;
    const seen = new Set<number>();
    const keepA: number[] = [];
    const keepB: number[] = [];
    const keepR: number[] = [];
    for (const pass of [0, 1]) {
      for (let k = 0; k < ea.length && keepA.length < BASE_EDGE_BUDGET; k++) {
        if ((er[k] === similar) !== (pass === 0)) continue;
        const a = ea[k]!;
        const b = eb[k]!;
        if (deg[a]! > HUB_DEGREE || deg[b]! > HUB_DEGREE) continue;
        const key = a < b ? a * m + b : b * m + a;
        if (seen.has(key)) continue;
        seen.add(key);
        keepA.push(a);
        keepB.push(b);
        keepR.push(er[k]!);
      }
    }

    const palette: string[] = [];
    const paletteIdx = new Map<string, number>();
    const x = new Float32Array(m);
    const y = new Float32Array(m);
    const size = new Float32Array(m);
    const colorIdx = new Uint8Array(m);
    v.nodes.forEach((node, i) => {
      const f = nodeIdx[i]!;
      x[i] = this.px[f]!;
      y[i] = this.py[f]!;
      size[i] = largeSize(node);
      const c = colorOf(node);
      let ci = paletteIdx.get(c);
      if (ci === undefined) paletteIdx.set(c, (ci = palette.push(c) - 1));
      colorIdx[i] = ci;
    });

    const result: LargeView = {
      kind: 'large',
      nodeIdx,
      x,
      y,
      size,
      colorIdx,
      palette,
      edgeA: Uint32Array.from(keepA),
      edgeB: Uint32Array.from(keepB),
      edgeRel: Uint8Array.from(keepR),
      relations: REL_LIST.filter((r) => relations.has(r)),
      edgeCount: ea.length,
      layoutMs,
      viewMs: Math.round(performance.now() - t0),
    };
    return { result, transfer: [result.nodeIdx, result.x, result.y, result.size, result.colorIdx, result.edgeA, result.edgeB, result.edgeRel].map((a) => a.buffer as ArrayBuffer) };
  }

  /**
   * 아직 자리가 없는 노드를 배치한다. 한 번 정한 자리는 기억해서 필터를 바꿔도 그림이 흔들리지 않는다.
   * 1) 게임: 취향 군집마다 원판을 해바라기 씨 배열로 놓고 그 안에 흩뿌린다
   * 2) 그 밖의 노드: 이어진 게임들의 무게중심
   * 3) 새로 놓인 노드가 많으면 ForceAtlas2로 다듬는다 (닮음 선이 무리를 만들고, 수만 개가 걸린 허브 선은 거의 당기지 않게)
   */
  private ensureLayout(nodeIdx: Uint32Array, ea: number[], eb: number[], er: number[]) {
    const { graph, px, py, placed } = this;
    const fresh = nodeIdx.filter((f) => !placed[f]);
    if (!fresh.length) return;
    const rand = mulberry32(7);
    const nodes = graph.nodes;

    const freshGames = fresh.filter((f) => nodes[f]!.cls === 'Game');
    if (freshGames.length) {
      const anyPlacedGame = nodes.some((nd, i) => placed[i] && nd.cls === 'Game');
      if (!anyPlacedGame) this.seedByCluster(freshGames, rand);
      else {
        // 군집의 이미 놓인 게임들 근처로
        const sum = new Map<number, { x: number; y: number; n: number }>();
        nodes.forEach((nd, i) => {
          if (!placed[i] || nd.cls !== 'Game' || nd.cluster === undefined) return;
          const s = sum.get(nd.cluster) ?? { x: 0, y: 0, n: 0 };
          s.x += px[i]!;
          s.y += py[i]!;
          s.n++;
          sum.set(nd.cluster, s);
        });
        for (const f of freshGames) {
          const s = sum.get(nodes[f]!.cluster ?? -99);
          px[f] = (s ? s.x / s.n : 0) + (rand() - 0.5) * 30;
          py[f] = (s ? s.y / s.n : 0) + (rand() - 0.5) * 30;
          placed[f] = 1;
        }
      }
    }

    // 게임이 아닌 노드: 이어진(이미 놓인) 게임들의 무게중심
    let extent = 1;
    for (let i = 0; i < px.length; i++) if (placed[i]) extent = Math.max(extent, Math.abs(px[i]!), Math.abs(py[i]!));
    for (const f of fresh) {
      if (placed[f]) continue;
      let x = 0, y = 0, k = 0;
      for (const e of graph.adjacency.get(nodes[f]!.id) ?? []) {
        const o = this.index.get(e.source === nodes[f]!.id ? e.target : e.source)!;
        if (!placed[o] || nodes[o]!.cls !== 'Game') continue;
        x += px[o]!;
        y += py[o]!;
        k++;
      }
      px[f] = k ? x / k + (rand() - 0.5) * 6 : (rand() - 0.5) * extent * 2;
      py[f] = k ? y / k + (rand() - 0.5) * 6 : (rand() - 0.5) * extent * 2;
      placed[f] = 1;
    }

    if (fresh.length < nodeIdx.length / 2) return;
    this.refine(nodeIdx, ea, eb, er);
  }

  private seedByCluster(games: Uint32Array, rand: () => number) {
    const { graph, px, py, placed } = this;
    const size = new Map<number, number>();
    for (const f of games) {
      const c = graph.nodes[f]!.cluster ?? -1;
      size.set(c, (size.get(c) ?? 0) + 1);
    }
    const center = new Map<number, { x: number; y: number; r: number }>();
    let area = 0;
    [...size.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([c, n], i) => {
        const r = Math.sqrt(n) * 1.6;
        // 큰 군집이 가운데, 작은 군집이 바깥으로
        const dist = i === 0 ? 0 : Math.sqrt(area) * 1.15 + r;
        const angle = i * 2.399963;
        center.set(c, { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r });
        area += r * r * 1.35;
      });
    for (const f of games) {
      const ctr = center.get(graph.nodes[f]!.cluster ?? -1)!;
      const t = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * ctr.r;
      px[f] = ctr.x + Math.cos(t) * d;
      py[f] = ctr.y + Math.sin(t) * d;
      placed[f] = 1;
    }
  }

  private refine(nodeIdx: Uint32Array, ea: number[], eb: number[], er: number[]) {
    const { px, py } = this;
    const similar = REL_INDEX.get('similarTo')!;
    const g = new Graph({ type: 'undirected', multi: false });
    nodeIdx.forEach((f, i) => g.addNode(i, { x: px[f], y: py[f] }));
    for (let k = 0; k < ea.length; k++) {
      if (ea[k] === eb[k] || g.hasEdge(ea[k], eb[k])) continue;
      g.addEdge(ea[k], eb[k], { weight: er[k] === similar ? 1 : 0.02 });
    }
    const settings = { ...forceAtlas2.inferSettings(g), linLogMode: true, scalingRatio: 9, gravity: 0.9, strongGravityMode: false, slowDown: 40, barnesHutOptimize: true };
    const start = performance.now();
    let iter = 0;
    // 몇 번씩 나눠 돌리며 시간 예산을 넘지 않게
    while (iter < LAYOUT_MAX_ITER && performance.now() - start < LAYOUT_BUDGET_MS) {
      forceAtlas2.assign(g, { iterations: 3, settings });
      iter += 3;
    }
    g.forEachNode((key, a) => {
      const f = nodeIdx[Number(key)]!;
      px[f] = a.x as number;
      py[f] = a.y as number;
    });
  }
}
