import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import { PLAY_STATUS, steamImage, type OntNode, type OntologyGraph, type PlayStatus } from '@steamverse/shared';
import { DataTable, LegendItem, useSize } from './charts/kit';
import { CAT8, OTHER, STATUS_ORDER, STATUS_RAMP, fmtHours, gamesOf } from './signal/data';

/**
 * 카트리지 성단 (d3-force).
 * 게임 = 카트리지, 무리 = 서로 녹아 붙는 빛무리(메타볼), 추천 = 실선 위를 지나가는 빛 알갱이.
 * 묶음 기준·크기 기준·연결 기준을 바꾸고, 확대·이동·검색·선택·집중으로 탐색한다.
 */

const MAX_GAMES = 56;
const BODY = '#171a26';
const BODY_EDGE = '#2a2f42';

type GroupMode = 'taste' | 'genre' | 'status' | 'era';
type SizeMode = 'hours' | 'recent' | 'achievements';

const GROUP_MODES: { id: GroupMode; label: string }[] = [
  { id: 'taste', label: '취향 성단' },
  { id: 'genre', label: '장르' },
  { id: 'status', label: '플레이 상태' },
  { id: 'era', label: '출시 시대' },
];
const SIZE_MODES: { id: SizeMode; label: string }[] = [
  { id: 'hours', label: '총 시간' },
  { id: 'recent', label: '최근 2주' },
  { id: 'achievements', label: '업적' },
];
const ERAS = [
  { key: 'e0', name: '~2009', test: (y: number) => y <= 2009 },
  { key: 'e1', name: '2010–2014', test: (y: number) => y >= 2010 && y <= 2014 },
  { key: 'e2', name: '2015–2019', test: (y: number) => y >= 2015 && y <= 2019 },
  { key: 'e3', name: '2020~', test: (y: number) => y >= 2020 },
];
/** 순서가 있는 묶음(상태·시대)은 한 색 램프 — 어두운 표면에서 검증한 값 */
const ORDINAL = [STATUS_RAMP.backlog, STATUS_RAMP.tried, STATUS_RAMP.played, STATUS_RAMP.favorite];

interface Cart extends SimulationNodeDatum {
  id: string;
  node: OntNode;
  s: number;
  group: string;
  color: string;
  phase: number;
}
interface Flow extends SimulationLinkDatum<Cart> {
  source: Cart;
  target: Cart;
  sim: number;
}
interface Group {
  key: string;
  name: string;
  color: string;
  count: number;
  hours: number;
}

function sizeOf(c: OntNode, mode: SizeMode): number {
  const g = c.game!;
  if (mode === 'recent') return g.hours2w > 0 ? Math.min(46, 18 + Math.sqrt(g.hours2w) * 4) : 14;
  if (mode === 'achievements') return g.achievements?.total ? 15 + 31 * (g.achievements.unlocked / g.achievements.total) : 14;
  return c.hours > 0 ? Math.min(46, 18 + Math.sqrt(c.hours) * 1.4) : 16;
}

function initials(label: string): string {
  const w = label.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return w.length > 1 ? (w[0]![0]! + w[1]![0]!).toUpperCase() : (w[0] ?? '').slice(0, 2).toUpperCase();
}

/** 카트리지 (가운데가 0,0). 표지는 잘라 보여 줄 뿐 바꾸지 않는다 (STEAM_COMPLIANCE C1) */
function Cartridge({ c, clipId, selected }: { c: Cart; clipId: string; selected: boolean }) {
  const w = c.s;
  const h = c.s * 1.15;
  const x = -w / 2;
  const y = -h / 2;
  const notch = w * 0.16;
  const lx = x + w * 0.12;
  const ly = y + h * 0.2;
  const lw = w * 0.76;
  const lh = h * 0.5;
  const img = steamImage(c.node.game!.appid, 'capsule');
  const status = c.node.game!.status;
  const sealed = status === 'backlog';
  const lit = c.node.game!.hours2w > 0;
  const body = `M${x + 3},${y}H${x + w - notch}L${x + w},${y + notch}V${y + h - 3}Q${x + w},${y + h} ${x + w - 3},${y + h}H${x + 3}Q${x},${y + h} ${x},${y + h - 3}V${y + 3}Q${x},${y} ${x + 3},${y}Z`;
  const pins = Math.max(3, Math.round(w / 7));
  return (
    <g>
      {selected && <rect x={x - 5} y={y - 5} width={w + 10} height={h + 10} rx={6} fill="none" stroke="#fff" strokeWidth={1.5} />}
      <path d={body} fill={BODY} stroke={sealed ? 'rgba(255,255,255,0.4)' : BODY_EDGE} strokeWidth={1} strokeDasharray={sealed ? '2 2' : undefined} />
      {[0.08, 0.13].map((k) => (
        <line key={k} x1={lx} x2={lx + lw * 0.7} y1={y + h * k} y2={y + h * k} stroke={BODY_EDGE} strokeWidth={1} />
      ))}
      <clipPath id={clipId}>
        <rect x={lx} y={ly} width={lw} height={lh} rx={2} />
      </clipPath>
      {img ? (
        <image href={img} x={lx} y={ly} width={lw} height={lh} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} opacity={sealed ? 0.55 : 0.95} />
      ) : (
        <>
          <rect x={lx} y={ly} width={lw} height={lh} rx={2} fill={c.color} opacity={sealed ? 0.45 : 0.85} />
          {w >= 26 && (
            <text y={ly + lh / 2} dy="0.35em" textAnchor="middle" className="fill-white/85 font-mono" style={{ fontSize: Math.max(7, w * 0.2) }}>
              {initials(c.node.label)}
            </text>
          )}
        </>
      )}
      <rect x={lx} y={ly + lh + 1.5} width={lw} height={Math.max(2, h * 0.05)} rx={1} fill={c.color} />
      {Array.from({ length: pins }, (_, i) => (
        <rect key={i} x={lx + (lw / pins) * i + 1} y={y + h * 0.86} width={lw / pins - 2} height={h * 0.08} rx={0.5} fill="#3a3f52" />
      ))}
      <circle cx={x + w - notch * 0.9} cy={y + h * 0.1} r={Math.max(1.5, w * 0.045)} fill={lit ? '#e8f0ff' : '#2b3042'} />
      {lit && <circle cx={x + w - notch * 0.9} cy={y + h * 0.1} r={Math.max(3, w * 0.1)} fill="#e8f0ff" opacity={0.18} />}
      {sealed && <path d={`M${x + w * 0.15},${y + h}L${x + w * 0.55},${y}H${x + w * 0.7}L${x + w * 0.3},${y + h}Z`} fill="#fff" opacity={0.08} />}
      {status === 'favorite' && (
        <text x={x + w - 2} y={y + h - 2} textAnchor="end" className="fill-white" style={{ fontSize: Math.max(8, w * 0.22) }}>
          ★
        </text>
      )}
    </g>
  );
}

/** 휘어진 연결선 (중간에서 옆으로 살짝 민 2차 곡선) */
function curve(a: Cart, b: Cart): string {
  // 첫 렌더에는 아직 위치가 없다
  if (a.x === undefined || b.x === undefined) return 'M0,0';
  const dx = b.x! - a.x!;
  const dy = b.y! - a.y!;
  return `M${a.x},${a.y}Q${(a.x! + b.x!) / 2 - dy * 0.14},${(a.y! + b.y!) / 2 + dx * 0.14} ${b.x},${b.y}`;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-full border border-white/[0.08] bg-[#0a0c16]/80 p-[2px] backdrop-blur">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] transition ${value === o.id ? 'bg-white/[0.12] text-white' : 'text-white/45 hover:text-white/80'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ConstellationView({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width, height }] = useSize<HTMLDivElement>();
  const H = Math.max(520, height);
  const [groupMode, setGroupMode] = useState<GroupMode>('taste');
  const [sizeMode, setSizeMode] = useState<SizeMode>('hours');
  const [minSim, setMinSim] = useState(0.5);
  const [showLinks, setShowLinks] = useState(true);
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<Cart | null>(null);
  const [selected, setSelected] = useState<Cart | null>(null);
  const [focusGroup, setFocusGroup] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [, setTick] = useState(0);

  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const auraEls = useRef(new Map<string, SVGCircleElement>());
  const linkEls = useRef(new Map<number, SVGPathElement>());
  const chipEls = useRef(new Map<string, SVGGElement>());
  const simRef = useRef<Simulation<Cart, Flow> | null>(null);
  const anchors = useRef(new Map<string, { x: number; y: number }>());

  // ── 카트리지와 연결 (데이터가 바뀔 때만 새로 만든다 — 묶음·크기를 바꿔도 위치는 이어진다) ──
  const base = useMemo(() => {
    const all = gamesOf(graph);
    const played = all.filter((g) => g.hours > 0).sort((a, b) => b.hours - a.hours);
    const backlog = all.filter((g) => g.hours === 0);
    const pick = [...played.slice(0, MAX_GAMES - Math.min(10, backlog.length)), ...backlog.slice(0, 10)];
    const carts: Cart[] = pick.map((g, i) => ({ id: g.id, node: g, s: 18, group: '', color: OTHER, phase: i * 2.399 }));
    const byId = new Map(carts.map((c) => [c.id, c]));
    const flows: Flow[] = [];
    for (const e of graph.edges) {
      if (e.rel !== 'similarTo') continue;
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const [src, dst] = a.node.hours >= b.node.hours ? [a, b] : [b, a];
      flows.push({ source: src, target: dst, sim: e.weight ?? 0.5 });
    }
    return { carts, flows, byId };
  }, [graph]);

  // ── 묶음 ──
  const groups = useMemo<Group[]>(() => {
    const { carts } = base;
    let list: { key: string; name: string; of: (c: Cart) => boolean }[] = [];
    if (groupMode === 'taste') {
      const known = graph.clusters.filter((cl) => cl.id !== -1 && carts.some((c) => c.node.cluster === cl.id)).sort((a, b) => b.hours - a.hours).slice(0, CAT8.length);
      list = known.map((cl) => ({ key: `t${cl.id}`, name: cl.name.split(' · ').slice(0, 2).join(' · '), of: (c: Cart) => c.node.cluster === cl.id }));
    } else if (groupMode === 'genre') {
      const count = new Map<string, number>();
      for (const c of carts) {
        const g = c.node.game!.genres[0];
        if (g) count.set(g, (count.get(g) ?? 0) + c.node.hours + 1);
      }
      list = [...count.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7)
        .map(([g]) => ({ key: `g${g}`, name: g, of: (c: Cart) => c.node.game!.genres[0] === g }));
    } else if (groupMode === 'status') {
      list = STATUS_ORDER.map((s: PlayStatus) => ({ key: `s${s}`, name: PLAY_STATUS[s].label.ko, of: (c: Cart) => c.node.game!.status === s }));
    } else {
      list = ERAS.map((e) => ({ key: e.key, name: e.name, of: (c: Cart) => e.test(c.node.game!.releaseYear) }));
    }
    const ordinal = groupMode === 'status' || groupMode === 'era';
    const out: Group[] = list.map((l, i) => ({ key: l.key, name: l.name, color: ordinal ? ORDINAL[i]! : CAT8[i]!, count: 0, hours: 0 }));
    const other: Group = { key: 'other', name: '기타', color: OTHER, count: 0, hours: 0 };
    for (const c of carts) {
      const i = list.findIndex((l) => l.of(c));
      const g = i >= 0 ? out[i]! : other;
      c.group = g.key;
      c.color = g.color;
      g.count += 1;
      g.hours += c.node.hours;
    }
    return [...out, other].filter((g) => g.count > 0);
  }, [base, graph, groupMode]);

  // 크기
  useMemo(() => {
    for (const c of base.carts) c.s = sizeOf(c.node, sizeMode);
  }, [base, sizeMode]);

  const flows = useMemo(() => (showLinks ? base.flows.filter((f) => f.sim >= minSim) : []), [base, minSim, showLinks]);

  // ── 무리의 기준점: 화면 가운데를 둘러싼 타원 위 ──
  const placeAnchors = () => {
    const cx = width / 2;
    const cy = H / 2;
    const n = groups.length;
    groups.forEach((g, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      anchors.current.set(g.key, n > 1 ? { x: cx + Math.cos(a) * width * 0.32, y: cy + Math.sin(a) * H * 0.3 } : { x: cx, y: cy });
    });
  };

  // ── 시뮬레이션 (한 번 만들고, 조작이 바뀌면 힘만 갈아 끼운다) ──
  useEffect(() => {
    if (!width) return;
    placeAnchors();
    for (const c of base.carts) {
      if (c.x === undefined) {
        const a = anchors.current.get(c.group) ?? { x: width / 2, y: H / 2 };
        c.x = a.x + Math.cos(c.phase) * 40;
        c.y = a.y + Math.sin(c.phase) * 40;
      }
    }
    const sim = forceSimulation<Cart>(base.carts).velocityDecay(0.35);
    simRef.current = sim;
    sim.on('tick', () => {
      for (const c of base.carts) {
        // 화면(확대 1배 기준) 밖으로 나가지 않게
        const pad = c.s * 0.7 + 30;
        c.x = Math.max(pad, Math.min(width - pad, c.x!));
        c.y = Math.max(pad + 40, Math.min(H - pad - 20, c.y!));
        nodeEls.current.get(c.id)?.setAttribute('transform', `translate(${c.x},${c.y})`);
        const a = auraEls.current.get(c.id);
        if (a) {
          a.setAttribute('cx', String(c.x));
          a.setAttribute('cy', String(c.y));
        }
      }
      linkEls.current.forEach((el, i) => {
        const f = flowsRef.current[i];
        if (f) el.setAttribute('d', curve(f.source, f.target));
      });
      for (const g of groupsRef.current) {
        const m = base.carts.filter((c) => c.group === g.key);
        if (!m.length) continue;
        const x = m.reduce((s, c) => s + c.x!, 0) / m.length;
        const top = Math.min(...m.map((c) => c.y! - c.s * 0.6));
        chipEls.current.get(g.key)?.setAttribute('transform', `translate(${x},${top - 30})`);
      }
    });
    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, width, H]);

  const flowsRef = useRef(flows);
  flowsRef.current = flows;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // 묶음·크기·연결·출렁임이 바뀌면 힘을 다시 걸고 데운다
  useEffect(() => {
    const sim = simRef.current;
    if (!sim || !width) return;
    placeAnchors();
    let t = 0;
    const separate = (alpha: number) => {
      const cents = groups.map((g) => {
        const m = base.carts.filter((c) => c.group === g.key);
        const x = m.reduce((s, c) => s + c.x!, 0) / Math.max(1, m.length);
        const y = m.reduce((s, c) => s + c.y!, 0) / Math.max(1, m.length);
        // 무리 크기는 지금 퍼진 정도가 아니라 카트리지 면적으로 어림한다
        // (묶음을 바꾼 직후엔 멤버가 화면 전체에 흩어져 있어, 퍼진 정도로 재면 밀어내기가 폭주한다)
        const r = Math.sqrt(m.reduce((a, c) => a + (c.s * 0.8 + 8) ** 2, 0)) * 1.15 + 18;
        return { key: g.key, x, y, r };
      });
      for (const c of base.carts) {
        for (const g of cents) {
          if (g.key === c.group) continue;
          const dx = c.x! - g.x;
          const dy = c.y! - g.y;
          const dist = Math.hypot(dx, dy) || 1;
          const reach = g.r + c.s * 0.7 + 14;
          if (dist < reach) {
            const k = Math.min(0.5, (reach - dist) / dist) * alpha * 0.6;
            c.vx! += dx * k;
            c.vy! += dy * k;
          }
        }
      }
    };
    sim
      .force('link', forceLink<Cart, Flow>(flows).distance((l) => (l.source.group === l.target.group ? 48 : 160)).strength((l) => (l.source.group === l.target.group ? 0.2 : 0.01)))
      .force('charge', forceManyBody<Cart>().strength((c) => -18 - c.s * 1.1).distanceMax(220))
      .force('x', forceX<Cart>((c) => anchors.current.get(c.group)?.x ?? width / 2).strength(0.12))
      .force('y', forceY<Cart>((c) => anchors.current.get(c.group)?.y ?? H / 2).strength(0.12))
      .force('collide', forceCollide<Cart>((c) => c.s * 0.72 + 4).iterations(2))
      .force('separate', separate)
      .force(
        'wander',
        motion
          ? () => {
              t += 1;
              for (const c of base.carts) {
                c.vx! += Math.cos(t * 0.012 + c.phase) * 0.035;
                c.vy! += Math.sin(t * 0.01 + c.phase * 1.3) * 0.035;
              }
            }
          : null,
      )
      .alphaTarget(motion ? 0.025 : 0)
      .alpha(0.8)
      .restart();
    setTick((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, flows, sizeMode, motion, width, H]);

  // ── 확대·이동 ──
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setView((v) => {
        const k = Math.max(0.4, Math.min(3, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [width, showTable]);

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
  };
  const centerOn = (c: Cart, k = Math.max(view.k, 1.4)) => setView({ k, x: width / 2 - c.x! * k, y: H / 2 - c.y! * k });

  const gesture = useRef<{ kind: 'node'; c: Cart; sx: number; sy: number; moved: boolean } | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  // ── 강조 규칙: 선택 > 마우스 > 검색 > 집중 ──
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? new Set(base.carts.filter((c) => c.node.label.toLowerCase().includes(q)).map((c) => c.id)) : null), [base, q]);
  const pivot = selected ?? hover;
  const neighbors = useMemo(() => {
    if (!pivot) return null;
    const s = new Set([pivot.id]);
    for (const f of base.flows) {
      if (f.sim < minSim) continue;
      if (f.source === pivot) s.add(f.target.id);
      if (f.target === pivot) s.add(f.source.id);
    }
    return s;
  }, [pivot, base, minSim]);
  const lit = (c: Cart) => (neighbors ? neighbors.has(c.id) : matches ? matches.has(c.id) : focusGroup ? c.group === focusGroup : true);
  const linkLit = (f: Flow) => (pivot ? f.source === pivot || f.target === pivot : focusGroup ? f.source.group === focusGroup || f.target.group === focusGroup : !matches);

  const top14 = useMemo(() => new Set([...base.carts].sort((a, b) => b.node.hours - a.node.hours).slice(0, 14).map((c) => c.id)), [base]);
  const groupName = (key: string) => groups.find((g) => g.key === key)?.name ?? '기타';
  const similarOf = (c: Cart) =>
    base.flows
      .filter((f) => f.sim >= minSim && (f.source === c || f.target === c))
      .map((f) => ({ other: f.source === c ? f.target : f.source, sim: f.sim, out: f.source === c }))
      .sort((a, b) => b.sim - a.sim);

  const biggest = [...groups].filter((g) => g.key !== 'other').sort((a, b) => b.hours - a.hours)[0];

  return (
    <div className="flex h-full bg-[#04050a]">
      {/* ── 왼쪽: 설명·범례 ── */}
      <aside className="sv-scroll flex w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/[0.06] p-7">
        <div>
          <div className="eyebrow">Cartridge constellation</div>
          <h2 className="mt-2 text-[13px] text-white/50">카트리지 성단</h2>
          <div className="mt-3 text-[21px] leading-snug font-semibold tracking-tight text-white">
            {biggest ? (
              <>
                {GROUP_MODES.find((m) => m.id === groupMode)!.label}로 보면
                <br />
                <span className="text-white/90">{biggest.name}</span>에 시간이 가장 많아요
              </>
            ) : (
              '보여 줄 게임이 부족해요'
            )}
          </div>
        </div>
        <p className="text-[12.5px] leading-relaxed text-white/50">
          카트리지 하나가 게임 하나입니다. 같은 무리의 카트리지가 모이면 빛무리가 녹아 붙고, 빛 알갱이는 많이 한 게임에서 비슷한 덜 한 게임 쪽으로 지나갑니다.
        </p>
        <div className="flex flex-col gap-0.5">
          {groups.map((g) => (
            <button
              key={g.key}
              onClick={() => setFocusGroup((f) => (f === g.key ? null : g.key))}
              className={`flex items-center justify-between rounded-lg px-2 py-1 text-left transition hover:bg-white/[0.04] ${focusGroup === g.key ? 'bg-white/[0.06]' : ''}`}
            >
              <LegendItem color={g.color} label={g.name} />
              <span className="num font-mono text-[10.5px] text-white/35">{g.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-[11.5px] text-white/60">
          <span className="flex items-center gap-2">
            <span className="h-3 w-2.5 rounded-[2px] border border-dashed border-white/40" />
            점선 테두리 · 미개봉 (백로그)
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 text-center text-white">★</span>
            인생작 (100시간 이상)
          </span>
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#e8f0ff] shadow-[0_0_6px_rgba(232,240,255,0.7)]" />
            켜진 표시등 · 최근 2주에 플레이
          </span>
        </div>
        <div className="mt-auto flex flex-col gap-1 pt-2 font-mono text-[10px] leading-relaxed text-white/30">
          <span>휠 확대 · 바탕 끌기 이동 · 카트리지 끌기</span>
          <span>누르기 선택 · 두 번 누르기 탐색기로</span>
          <button onClick={() => setShowTable((v) => !v)} className="mt-2 self-start text-[10.5px] tracking-wider text-white/40 transition hover:text-white/80">
            {showTable ? '← 성단으로 보기' : '표로 보기 →'}
          </button>
        </div>
      </aside>

      {/* ── 오른쪽: 성단 ── */}
      <div className="relative min-w-0 flex-1">
        {showTable ? (
          <div className="absolute inset-0 p-7">
            <DataTable
              columns={[{ label: '게임' }, { label: '묶음' }, { label: '플레이 시간', align: 'right' }, { label: '상태' }, { label: '비슷한 게임', align: 'right' }]}
              rows={[...base.carts].sort((a, b) => b.node.hours - a.node.hours).map((c) => [c.node.label, groupName(c.group), fmtHours(c.node.hours), PLAY_STATUS[c.node.game!.status].label.ko, `${similarOf(c).length}개`])}
              maxHeight="100%"
            />
          </div>
        ) : (
          <div ref={ref} className="absolute inset-0 overflow-hidden">
            {/* 도구 막대 */}
            <div className="absolute top-4 left-4 z-10 flex flex-wrap items-center gap-2">
              <Seg value={groupMode} options={GROUP_MODES} onChange={(v) => (setGroupMode(v), setFocusGroup(null))} />
              <Seg value={sizeMode} options={SIZE_MODES} onChange={setSizeMode} />
              <label className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#0a0c16]/80 px-3 py-1 text-[11px] text-white/55 backdrop-blur">
                <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} className="accent-sky-400" />
                연결
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.05}
                  value={minSim}
                  disabled={!showLinks}
                  onChange={(e) => setMinSim(Number(e.target.value))}
                  className="w-20 accent-sky-400 disabled:opacity-30"
                  aria-label="연결할 최소 유사도"
                />
                <span className="num w-8 font-mono text-white/40">{Math.round(minSim * 100)}%</span>
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches?.size) {
                    const c = base.carts.find((x) => matches.has(x.id))!;
                    setSelected(c);
                    centerOn(c);
                  }
                  if (e.key === 'Escape') setQuery('');
                }}
                placeholder="게임 찾기"
                className="w-32 rounded-full border border-white/[0.08] bg-[#0a0c16]/80 px-3 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
              />
            </div>
            <div className="absolute right-4 bottom-4 z-10 flex gap-1.5">
              {[
                ['＋', () => setView((v) => ({ k: Math.min(3, v.k * 1.25), x: width / 2 - ((width / 2 - v.x) / v.k) * Math.min(3, v.k * 1.25), y: H / 2 - ((H / 2 - v.y) / v.k) * Math.min(3, v.k * 1.25) }))],
                ['－', () => setView((v) => ({ k: Math.max(0.4, v.k / 1.25), x: width / 2 - ((width / 2 - v.x) / v.k) * Math.max(0.4, v.k / 1.25), y: H / 2 - ((H / 2 - v.y) / v.k) * Math.max(0.4, v.k / 1.25) }))],
                ['맞춤', () => setView({ k: 1, x: 0, y: 0 })],
                [motion ? '출렁임 끄기' : '출렁임 켜기', () => setMotion((m) => !m)],
                [
                  '다시 섞기',
                  () => {
                    for (const c of base.carts) {
                      c.x = width / 2 + (Math.random() - 0.5) * width * 0.6;
                      c.y = H / 2 + (Math.random() - 0.5) * H * 0.6;
                    }
                    simRef.current?.alpha(1).restart();
                  },
                ],
              ].map(([label, fn]) => (
                <button
                  key={label as string}
                  onClick={fn as () => void}
                  className="rounded-full border border-white/[0.08] bg-[#0a0c16]/80 px-3 py-1 text-[11px] text-white/60 backdrop-blur transition hover:border-white/25 hover:text-white"
                >
                  {label as string}
                </button>
              ))}
            </div>

            {width > 0 && (
              <svg
                ref={svgRef}
                width={width}
                height={H}
                role="img"
                aria-label="게임 카트리지 성단"
                className="touch-none select-none"
                onPointerDown={(e) => {
                  if (gesture.current) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
                }}
                onPointerMove={(e) => {
                  const g = gesture.current;
                  if (!g) return;
                  if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 4) g.moved = true;
                  if (g.kind === 'pan') setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
                  else {
                    const p = toWorld(e.clientX, e.clientY);
                    g.c.fx = p.x;
                    g.c.fy = p.y;
                  }
                }}
                onPointerUp={() => {
                  const g = gesture.current;
                  gesture.current = null;
                  if (!g) return;
                  if (g.kind === 'node') {
                    g.c.fx = null;
                    g.c.fy = null;
                    simRef.current?.alphaTarget(motion ? 0.025 : 0);
                    if (!g.moved) setSelected((s) => (s === g.c ? null : g.c));
                  } else if (!g.moved) {
                    setSelected(null);
                    setFocusGroup(null);
                  }
                }}
              >
                <defs>
                  <pattern id="cst-grid" width={22} height={22} patternUnits="userSpaceOnUse">
                    <circle cx={1} cy={1} r={0.9} fill="rgba(255,255,255,0.07)" />
                  </pattern>
                  {/* 빛무리: 흐린 원들을 모았다가 경계를 다시 세워, 가까운 원끼리 녹아 붙게 한다 */}
                  <filter id="cst-goo" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation={16} result="b" />
                    <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="g" />
                    <feGaussianBlur in="g" stdDeviation={2} />
                  </filter>
                </defs>
                <rect width={width} height={H} fill="url(#cst-grid)" />

                <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
                  {/* 빛무리 */}
                  {groups.map((g) => (
                    <g key={g.key} filter="url(#cst-goo)" opacity={focusGroup && focusGroup !== g.key ? 0.05 : 0.2} className="transition-opacity duration-300">
                      {base.carts
                        .filter((c) => c.group === g.key)
                        .map((c) => (
                          <circle
                            key={c.id}
                            ref={(el) => {
                              if (el) auraEls.current.set(c.id, el);
                              else auraEls.current.delete(c.id);
                            }}
                            cx={c.x}
                            cy={c.y}
                            r={c.s * 0.9 + 14}
                            fill={g.color}
                          />
                        ))}
                    </g>
                  ))}

                  {/* 연결: 가는 실선 + 추천 방향으로 지나가는 빛 알갱이 */}
                  <g fill="none">
                    {flows.map((f, i) => {
                      const on = linkLit(f);
                      return (
                        <g key={`${f.source.id}-${f.target.id}`} opacity={on ? 1 : 0.08} className="transition-opacity duration-200">
                          <path
                            id={`cst-flow-${i}`}
                            ref={(el) => {
                              if (el) linkEls.current.set(i, el);
                              else linkEls.current.delete(i);
                            }}
                            d={curve(f.source, f.target)}
                            stroke={f.source.color}
                            strokeOpacity={pivot && on ? 0.8 : 0.32}
                            strokeWidth={pivot && on ? 1.6 : 1}
                          />
                          {motion && (
                            <circle r={pivot && on ? 2.6 : 1.8} fill="#fff" opacity={0.85}>
                              <animateMotion dur={`${2.2 + (i % 5) * 0.35}s`} repeatCount="indefinite" begin={`${(i * 0.37) % 2}s`}>
                                <mpath href={`#cst-flow-${i}`} />
                              </animateMotion>
                            </circle>
                          )}
                        </g>
                      );
                    })}
                  </g>

                  {/* 카트리지 */}
                  {base.carts.map((c) => {
                    const on = lit(c);
                    return (
                      <g
                        key={c.id}
                        ref={(el) => {
                          if (el) nodeEls.current.set(c.id, el);
                          else nodeEls.current.delete(c.id);
                        }}
                        transform={`translate(${c.x ?? 0},${c.y ?? 0})`}
                        opacity={on ? 1 : 0.18}
                        className="cursor-pointer transition-opacity duration-200"
                        onPointerEnter={() => setHover(c)}
                        onPointerLeave={() => setHover((h) => (h === c ? null : h))}
                        onDoubleClick={() => onOpen(c.id)}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          svgRef.current?.setPointerCapture(e.pointerId);
                          gesture.current = { kind: 'node', c, sx: e.clientX, sy: e.clientY, moved: false };
                          c.fx = c.x;
                          c.fy = c.y;
                          simRef.current?.alphaTarget(0.3).restart();
                        }}
                      >
                        <Cartridge c={c} clipId={`cst-${c.id.replace(/\W/g, '')}`} selected={selected === c} />
                        {on && (top14.has(c.id) || pivot === c || (matches?.has(c.id) ?? false)) && (
                          <text
                            y={c.s * 0.58 + 13}
                            textAnchor="middle"
                            className="pointer-events-none text-[11px]"
                            fill="rgba(255,255,255,0.85)"
                            stroke="#04050a"
                            strokeWidth={3}
                            paintOrder="stroke"
                            strokeLinejoin="round"
                          >
                            {c.node.label.length > 18 ? `${c.node.label.slice(0, 17)}…` : c.node.label}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* 무리 이름표 (누르면 그 무리에 집중) */}
                  {groups.map((g) => {
                    // 한글은 라틴 글자보다 넓다: 글자마다 폭을 따로 어림한다
                    const shown = g.name.length > 22 ? `${g.name.slice(0, 21)}…` : g.name;
                    const textW = [...shown].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 11 : 6.4), 0) + String(g.count).length * 6.5 + 6;
                    const w = textW + 34;
                    return (
                      <g
                        key={g.key}
                        ref={(el) => {
                          if (el) chipEls.current.set(g.key, el);
                          else chipEls.current.delete(g.key);
                        }}
                        className="cursor-pointer"
                        opacity={focusGroup && focusGroup !== g.key ? 0.35 : 1}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setFocusGroup((f) => (f === g.key ? null : g.key))}
                      >
                        <rect x={-w / 2} y={-11} width={w} height={22} rx={11} fill="#0a0c16" stroke={g.color} strokeOpacity={0.6} />
                        <circle cx={-w / 2 + 12} r={3.5} fill={g.color} />
                        <text x={-w / 2 + 22} dy="0.35em" className="fill-white/80 text-[11px]">
                          {shown}
                          <tspan className="fill-white/35 font-mono text-[10px]"> {g.count}</tspan>
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}

            {/* 선택한 게임 */}
            {selected && (
              <div className="absolute top-16 right-4 z-10 w-[260px] rounded-2xl border border-white/10 bg-[#0b0d17]/95 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="eyebrow !text-[9px]">{groupName(selected.group)}</div>
                    <div className="mt-1 text-[14px] font-medium text-white">{selected.node.label}</div>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-white/40 hover:text-white" aria-label="닫기">
                    ✕
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                  <div>
                    <div className="text-white/40">플레이</div>
                    <div className="num font-mono text-white/90">{fmtHours(selected.node.hours)}</div>
                  </div>
                  <div>
                    <div className="text-white/40">상태</div>
                    <div className="text-white/90">{PLAY_STATUS[selected.node.game!.status].label.ko}</div>
                  </div>
                  <div>
                    <div className="text-white/40">최근 2주</div>
                    <div className="num font-mono text-white/90">{fmtHours(selected.node.game!.hours2w)}</div>
                  </div>
                  <div>
                    <div className="text-white/40">업적</div>
                    <div className="num font-mono text-white/90">
                      {selected.node.game!.achievements ? `${selected.node.game!.achievements.unlocked}/${selected.node.game!.achievements.total}` : '—'}
                    </div>
                  </div>
                </div>
                {similarOf(selected).length > 0 && (
                  <div className="mt-3">
                    <div className="eyebrow !text-[9px] mb-1.5">비슷한 게임</div>
                    <div className="flex flex-col">
                      {similarOf(selected)
                        .slice(0, 5)
                        .map(({ other, sim, out }) => (
                          <button
                            key={other.id}
                            onClick={() => (setSelected(other), centerOn(other, view.k))}
                            className="flex items-center justify-between rounded-md px-1.5 py-1 text-left text-[11.5px] text-white/70 hover:bg-white/[0.05] hover:text-white"
                          >
                            <span className="truncate">
                              {out ? '→ ' : '← '}
                              {other.node.label}
                            </span>
                            <span className="num ml-2 font-mono text-[10px] text-white/35">{Math.round(sim * 100)}%</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => onOpen(selected.id)}
                  className="mt-3 w-full rounded-full border border-white/15 py-1.5 text-[11.5px] text-white/80 transition hover:border-white/40 hover:text-white"
                >
                  그래프 탐색기에서 열기
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
