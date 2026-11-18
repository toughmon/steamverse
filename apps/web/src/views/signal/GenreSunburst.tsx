import { useMemo, useState } from 'react';
import { hierarchy, partition, type HierarchyRectangularNode } from 'd3-hierarchy';
import { arc } from 'd3-shape';
import type { OntologyGraph } from '@steamverse/shared';
import { ChartCard, LegendItem, useSize } from '../charts/kit';
import { CAT8, OTHER, SURFACE, fmtHours, gamesOf, orgOf, topNames } from './data';

const GENRES = 7;
const DEVS_PER_GENRE = 5;
const MAX_SIZE = 540;

interface Datum {
  name: string;
  hours?: number;
  /** 게임 노드 id (탐색기로 열기) */
  id?: string;
  children?: Datum[];
}
type Arc = HierarchyRectangularNode<Datum>;

/**
 * 시간의 궤도: 안쪽부터 장르 → 개발사 → 게임. 각도 = 플레이 시간.
 * 장르 7개까지만 색을 주고 나머지는 '기타'(회색)로 접는다.
 */
export function GenreSunburst({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Arc | null>(null);

  const d = useMemo(() => {
    const games = gamesOf(graph).filter((g) => g.hours > 0);
    const genreOf = (g: (typeof games)[number]) => g.game!.genres[0] ?? '장르 없음';
    const genreHours = new Map<string, number>();
    for (const g of games) genreHours.set(genreOf(g), (genreHours.get(genreOf(g)) ?? 0) + g.hours);
    const keep = topNames(genreHours, GENRES);
    const genreName = (g: (typeof games)[number]) => (keep.has(genreOf(g)) ? genreOf(g) : '기타');

    const byGenre = new Map<string, typeof games>();
    for (const g of games) byGenre.set(genreName(g), [...(byGenre.get(genreName(g)) ?? []), g]);

    const children: Datum[] = [...byGenre.entries()].map(([genre, list]) => {
      const devHours = new Map<string, number>();
      const devOf = (g: (typeof list)[number]) => orgOf(graph, g.id, 'developedBy') ?? '개발사 모름';
      for (const g of list) devHours.set(devOf(g), (devHours.get(devOf(g)) ?? 0) + g.hours);
      const keepDev = topNames(devHours, DEVS_PER_GENRE);
      const byDev = new Map<string, typeof list>();
      for (const g of list) {
        const k = keepDev.has(devOf(g)) ? devOf(g) : '그 밖의 개발사';
        byDev.set(k, [...(byDev.get(k) ?? []), g]);
      }
      return {
        name: genre,
        children: [...byDev.entries()].map(([dev, gs]) => ({
          name: dev,
          children: gs.map((g) => ({ name: g.label, hours: g.hours, id: g.id })),
        })),
      };
    });
    // 색은 시간 순 장르 순서로 고정 ('기타'는 항상 회색, 맨 뒤)
    const order = [...keep].sort((a, b) => (genreHours.get(b) ?? 0) - (genreHours.get(a) ?? 0));
    const color = (genre: string) => {
      const i = order.indexOf(genre);
      return i >= 0 ? CAT8[i]! : OTHER;
    };
    const total = games.reduce((s, g) => s + g.hours, 0);
    const legend = [...order, ...(byGenre.has('기타') ? ['기타'] : [])].map((g) => ({
      name: g,
      hours: byGenre.get(g)?.reduce((s, x) => s + x.hours, 0) ?? 0,
    }));
    return { root: { name: '전체', children } as Datum, color, total, legend };
  }, [graph]);

  const size = Math.min(MAX_SIZE, width || MAX_SIZE);
  const radius = size / 2 - 8;
  const nodes = useMemo(() => {
    const root = hierarchy(d.root)
      .sum((x) => x.hours ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return partition<Datum>().size([2 * Math.PI, radius])(root).descendants().filter((n) => n.depth > 0 && n.x1 - n.x0 > 0.002);
  }, [d, radius]);

  // 가운데는 비워 둔다 (안쪽 22%)
  const r0 = radius * 0.22;
  const ring = (y: number) => r0 + (y / radius) * (radius - r0);
  const arcPath = arc<Arc>()
    .startAngle((n) => n.x0)
    .endAngle((n) => n.x1)
    .padAngle(0.004)
    .padRadius(radius / 2)
    .innerRadius((n) => ring(n.y0))
    .outerRadius((n) => ring(n.y1) - 1.5)
    .cornerRadius(2);

  const genreOfNode = (n: Arc) => n.ancestors().find((a) => a.depth === 1)!.data.name;
  const onPath = (n: Arc) => !hover || hover.ancestors().includes(n) || n.ancestors().includes(hover);
  const depthOpacity = [1, 1, 0.72, 0.48];
  const top = d.legend[0];

  return (
    <ChartCard
      index="02"
      eyebrow="Orbit of time"
      title="시간의 궤도"
      headline={
        top ? (
          <>
            시간의 {Math.round((top.hours / d.total) * 100)}%가
            <br />
            <span className="text-white/90">{top.name}</span> 궤도를 돌아요
          </>
        ) : (
          '아직 플레이한 게임이 없어요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            안쪽부터 장르, 개발사, 게임입니다. 조각의 각도가 플레이 시간이에요. 조각에 마우스를 올리면 그 갈래만 남고, 게임 조각을 누르면 그래프 탐색기로 갑니다.
          </p>
          <div className="flex flex-col gap-1.5">
            {d.legend.map((g) => (
              <LegendItem key={g.name} color={d.color(g.name)} label={`${g.name} · ${fmtHours(g.hours)}`} />
            ))}
          </div>
        </>
      }
      table={{
        columns: [{ label: '장르' }, { label: '개발사' }, { label: '게임' }, { label: '플레이 시간', align: 'right' }],
        rows: nodes
          .filter((n) => n.depth === 3)
          .map((n) => [genreOfNode(n), n.parent!.data.name, n.data.name, fmtHours(n.value ?? 0)]),
      }}
    >
      <div ref={ref} className="relative flex justify-center" onMouseLeave={() => setHover(null)}>
        {d.total > 0 && (
          <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="img" aria-label="장르·개발사·게임 선버스트">
            {nodes.map((n, i) => (
              <path
                key={i}
                d={arcPath(n) ?? undefined}
                fill={d.color(genreOfNode(n))}
                fillOpacity={(depthOpacity[n.depth] ?? 0.4) * (onPath(n) ? 1 : 0.18)}
                stroke={SURFACE}
                strokeWidth={0.75}
                className={`transition-[fill-opacity] duration-200 ${n.data.id ? 'cursor-pointer' : ''}`}
                onMouseEnter={() => setHover(n)}
                onClick={() => n.data.id && onOpen(n.data.id)}
              />
            ))}
            {/* 가운데: 마우스를 올린 갈래 */}
            <g className="pointer-events-none" textAnchor="middle">
              {hover ? (
                <>
                  <text y={-22} className="fill-white/40 text-[10px]">
                    {hover
                      .ancestors()
                      .reverse()
                      .slice(1, -1)
                      .map((a) => a.data.name)
                      .join(' › ')
                      .slice(0, 34)}
                  </text>
                  <text y={-2} className="fill-white text-[13px] font-medium">
                    {hover.data.name.length > 18 ? `${hover.data.name.slice(0, 17)}…` : hover.data.name}
                  </text>
                  <text y={20} className="fill-white/70 font-mono text-[12px]">
                    {fmtHours(hover.value ?? 0)} · {Math.round(((hover.value ?? 0) / d.total) * 100)}%
                  </text>
                </>
              ) : (
                <>
                  <text y={-4} className="fill-white text-[20px] font-semibold">
                    {fmtHours(d.total)}
                  </text>
                  <text y={16} className="fill-white/40 text-[10.5px]">
                    전체 플레이 시간
                  </text>
                </>
              )}
            </g>
          </svg>
        )}
      </div>
    </ChartCard>
  );
}
