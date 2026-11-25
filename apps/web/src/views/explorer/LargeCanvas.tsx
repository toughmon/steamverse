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
}

export function LargeCanvas({ graph, payload, view, selectedId, onSelect, sigmaRef }: Props) {
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
    // 이웃: 보기 안에 있고, 이 보기에 있는 관계로 이어진 노드. '내가 보유' 관계는 모든 게임에 걸려 있어 뺀다
    const allowed = new Set(v.relations.map((r) => REL_INDEX.get(r)!));
    const meIdx = indexOf(payload.meId);
    const owns = REL_INDEX.get('owns')!;
    const nb = new Map<number, number>(); // 보기 번호 → 관계
    for (let k = payload.incOffsets[fi]!; k < payload.incOffsets[fi + 1]!; k++) {
      const e = payload.incEdges[k]!;
      const rel = payload.edgeRel[e]!;
      if (!allowed.has(rel) || (rel === owns && payload.edgeSrc[e] === meIdx)) continue;
      const other = payload.edgeSrc[e] === fi ? payload.edgeDst[e]! : payload.edgeSrc[e]!;
      const ov = viewOf.current[other]!;
      if (ov >= 0 && ov !== vi && !nb.has(ov)) nb.set(ov, rel);
    }
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
    if (import.meta.env.DEV) Object.assign(window, { __sigma: base, __overlay: over });

    // 위 레이어는 바닥 카메라를 그대로 따른다
    const camera = base.getCamera();
    const follow = () => over.getCamera().setState(camera.getState());
    camera.on('updated', follow);

    base.on('enterNode', ({ node }) => {
      hovered.current = node;
      baseEl.current!.style.cursor = 'pointer';
      drawFocus();
    });
    base.on('leaveNode', () => {
      hovered.current = null;
      baseEl.current!.style.cursor = '';
      drawFocus();
    });
    base.on('clickNode', ({ node }) => onSelectRef.current(node));
    base.on('clickStage', () => onSelectRef.current(null));

    return () => {
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
