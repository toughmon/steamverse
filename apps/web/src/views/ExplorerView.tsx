import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { createNodeImageProgram } from '@sigma/node-image';
import { createNodeBorderProgram } from '@sigma/node-border';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import {
  CLASSES,
  CLASS_ORDER,
  PLAY_STATUS,
  RELATIONS,
  RELATION_ORDER,
  steamImage,
  type ClassId,
  type OntEdge,
  type OntNode,
  type OntologyGraph,
  type PlayStatus,
  type RelationId,
} from '@steamverse/shared';
import { NodeDetail } from '../components/NodeDetail';
import { SearchBox } from '../components/SearchBox';
import { Toggle } from '../components/Toggle';
import { formatHours } from '../lib/format';
import { LABEL_FONT, curvatureFor, drawDarkHover, drawHaloLabel, edgeStyle, nodeColor, nodeSize, premultiplied } from '../lib/sigmaStyle';

interface Props {
  graph: OntologyGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

type NodeAttrs = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: 'image' | 'glow';
  image?: string;
  /** 빛번짐 고리 색 (premultiplied) */
  halo1?: string;
  halo2?: string;
  cls: ClassId;
};
type EdgeAttrs = { size: number; color: string; type: 'curved'; curvature: number; rel: RelationId | 'sharesGames' };

/** 게임을 숨겼을 때, 같은 게임을 공유하는 두 노드를 직접 잇는 투영 엣지 */
type SharedEdge = { id: string; source: string; target: string; rel: 'sharesGames'; weight: number };
type ViewEdge = OntEdge | SharedEdge;

const SHARED_COLOR = 'rgba(170,186,220,0.26)';

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`;
}
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

const DEFAULT_CLASSES: Record<ClassId, boolean> = {
  Game: true,
  Organization: false,
  Franchise: false,
  Genre: true,
  Tag: false,
  Player: false,
};
const ALL_STATUS: Record<PlayStatus, boolean> = { backlog: true, tried: true, played: true, favorite: true };

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 보이는 노드·엣지 계산: 클래스·상태 필터 → (포커스 모드면) 선택 노드 중심 n단계 */
function computeVisible(
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
    for (const e of edges) {
      adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
      adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
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

/** 할로(빛번짐)를 그릴 자리만큼 노드를 키운다. 안쪽 52%가 실제 점 */
const GLOW_SCALE = 1.9;

/** linLog: 관계가 촘촘한 무리끼리 뭉치고 무리 사이는 벌어져, 격자 같은 딱딱함이 줄어든다 */
function layoutSettings(g: Graph) {
  return { ...forceAtlas2.inferSettings(g), linLogMode: true, scalingRatio: 9, gravity: 0.9, strongGravityMode: false, slowDown: 3 };
}

function runLayout(g: Graph, iterations: number) {
  forceAtlas2.assign(g, { iterations, settings: layoutSettings(g) });
}

export function ExplorerView({ graph, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const fa2Ref = useRef<FA2Layout | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const lastProjected = useRef(false);
  const interaction = useRef<{ hovered: string | null; selected: string | null; neighbors: Set<string> }>({
    hovered: null,
    selected: null,
    neighbors: new Set(),
  });

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [classes, setClasses] = useState(DEFAULT_CLASSES);
  const [statuses, setStatuses] = useState(ALL_STATUS);
  const [showInferred, setShowInferred] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [depth, setDepth] = useState(2);

  const focus = focusMode && selectedId ? { id: selectedId, depth } : null;
  const visible = useMemo(
    () => computeVisible(graph, classes, statuses, showInferred, focus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, classes, statuses, showInferred, focus?.id, focus?.depth],
  );

  const classCounts = useMemo(() => {
    const c = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<ClassId, number>;
    for (const n of graph.nodes) c[n.cls] += 1;
    return c;
  }, [graph]);

  const visibleRelations = useMemo(() => new Set(visible.edges.map((e) => e.rel)), [visible]);

  // ── 이웃 집합 갱신 ────────────────────────────────────────────
  const updateNeighbors = () => {
    const sigma = sigmaRef.current;
    const st = interaction.current;
    const focusId = st.hovered ?? st.selected;
    const g = sigma?.getGraph();
    st.neighbors = focusId && g?.hasNode(focusId) ? new Set(g.neighbors(focusId)) : new Set();
  };

  // ── Sigma 생성 (한 번) ───────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current!;
    const sigma = new Sigma(new Graph(), container, {
      allowInvalidContainer: true,
      defaultNodeType: 'glow',
      defaultEdgeType: 'curved',
      nodeProgramClasses: {
        glow: createNodeBorderProgram({
          borders: [
            { size: { value: 0.26, mode: 'relative' }, color: { attribute: 'halo2' } },
            { size: { value: 0.22, mode: 'relative' }, color: { attribute: 'halo1' } },
            { size: { fill: true }, color: { attribute: 'color' } },
          ],
        }),
        image: createNodeImageProgram({
          size: { mode: 'force', value: 192 },
          drawingMode: 'background',
          keepWithinCircle: true,
          objectFit: 'cover',
          padding: 0.12,
          crossOrigin: 'anonymous',
        }),
      },
      edgeProgramClasses: { curved: createEdgeCurveProgram({ curvatureAttribute: 'curvature', defaultCurvature: 0.2 }) },
      labelFont: LABEL_FONT,
      labelSize: 11.5,
      labelWeight: '500',
      labelColor: { color: '#cbd5e1' },
      defaultDrawNodeLabel: drawHaloLabel,
      labelDensity: 0.6,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 9,
      defaultDrawNodeHover: drawDarkHover,
      zIndex: true,
      stagePadding: 60,
      minCameraRatio: 0.06,
      maxCameraRatio: 3,
      nodeReducer: (node, data) => {
        const st = interaction.current;
        const focusId = st.hovered ?? st.selected;
        const res: Record<string, unknown> = { ...data };
        if (node === st.selected) {
          res.highlighted = true;
          res.forceLabel = true;
          res.zIndex = 3;
        }
        if (focusId) {
          if (node === focusId) {
            res.forceLabel = true;
            res.zIndex = 3;
          } else if (st.neighbors.has(node)) {
            res.forceLabel = true;
            res.zIndex = 2;
          } else {
            // 관계없는 노드는 숨긴다: 흐린 원으로 남기면 강조된 선을 가리고 화면이 지저분해진다
            res.hidden = true;
          }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const st = interaction.current;
        const focusId = st.hovered ?? st.selected;
        if (!focusId) return data;
        const g = sigmaRef.current!.getGraph();
        const [s, t] = g.extremities(edge);
        if (s !== focusId && t !== focusId) return { ...data, hidden: true };
        return { ...data, size: (data.size as number) * 1.6, zIndex: 1, color: (data.color as string).replace(/[\d.]+\)$/, '0.95)') };
      },
    });
    sigmaRef.current = sigma;

    sigma.on('enterNode', ({ node }) => {
      interaction.current.hovered = node;
      updateNeighbors();
      container.style.cursor = 'pointer';
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('leaveNode', () => {
      interaction.current.hovered = null;
      updateNeighbors();
      container.style.cursor = '';
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('clickNode', ({ node }) => onSelectRef.current(node));
    sigma.on('clickStage', () => onSelectRef.current(null));

    // 노드 드래그
    let dragged: string | null = null;
    sigma.on('downNode', ({ node }) => {
      dragged = node;
      if (!sigma.getCustomBBox()) sigma.setCustomBBox(sigma.getBBox());
    });
    const captor = sigma.getMouseCaptor();
    captor.on('mousemovebody', (e) => {
      if (!dragged) return;
      const pos = sigma.viewportToGraph(e);
      const g = sigma.getGraph();
      g.setNodeAttribute(dragged, 'x', pos.x);
      g.setNodeAttribute(dragged, 'y', pos.y);
      positions.current.set(dragged, pos);
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    captor.on('mouseup', () => {
      dragged = null;
    });

    return () => {
      fa2Ref.current?.kill();
      sigma.kill();
      sigmaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 보이는 그래프가 바뀌면 graphology 그래프를 다시 만들고 배치 ──
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    fa2Ref.current?.kill();
    fa2Ref.current = null;

    const g = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false });
    const rand = mulberry32(7);
    const known = positions.current;
    let newcomers = 0;

    for (const n of visible.nodes) {
      const prev = known.get(n.id);
      if (!prev) newcomers += 1;
      const isGame = n.cls === 'Game';
      const color = nodeColor(n);
      g.addNode(n.id, {
        x: prev?.x ?? (rand() - 0.5) * 200,
        y: prev?.y ?? (rand() - 0.5) * 200,
        size: isGame ? nodeSize(n) : nodeSize(n) * GLOW_SCALE,
        color,
        label: n.label,
        type: isGame ? 'image' : 'glow',
        image: isGame ? steamImage(n.game!.appid, 'header') : undefined,
        halo1: isGame ? undefined : premultiplied(color, 0.22),
        halo2: isGame ? undefined : premultiplied(color, 0.08),
        cls: n.cls,
      });
    }
    // 처음 보는 노드는 이미 배치된 이웃 근처에서 출발
    for (const e of visible.edges) {
      if (g.hasEdge(e.source, e.target) || g.hasEdge(e.target, e.source)) continue;
      // 투영 엣지는 출발 노드의 클래스 색을 옅게 입힌다
      const srcColor = CLASSES[graph.nodeById.get(e.source)!.cls].color;
      const style =
        e.rel === 'sharesGames'
          ? {
              size: 0.5 + Math.sqrt(e.weight) * 0.6,
              color: hexAlpha(srcColor, 0.18 + Math.min(0.32, e.weight * 0.025)),
              type: 'curved' as const,
              curvature: curvatureFor(e.id, false),
            }
          : edgeStyle(e);
      g.addEdgeWithKey(e.id, e.source, e.target, { ...style, rel: e.rel });
    }
    g.forEachNode((id, attrs) => {
      if (known.has(id)) return;
      const anchor = g.neighbors(id).find((nb) => known.has(nb));
      if (anchor) {
        const p = known.get(anchor)!;
        g.mergeNodeAttributes(id, { x: p.x + (rand() - 0.5) * 20, y: p.y + (rand() - 0.5) * 20 });
      } else {
        g.mergeNodeAttributes(id, { x: attrs.x, y: attrs.y });
      }
    });

    // 투영 보기는 연결 구조가 완전히 달라서 처음부터 다시 배치한다
    const projected = visible.edges.some((e) => e.rel === 'sharesGames');
    const modeChanged = projected !== lastProjected.current;
    lastProjected.current = projected;
    if (projected || modeChanged) g.forEachNode((id) => g.mergeNodeAttributes(id, { x: (rand() - 0.5) * 200, y: (rand() - 0.5) * 200 }));
    runLayout(g, projected || modeChanged || newcomers > visible.nodes.length / 2 ? 400 : 120);
    g.forEachNode((id, a) => known.set(id, { x: a.x, y: a.y }));

    sigma.setCustomBBox(null);
    sigma.setGraph(g as unknown as Graph);
    // 노드가 적으면 이름을 모두 보여 준다
    sigma.setSetting('labelRenderedSizeThreshold', visible.nodes.length <= 40 ? 0 : 9);
    updateNeighbors();
    sigma.refresh();
    // 노드가 천천히 자리를 잡게 한다. 화면 틀은 그래프 전체를 따라가므로 밖으로 밀려나지 않는다
    settle(1600, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── 선택 반영 ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      interaction.current.selected = null;
      updateNeighbors();
      sigmaRef.current?.refresh({ skipIndexation: true });
      return;
    }
    const node = graph.nodeById.get(selectedId);
    if (!node) return;
    // 숨겨진 클래스·상태의 노드를 고르면 필터를 자동으로 연다.
    // 선택이 바뀔 때만 실행한다. 필터 변경에도 반응하면 사용자가 끈 필터를 곧바로 다시 켜 버린다.
    setClasses((c) => (c[node.cls] ? c : { ...c, [node.cls]: true }));
    if (node.game) {
      const status = node.game.status;
      setStatuses((s) => (s[status] ? s : { ...s, [status]: true }));
    }
  }, [selectedId, graph]);

  /** 선택된 노드를 숨기는 필터를 끄면 선택을 해제한다 */
  const toggleClass = (cls: ClassId, on: boolean) => {
    setClasses((c) => ({ ...c, [cls]: on }));
    if (!on && selectedId && graph.nodeById.get(selectedId)?.cls === cls) onSelect(null);
  };
  const toggleStatus = (status: PlayStatus, on: boolean) => {
    setStatuses((s) => ({ ...s, [status]: on }));
    if (!on && selectedId && graph.nodeById.get(selectedId)?.game?.status === status) onSelect(null);
  };

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    interaction.current.selected = selectedId;
    updateNeighbors();
    sigma.refresh({ skipIndexation: true });
    if (!selectedId || !sigma.getGraph().hasNode(selectedId)) return;
    const d = sigma.getNodeDisplayData(selectedId);
    if (!d) return;
    const camera = sigma.getCamera();
    camera.animate({ x: d.x, y: d.y, ratio: Math.min(camera.ratio, focusMode ? 0.9 : 0.55) }, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, visible]);

  /** 레이아웃 워커를 잠깐 돌려 노드가 움직이며 자리를 잡게 한다 */
  function settle(ms: number, slowDown: number) {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    fa2Ref.current?.kill();
    const g = sigma.getGraph();
    if (g.order === 0) return;
    const layout = new FA2Layout(g, { settings: { ...layoutSettings(g), slowDown } });
    fa2Ref.current = layout;
    layout.start();
    window.setTimeout(() => {
      if (fa2Ref.current !== layout) return;
      layout.kill();
      fa2Ref.current = null;
      g.forEachNode((id, a) => positions.current.set(id, { x: a.x, y: a.y }));
    }, ms);
  }
  const relayout = () => settle(2500, 6);

  const resetCamera = () => sigmaRef.current?.getCamera().animatedReset({ duration: 500 });

  const topGames = useMemo(
    () => graph.nodes.filter((n) => n.cls === 'Game').sort((a, b) => b.hours - a.hours).slice(0, 6),
    [graph],
  );
  const favoriteDevs = useMemo(
    () =>
      graph.edges
        .filter((e) => e.rel === 'favoriteDeveloper')
        .map((e) => graph.nodeById.get(e.target)!)
        .filter(Boolean),
    [graph],
  );

  const solidColor = (c: string) => c.replace(/[\d.]+\)$/, '1)');

  return (
    <div className="flex h-full min-h-0 bg-[#04050a]">
      {/* ── 왼쪽: 필터 ── */}
      <aside className="sv-scroll flex w-[264px] shrink-0 flex-col gap-7 overflow-y-auto border-r border-white/[0.06] bg-[#06070d] px-4 py-5">
        <SearchBox graph={graph} onSelect={(id) => onSelect(id)} />

        <Section title="Classes" sub="노드 유형">
          {CLASS_ORDER.map((cls) => (
            <Toggle
              key={cls}
              checked={classes[cls]}
              onChange={(v) => toggleClass(cls, v)}
              color={CLASSES[cls].color}
              label={CLASSES[cls].label.ko}
              count={classCounts[cls]}
            />
          ))}
        </Section>

        <Section title="Play status" sub="게임 테두리 색">
          {(Object.keys(PLAY_STATUS) as PlayStatus[]).map((s) => (
            <Toggle
              key={s}
              checked={statuses[s]}
              onChange={(v) => toggleStatus(s, v)}
              color={PLAY_STATUS[s].color === '#3b4357' ? '#8b93a7' : PLAY_STATUS[s].color}
              ring
              label={PLAY_STATUS[s].label.ko}
              hint={PLAY_STATUS[s].rule}
              count={graph.stats.byStatus[s]}
            />
          ))}
        </Section>

        <Section title="Relations" sub="관계">
          <Toggle checked={showInferred} onChange={setShowInferred} color="#7fd8ff" label="추론 관계 표시" hint="비슷함 · 선호 개발사" />
          <ul className="mt-2 flex flex-col gap-2 px-2.5">
            {visibleRelations.has('sharesGames') && (
              <li className="flex items-center gap-3 text-[12px] text-white/60">
                <svg width="24" height="8" className="shrink-0">
                  <line x1="1" y1="4" x2="23" y2="4" stroke={SHARED_COLOR.replace(/[\d.]+\)$/, '1)')} strokeWidth="1.25" />
                </svg>
                <span className="flex-1">같은 게임 공유</span>
                <span className="font-mono text-[9.5px] text-white/25">굵기 = 게임 수</span>
              </li>
            )}
            {RELATION_ORDER.filter((r) => visibleRelations.has(r)).map((r) => (
              <li key={r} className="flex items-center gap-3 text-[12px] text-white/60">
                <svg width="24" height="8" className="shrink-0">
                  {RELATIONS[r].inferred ? (
                    <path d="M1 6 Q12 -1 23 6" stroke={solidColor(RELATIONS[r].color)} strokeWidth="1.25" strokeDasharray="2 2.5" fill="none" />
                  ) : (
                    <line x1="1" y1="4" x2="23" y2="4" stroke={solidColor(RELATIONS[r].color)} strokeWidth="1.25" />
                  )}
                </svg>
                <span className="flex-1">{RELATIONS[r].label.ko}</span>
                <span className="font-mono text-[9.5px] text-white/25">{RELATIONS[r].label.en}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="View" sub="보기">
          <Toggle
            checked={focusMode}
            onChange={setFocusMode}
            color="#b69cff"
            label="선택 노드 중심"
            hint={selectedId ? `${depth}단계 이웃만 표시` : '노드를 먼저 선택하세요'}
          />
          {focusMode && (
            <div className="mt-1.5 ml-8 flex w-fit rounded-full border border-white/[0.07] p-0.5">
              {[1, 2, 3].map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`rounded-full px-3 py-1 font-mono text-[10.5px] transition ${depth === d ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/70'}`}
                >
                  {d}-hop
                </button>
              ))}
            </div>
          )}
        </Section>
      </aside>

      {/* ── 가운데: 그래프 ── */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgba(122,162,255,0.07),transparent_60%)]" />
        <div ref={containerRef} className="absolute inset-0" />
        <div className="vignette pointer-events-none absolute inset-0" />

        <div className="glass absolute top-4 right-4 flex flex-col overflow-hidden rounded-xl">
          <CanvasButton title="확대" onClick={() => sigmaRef.current?.getCamera().animatedZoom({ duration: 250 })}>
            <path d="M10 5v10M5 10h10" strokeLinecap="round" />
          </CanvasButton>
          <CanvasButton title="축소" onClick={() => sigmaRef.current?.getCamera().animatedUnzoom({ duration: 250 })}>
            <path d="M5 10h10" strokeLinecap="round" />
          </CanvasButton>
          <CanvasButton title="전체 보기" onClick={resetCamera}>
            <path d="M4 7V4h3M16 7V4h-3M4 13v3h3M16 13v3h-3" strokeLinecap="round" strokeLinejoin="round" />
          </CanvasButton>
          <CanvasButton title="다시 배치" onClick={relayout}>
            <circle cx="6" cy="6" r="1.8" />
            <circle cx="14" cy="8" r="1.8" />
            <circle cx="8" cy="14.5" r="1.8" />
            <path d="M7.6 6.5l4.6 1.1M7.2 12.8l-.6-5M9.6 13.4l3.4-4" strokeLinecap="round" />
          </CanvasButton>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-5 flex items-center gap-4 font-mono text-[10px] tracking-wider text-white/35">
          <span>
            <span className="text-white/70">{visible.nodes.length}</span> NODES
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span>
            <span className="text-white/70">{visible.edges.length}</span> EDGES
          </span>
          <span className="h-3 w-px bg-white/10" />
          <span>SIZE = PLAYTIME · RING = STATUS · STRONG CURVE = INFERRED</span>
        </div>
        <div className="pointer-events-none absolute right-5 bottom-4 font-mono text-[10px] tracking-wider text-white/25">
          DRAG · SCROLL · DRAG NODE TO PIN
        </div>
      </div>

      {/* ── 오른쪽: 상세 ── */}
      <aside className="sv-scroll w-[372px] shrink-0 overflow-y-auto border-l border-white/[0.06] bg-[#06070d] p-4">
        {selectedId && graph.nodeById.has(selectedId) ? (
          <NodeDetail
            graph={graph}
            nodeId={selectedId}
            onSelect={onSelect}
            actions={
              <div className="flex gap-2">
                <button
                  onClick={() => setFocusMode((v) => !v)}
                  className={`flex-1 rounded-xl px-3 py-2.5 text-[12.5px] font-medium transition ${
                    focusMode
                      ? 'bg-[#b69cff]/15 text-[#d8cbff] ring-1 ring-[#b69cff]/30'
                      : 'bg-white/[0.06] text-white/85 ring-1 ring-white/10 hover:bg-white/[0.1]'
                  }`}
                >
                  {focusMode ? '전체 그래프로 돌아가기' : '이 노드 중심으로 보기'}
                </button>
                <button
                  onClick={() => onSelect(null)}
                  title="닫기"
                  aria-label="닫기"
                  className="grid w-10 place-items-center rounded-xl text-white/50 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
                    <path d="M2 2l8 8M10 2l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            }
          />
        ) : (
          <div className="fade-up flex flex-col gap-7 pt-1">
            <div>
              <div className="eyebrow">Knowledge graph</div>
              <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-white">지식 그래프 탐색기</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-white/45">
                게임·회사·시리즈·장르·태그·친구가 온톨로지 관계로 연결돼 있습니다. 노드를 고르면 관계와 RDF 표현을 볼 수 있습니다.
              </p>
            </div>

            <section>
              <h3 className="mb-2.5 flex items-center gap-2">
                <span className="eyebrow">Favorite developers</span>
                <span className="rounded-full border border-sky-300/20 px-1.5 py-px font-mono text-[8.5px] tracking-[0.12em] text-sky-200/70 uppercase">
                  inferred
                </span>
              </h3>
              <div className="flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.07] bg-white/[0.02]">
                {favoriteDevs.map((n, i) => (
                  <button
                    key={n.id}
                    onClick={() => onSelect(n.id)}
                    className="group flex items-center gap-3.5 px-3.5 py-3 text-left transition hover:bg-white/[0.03]"
                  >
                    <span className="font-mono text-[11px] text-[#e6c07b]/80">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1 text-[13px] text-white/80 group-hover:text-white">{n.label}</span>
                    <span className="num font-mono text-[11px] text-white/40">{formatHours(n.hours)}</span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="eyebrow mb-2.5">Most played</div>
              <div className="grid grid-cols-2 gap-2.5">
                {topGames.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => onSelect(n.id)}
                    className="group relative overflow-hidden rounded-xl text-left ring-1 ring-white/[0.08] transition hover:ring-white/25"
                  >
                    <img
                      src={steamImage(n.game!.appid, 'header')}
                      alt=""
                      className="aspect-[460/215] w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                    <span className="num absolute bottom-1.5 left-2 font-mono text-[10.5px] text-white/90">{formatHours(n.hours)}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between px-2.5">
        <span className="eyebrow">{title}</span>
        <span className="text-[10.5px] text-white/25">{sub}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function CanvasButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid size-9 place-items-center border-b border-white/[0.06] text-white/60 transition last:border-b-0 hover:bg-white/[0.06] hover:text-white"
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
        {children}
      </svg>
    </button>
  );
}
