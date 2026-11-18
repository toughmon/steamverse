import { useMemo, useState } from 'react';
import { hierarchy, type HierarchyNode } from 'd3-hierarchy';
import { voronoiTreemap, type Point } from 'd3-voronoi-treemap';
import { steamImage, type OntologyGraph } from '@steamverse/shared';
import { formatHours } from '../../lib/format';
import { GameImage, gameTint } from '../../components/GameImage';
import { ChartCard, INK, SERIES, TipRow, Tooltip, useSize } from './kit';

const H = 480;
const MIN_HOURS = 2;

interface Datum {
  name: string;
  children?: Datum[];
  id?: string;
  appid?: number;
  hours?: number;
  dev?: string;
  pub?: string;
}
type Cell = HierarchyNode<Datum> & { polygon?: Point[] };

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centroid(poly: Point[]): { x: number; y: number; area: number } {
  let a = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[(i + 1) % poly.length]!;
    const f = x0 * y1 - x1 * y0;
    a += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  a /= 2;
  return { x: x / (6 * a), y: y / (6 * a), area: Math.abs(a) };
}

const pathOf = (poly: Point[]) => `M${poly.map((p) => p.join(',')).join('L')}Z`;

export function EmpireMap({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Cell | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  // 유통사 → 개발사 → 게임
  const tree = useMemo(() => {
    const orgOf = (gameId: string, rel: 'developedBy' | 'publishedBy') => {
      const e = (graph.adjacency.get(gameId) ?? []).find((x) => x.rel === rel && x.source === gameId);
      return e ? graph.nodeById.get(e.target)!.label : '알 수 없음';
    };
    const pubs = new Map<string, Map<string, Datum[]>>();
    let excluded = 0;
    for (const n of graph.nodes) {
      if (n.cls !== 'Game') continue;
      if (n.hours < MIN_HOURS) {
        excluded++;
        continue;
      }
      const pub = orgOf(n.id, 'publishedBy');
      const dev = orgOf(n.id, 'developedBy');
      const devs = pubs.get(pub) ?? new Map<string, Datum[]>();
      const list = devs.get(dev) ?? [];
      list.push({ name: n.label, id: n.id, appid: n.game!.appid, hours: n.hours, dev, pub });
      devs.set(dev, list);
      pubs.set(pub, devs);
    }
    const root: Datum = {
      name: 'root',
      children: [...pubs].map(([pub, devs]) => ({
        name: pub,
        children: [...devs].map(([dev, games]) => ({ name: dev, children: games })),
      })),
    };
    return { root, excluded };
  }, [graph]);

  // 너비가 조금 바뀔 때마다 다시 계산하지 않도록 40px 단위로 묶는다
  const W = Math.floor(width / 40) * 40;
  const layout = useMemo(() => {
    if (W <= 0) return null;
    const root = hierarchy(tree.root).sum((d) => d.hours ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) as Cell;
    const c = 26;
    const clip: Point[] = [[c, 0], [0, c], [0, H - c], [c, H], [W - c, H], [W, H - c], [W, c], [W - c, 0]];
    voronoiTreemap().clip(clip).prng(mulberry32(11)).convergenceRatio(0.004).maxIterationCount(120).minWeightRatio(0.005)(root);
    const total = root.value ?? 1;
    const pubs = (root.children ?? []) as Cell[];
    const leaves = root.leaves() as Cell[];
    const devs = root.descendants().filter((d) => d.depth === 2) as Cell[];
    return { root, total, pubs, leaves, devs, clip };
  }, [tree, W]);

  const top = layout?.pubs.slice(0, 5) ?? [];
  const lead = top[0];
  const top3Share = layout ? top.slice(0, 3).reduce((s, p) => s + (p.value ?? 0), 0) / layout.total : 0;

  return (
    <ChartCard
      index="03"
      eyebrow="Publisher empire"
      title="개발사 제국 지도"
      headline={
        lead && layout ? (
          <>
            내 시간의 {Math.round(((lead.value ?? 0) / layout.total) * 100)}%는
            <br />
            <span style={{ color: SERIES.me }}>{lead.data.name}</span>의 영토예요
          </>
        ) : (
          '…'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            면적이 플레이 시간입니다. 굵은 경계는 유통사, 가는 경계는 개발사예요. 상위 3개 유통사가 전체의 {Math.round(top3Share * 100)}%를
            차지합니다. (2시간 미만 게임 {tree.excluded}개 제외)
          </p>
          <ol className="flex flex-col gap-2.5">
            {top.map((p, i) => {
              const share = (p.value ?? 0) / (layout?.total ?? 1);
              return (
                <li key={p.data.name}>
                  <div className="flex items-baseline gap-2.5 text-[12.5px]">
                    <span className="font-mono text-[10.5px] text-white/30">{String(i + 1).padStart(2, '0')}</span>
                    <span className="flex-1 truncate text-white/80">{p.data.name}</span>
                    <span className="num font-mono text-[11px] text-white/45">{Math.round(share * 100)}%</span>
                  </div>
                  <div className="mt-1.5 ml-[26px] h-[3px] rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: SERIES.me }} />
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      }
      table={{
        columns: [{ label: '유통사' }, { label: '개발사' }, { label: '게임' }, { label: '시간', align: 'right' }],
        rows: (layout?.leaves ?? []).map((l) => [l.data.pub ?? '', l.data.dev ?? '', l.data.name, formatHours(l.data.hours ?? 0)]),
      }}
    >
      <div ref={ref} className="relative" style={{ height: H }} onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setMouse({ x: e.clientX - r.left, y: e.clientY - r.top });
      }}>
        {layout && (
          <svg width={W} height={H} className="mx-auto block overflow-visible" onMouseLeave={() => setHover(null)}>
            <defs>
              {layout.leaves.map((l, i) => (
                <clipPath key={i} id={`em-c${i}`}>
                  <path d={pathOf(l.polygon!)} />
                </clipPath>
              ))}
            </defs>

            {/* 게임 영토: 대표 이미지로 채운다 */}
            {layout.leaves.map((l, i) => {
              const xs = l.polygon!.map((p) => p[0]);
              const ys = l.polygon!.map((p) => p[1]);
              const x0 = Math.min(...xs);
              const y0 = Math.min(...ys);
              const active = hover === l;
              return (
                <g
                  key={i}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover(l)}
                  onClick={() => l.data.id && onOpen(l.data.id)}
                >
                  {(() => {
                    const href = steamImage(l.data.appid!, 'header');
                    // 이미지를 껐거나 차단된 게임은 게임별 색으로 칠한다 (STEAM_COMPLIANCE C7)
                    return href ? (
                      <image
                        href={href}
                        x={x0}
                        y={y0}
                        width={Math.max(...xs) - x0}
                        height={Math.max(...ys) - y0}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#em-c${i})`}
                      />
                    ) : (
                      <path d={pathOf(l.polygon!)} fill={gameTint(l.data.appid!, 40)} />
                    );
                  })()}
                  <path d={pathOf(l.polygon!)} fill="#05060c" fillOpacity={active ? 0 : hover ? 0.62 : 0.42} className="transition-[fill-opacity] duration-200" />
                </g>
              );
            })}

            {/* 경계: 개발사는 가늘게, 유통사는 굵게 (표면색 간격) */}
            <g pointerEvents="none" fill="none" stroke={INK.surface} strokeLinejoin="round">
              {layout.leaves.map((l, i) => (
                <path key={`l${i}`} d={pathOf(l.polygon!)} strokeWidth={1} />
              ))}
              {layout.devs.map((d, i) => (
                <path key={`d${i}`} d={pathOf(d.polygon!)} strokeWidth={2} />
              ))}
              {layout.pubs.map((p, i) => (
                <path key={`p${i}`} d={pathOf(p.polygon!)} strokeWidth={5} />
              ))}
              <path d={pathOf(layout.clip)} strokeWidth={2} />
            </g>

            {/* 큰 영토에만 유통사 이름 */}
            <g pointerEvents="none">
              {layout.pubs.map((p) => {
                const c = centroid(p.polygon!);
                if (c.area < 11000) return null;
                return (
                  <g key={p.data.name} transform={`translate(${c.x} ${c.y})`} style={{ paintOrder: 'stroke' }}>
                    <text textAnchor="middle" fontSize="13" fontWeight={650} fill={INK.primary} stroke="rgba(4,5,10,0.85)" strokeWidth={4} strokeLinejoin="round">
                      {p.data.name}
                    </text>
                    <text y={16} textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.7)" stroke="rgba(4,5,10,0.85)" strokeWidth={4} strokeLinejoin="round" fontFamily="var(--font-mono)">
                      {Math.round(p.value ?? 0).toLocaleString()}h
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {hover && layout && (
          <Tooltip x={mouse.x} y={mouse.y} width={W}>
            <GameImage appid={hover.data.appid!} kind="capsule" fallback="none" className="mb-2 h-[44px] w-[117px] rounded-md object-cover" />
            <div className="mb-1.5 text-[12.5px] font-medium text-white">{hover.data.name}</div>
            <TipRow label="유통사" value={hover.data.pub ?? ''} />
            <TipRow label="개발사" value={hover.data.dev ?? ''} />
            <TipRow label="플레이" value={formatHours(hover.data.hours ?? 0)} />
            <TipRow label="영토 비중" value={`${(((hover.data.hours ?? 0) / layout.total) * 100).toFixed(1)}%`} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
