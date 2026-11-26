/**
 * 대용량 그래프 캔버스 (sigma.js 두 겹).
 *
 * - 바닥: 엔진이 배치까지 끝낸 노드·엣지를 그대로 그린다. reducer가 없어 노드·엣지를 하나씩 다시 훑는 일이 없다.
 *   카메라 이동·확대는 GPU 변환만 바뀌므로 수만 개여도 부드럽다.
 * - 위: 강조용 작은 sigma. 마우스를 올리거나 고른 노드와 그 이웃만 담아 그린다.
 *   강조 비용이 전체 크기가 아니라 이웃 수에 비례한다. 바닥은 그동안 CSS로 어둡게만 한다.
 * 두 겹은 같은 좌표 틀(bbox)과 카메라를 공유해 정확히 겹친다.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { EdgeLineProgram } from 'sigma/rendering';
import { RELATIONS, type OntologyGraph } from '@steamverse/shared';
import { LABEL_FONT, drawDarkHover, drawHaloLabel, parseColor, premulRgba } from '../../lib/sigmaStyle';
import { CrowdDrag } from '../../lib/crowdDrag';
import { REL_INDEX, REL_LIST, type EdgeRel, type GraphPayload, type LargeView } from '../../engine/protocol';

/** 강조할 때 그리는 이웃 상한 (장르 같은 허브는 이웃이 수만 개다) */
const OVERLAY_MAX = 2500;
/** 강조할 때 이름을 붙이는 이웃 수 */
const OVERLAY_LABELS = 24;
const SHARED_RGB = { r: 170, g: 186, b: 220 };

const relRgb = (rel: EdgeRel) => (rel === 'sharesGames' ? SHARED_RGB : parseColor(RELATIONS[rel].color));
/** 바닥 엣지: 아주 옅게 (수만 개가 겹쳐도 하얗게 뭉개지지 않게) */
const BASE_EDGE = REL_LIST.map((r) => premulRgba(relRgb(r), r === 'similarTo' ? 0.07 : 0.04));
const FOCUS_EDGE = REL_LIST.map((r) => premulRgba(relRgb(r), 0.75));

interface Props {
  graph: OntologyGraph;
  payload: GraphPayload;
  view: LargeView;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 확대·축소 버튼이 쓰는 바닥 sigma */
  sigmaRef: MutableRefObject<Sigma | null>;
  /** 끌기가 끝나 모두 멈추면, 움직인 노드들의 자리를 엔진에 기억시킨다 */
  onPins?: (list: { key: string; x: number; y: number }[]) => void;
}

export function LargeCanvas({ graph, payload, view, selectedId, onSelect, sigmaRef, onPins }: Props) {
  const baseEl = useRef<HTMLDivElement>(null);
  const overEl = useRef<HTMLDivElement>(null);
  const overRef = useRef<Sigma | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const hovered = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onPinsRef = useRef(onPins);
  onPinsRef.current = onPins;
  const crowd = useRef<CrowdDrag | null>(null);
  /** 노드 → 닿은 바닥 엣지 (끄는 동안 매 프레임 다시 찾지 않게) */
  const edgeCache = useRef(new Map<string, string[]>());
  /** 지금 끌고 있는 노드 */
  const dragged = useRef<string | null>(null);
  /** 그래프 전체 노드 번호 → 보기 번호 */
  const viewOf = useRef(new Int32Array(0));

  /** 강조 레이어를 지금 초점(마우스 > 선택)에 맞춰 다시 그린다 */
  const drawFocus = () => {
    const over = overRef.current;
    const base = sigmaRef.current;
    if (!over || !base) return;
    const v = viewRef.current;
    const focusId = hovered.current ?? selectedRef.current;
    const g = new Graph({ type: 'undirected', multi: false });
    const fi = focusId === null ? -1 : indexOf(focusId);
    const vi = fi < 0 ? -1 : viewOf.current[fi]!;
    if (vi < 0) {
      over.setGraph(g);
      baseEl.current!.style.opacity = '1';
      return;
    }
    const nb = viewNeighbors(fi);
    const list = [...nb.entries()].sort((a, b) => v.size[b[0]]! - v.size[a[0]]!).slice(0, OVERLAY_MAX);
    const addNode = (i: number, extra: Record<string, unknown>) =>
      g.addNode(String(i), {
        x: v.x[i],
        y: v.y[i],
        size: v.size[i]! * 1.25 + 0.6,
        color: v.palette[v.colorIdx[i]!],
        label: graph.nodes[v.nodeIdx[i]!]!.label,
        ...extra,
      });
    addNode(vi, { forceLabel: true, highlighted: true, size: Math.max(7, v.size[vi]! * 1.6) });
    list.forEach(([i, rel], rank) => {
      addNode(i, { forceLabel: rank < OVERLAY_LABELS });
      g.addEdge(String(vi), String(i), { color: FOCUS_EDGE[rel], size: 1 });
    });
    over.setGraph(g);
    over.setCustomBBox(base.getBBox());
    baseEl.current!.style.opacity = '0.22';
  };

  /** 이웃: 보기 안에 있고, 이 보기에 있는 관계로 이어진 노드 (보기 번호 → 관계). '내가 보유' 관계는 모든 게임에 걸려 있어 뺀다 */
  const viewNeighbors = (fi: number) => {
    const v = viewRef.current;
    const vi = viewOf.current[fi]!;
    const allowed = new Set(v.relations.map((r) => REL_INDEX.get(r)!));
    const meIdx = indexOf(payload.meId);
    const owns = REL_INDEX.get('owns')!;
    const nb = new Map<number, number>();
    for (let k = payload.incOffsets[fi]!; k < payload.incOffsets[fi + 1]!; k++) {
      const e = payload.incEdges[k]!;
      const rel = payload.edgeRel[e]!;
      if (!allowed.has(rel) || (rel === owns && payload.edgeSrc[e] === meIdx)) continue;
      const other = payload.edgeSrc[e] === fi ? payload.edgeDst[e]! : payload.edgeSrc[e]!;
      const ov = viewOf.current[other]!;
      if (ov >= 0 && ov !== vi && !nb.has(ov)) nb.set(ov, rel);
    }
    return nb;
  };

  /**
   * 여러 노드의 좌표를 한 프레임에 반영한다.
   * 노드 속성을 그래프 이벤트로 바꾸면 sigma가 수만 개 전체를 다시 처리한다(한 번에 0.25초).
   * 그래서 좌표를 직접 고치고, 움직인 노드와 닿은 선만 GPU 버퍼에서 바꾼다 (부분 갱신). 강조 레이어는 작아서 통째로.
   */
  const writePositions = (list: { key: string; x: number; y: number }[]) => {
    const base = sigmaRef.current;
    const over = overRef.current;
    if (!base || !over) return;
    const g = base.getGraph();
    const og = over.getGraph();
    const v = viewRef.current;
    const nodes: string[] = [];
    const edges: string[] = [];
    let overTouched = false;
    for (const { key, x, y } of list) {
      if (!g.hasNode(key)) continue;
      const a = g.getNodeAttributes(key) as { x: number; y: number };
      if (a.x === x && a.y === y) continue;
      a.x = x;
      a.y = y;
      nodes.push(key);
      let es = edgeCache.current.get(key);
      if (!es) edgeCache.current.set(key, (es = g.edges(key)));
      for (const e of es) edges.push(e);
      const vi = viewOf.current[indexOf(key)] ?? -1;
      if (vi < 0) continue;
      v.x[vi] = x;
      v.y[vi] = y;
      const ok = String(vi);
      if (og.hasNode(ok)) {
        const oa = og.getNodeAttributes(ok) as { x: number; y: number };
        oa.x = x;
        oa.y = y;
        overTouched = true;
      }
    }
    if (nodes.length) base.refresh({ partialGraph: { nodes, edges }, skipIndexation: true, schedule: true });
    if (overTouched) over.refresh({ schedule: true });
  };

  const indexCache = useRef(new Map<string, number>());
  const indexOf = (id: string) => {
    let m = indexCache.current;
    if (m.size !== graph.nodes.length) {
      m = new Map(graph.nodes.map((n, i) => [n.id, i]));
      indexCache.current = m;
    }
    return m.get(id) ?? -1;
  };

  // ── sigma 두 겹 만들기 (한 번) ─────────────────────────────
  useEffect(() => {
    const common = {
      allowInvalidContainer: true,
      defaultEdgeType: 'line',
      edgeProgramClasses: { line: EdgeLineProgram },
      labelFont: LABEL_FONT,
      labelSize: 11.5,
      labelWeight: '500',
      labelColor: { color: '#cbd5e1' },
      defaultDrawNodeLabel: drawHaloLabel,
      defaultDrawNodeHover: drawDarkHover,
      stagePadding: 60,
      minCameraRatio: 0.02,
      maxCameraRatio: 3,
    };
    const base = new Sigma(new Graph(), baseEl.current!, {
      ...common,
      labelDensity: 0.5,
      labelGridCellSize: 120,
      labelRenderedSizeThreshold: 12,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      zIndex: false,
    });
    const over = new Sigma(new Graph(), overEl.current!, {
      ...common,
      labelDensity: 1,
      labelGridCellSize: 80,
      labelRenderedSizeThreshold: 9,
      zIndex: false,
    });
    sigmaRef.current = base;
    overRef.current = over;

    // 끌기 물리: 끌린 노드는 다른 노드 위를 지나가지 못하고 앞을 막는 노드를 밀어낸다 (밀림이 사슬처럼 번진다)
    crowd.current = new CrowdDrag({
      unitsPerPx: () => {
        const a = base.viewportToGraph({ x: 0, y: 0 });
        const b = base.viewportToGraph({ x: 100, y: 0 });
        return Math.hypot(b.x - a.x, b.y - a.y) / 100;
      },
      forEachNode: (cb) => {
        const v = viewRef.current;
        const held = dragged.current;
        for (let i = 0; i < v.nodeIdx.length; i++) {
          const id = graph.nodes[v.nodeIdx[i]!]!.id;
          // 끌린 노드는 강조 레이어에 크게(테두리 포함) 그려지므로 그 크기로 부딪힌다 (drawFocus와 같은 크기)
          const size = id === held ? Math.max(7, v.size[i]! * 1.6) : v.size[i]!;
          cb(id, v.x[i]!, v.y[i]!, base.scaleSize(size) + (id === held ? 2 : 0));
        }
      },
      write: (moved) => writePositions(moved),
      settle: (moved) => onPinsRef.current?.(moved),
    });
    if (import.meta.env.DEV) Object.assign(window, { __sigma: base, __overlay: over, __crowd: crowd.current });

    // 위 레이어는 바닥 카메라를 그대로 따른다
    const camera = base.getCamera();
    const follow = () => over.getCamera().setState(camera.getState());
    camera.on('updated', follow);

    // 끄는 중에도 커서 아래 노드는 따로 기억해 두었다가 손을 놓을 때 맞춘다 (안 그러면 끈 노드에 강조가 남는다)
    let underCursor: string | null = null;
    base.on('enterNode', ({ node }) => {
      underCursor = node;
      // 끄는 중에 다른 노드 위를 지나가도 강조는 끌고 있는 노드에 둔다
      if (dragged.current) return;
      hovered.current = node;
      baseEl.current!.style.cursor = 'pointer';
      drawFocus();
    });
    base.on('leaveNode', () => {
      underCursor = null;
      // 끄는 중에는 커서가 노드에서 잠깐 벗어나도 강조를 유지한다
      if (dragged.current) return;
      hovered.current = null;
      baseEl.current!.style.cursor = '';
      drawFocus();
    });
    base.on('clickNode', ({ node }) => onSelectRef.current(node));
    base.on('clickStage', () => onSelectRef.current(null));

    // ── 노드 끌기 ──
    base.on('downNode', ({ node }) => {
      dragged.current = node;
      hovered.current = node;
      // 끄는 동안 좌표 틀이 바뀌면 화면 전체가 출렁인다 → 지금 틀로 고정
      if (!base.getCustomBBox()) base.setCustomBBox(base.getBBox());
      crowd.current?.start(node);
    });
    const captor = base.getMouseCaptor();
    captor.on('mousemovebody', (e) => {
      const node = dragged.current;
      if (!node) return;
      const pos = base.viewportToGraph(e);
      crowd.current?.move(pos.x, pos.y);
      e.preventSigmaDefault();
      e.original.preventDefault();
      e.original.stopPropagation();
    });
    captor.on('mouseup', () => {
      const node = dragged.current;
      if (!node) return;
      dragged.current = null;
      // 밀린 노드는 밀린 자리에 그대로 남는다. 움직인 노드 전부 settle에서 자리를 저장한다
      crowd.current?.end();
      if (hovered.current !== underCursor) {
        hovered.current = underCursor;
        baseEl.current!.style.cursor = underCursor ? 'pointer' : '';
        drawFocus();
      }
    });

    return () => {
      crowd.current?.cancel();
      camera.off('updated', follow);
      base.kill();
      over.kill();
      sigmaRef.current = null;
      overRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 보기가 바뀌면 바닥 그래프를 배열에서 바로 만든다 ─────────
  useEffect(() => {
    const base = sigmaRef.current;
    if (!base) return;
    const v = view;
    crowd.current?.cancel();
    edgeCache.current.clear();
    const map = new Int32Array(payload.nodes.length).fill(-1);
    v.nodeIdx.forEach((f, i) => (map[f] = i));
    viewOf.current = map;

    const g = new Graph({ type: 'undirected', multi: false });
    for (let i = 0; i < v.nodeIdx.length; i++) {
      const node = graph.nodes[v.nodeIdx[i]!]!;
      g.addNode(node.id, { x: v.x[i], y: v.y[i], size: v.size[i], color: v.palette[v.colorIdx[i]!], label: node.label });
    }
    const ids = (i: number) => graph.nodes[v.nodeIdx[i]!]!.id;
    for (let k = 0; k < v.edgeA.length; k++) g.addEdge(ids(v.edgeA[k]!), ids(v.edgeB[k]!), { color: BASE_EDGE[v.edgeRel[k]!], size: 1 });
    // 끌기 중에 고정해 둔 좌표 틀은 새 보기에서 다시 맞춘다
    base.setCustomBBox(null);
    base.setGraph(g);
    drawFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── 선택 반영: 강조 + 카메라 이동 ─────────────────────────────
  useEffect(() => {
    drawFocus();
    const base = sigmaRef.current;
    if (!base || !selectedId || !base.getGraph().hasNode(selectedId)) return;
    const d = base.getNodeDisplayData(selectedId);
    if (!d) return;
    const camera = base.getCamera();
    camera.animate({ x: d.x, y: d.y, ratio: Math.min(camera.ratio, 0.3) }, { duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, view]);

  return (
    <>
      <div ref={baseEl} className="absolute inset-0 transition-opacity duration-150" />
      <div ref={overEl} className="pointer-events-none absolute inset-0" />
    </>
  );
}
