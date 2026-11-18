import { useMemo, useState } from 'react';
import { forceCollide, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { scaleLinear } from 'd3-scale';
import { PLAY_STATUS, type OntNode, type OntologyGraph } from '@steamverse/shared';
import { ChartCard, LegendItem, TipRow, Tooltip, useSize } from '../charts/kit';
import { CAT8, SURFACE, fmtHours, gamesOf } from './data';

const H = 300;
const M = { t: 16, r: 18, b: 34, l: 18 };
const PLAYED = CAT8[0];
const SLEEP = 'rgba(255,255,255,0.38)';

interface Dot extends SimulationNodeDatum {
  node: OntNode;
  r: number;
  year: number;
  awake: boolean;
}

/**
 * 시대의 군집: 출시 연도 축 위에 게임을 하나씩 쌓는다 (점 크기 = 플레이 시간).
 * 2시간 이상 한 게임은 채운 점, 백로그·찍먹은 빈 점.
 */
export function EraSwarm({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Dot | null>(null);

  const games = useMemo(() => gamesOf(graph).filter((g) => g.game!.releaseYear > 1980), [graph]);
  const years = games.map((g) => g.game!.releaseYear);
  const lo = years.length ? Math.min(...years) : 2000;
  const hi = years.length ? Math.max(...years) : 2025;

  const dots = useMemo(() => {
    if (!width) return [] as Dot[];
    const x = scaleLinear()
      .domain([lo - 0.5, hi + 0.5])
      .range([M.l, width - M.r]);
    const cy = M.t + (H - M.t - M.b) / 2;
    const list: Dot[] = games.map((g) => {
      const year = g.game!.releaseYear;
      return {
        node: g,
        year,
        r: Math.min(18, 3 + Math.sqrt(g.hours) * 0.55),
        awake: g.game!.status === 'played' || g.game!.status === 'favorite',
        x: x(year),
        y: cy,
      };
    });
    // 같은 데이터면 같은 배치가 나오도록 고정 횟수만 돌린다
    forceSimulation(list)
      .force('x', forceX<Dot>((dd) => x(dd.year)).strength(0.9))
      .force('y', forceY<Dot>(cy).strength(0.07))
      .force('collide', forceCollide<Dot>((dd) => dd.r + 1.5).iterations(3))
      .stop()
      .tick(260);
    for (const dd of list) dd.y = Math.max(M.t + dd.r, Math.min(H - M.b - dd.r, dd.y!));
    return list;
  }, [games, width, lo, hi]);

  const x = scaleLinear()
    .domain([lo - 0.5, hi + 0.5])
    .range([M.l, (width || 600) - M.r]);
  const span = hi - lo;
  const step = span > 30 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) ticks.push(y);

  // 시간이 가장 많이 몰린 5년 구간
  const peak = useMemo(() => {
    let best = { from: lo, hours: -1 };
    for (let y = lo; y <= hi; y++) {
      const h = games.filter((g) => g.game!.releaseYear >= y && g.game!.releaseYear < y + 5).reduce((s, g) => s + g.hours, 0);
      if (h > best.hours) best = { from: y, hours: h };
    }
    return best;
  }, [games, lo, hi]);
  const sleeping = games.filter((g) => g.game!.status === 'backlog' || g.game!.status === 'tried');
  const sleepMedian = sleeping.length ? [...sleeping].map((g) => g.game!.releaseYear).sort((a, b) => a - b)[Math.floor(sleeping.length / 2)] : undefined;

  const nearest = (mx: number, my: number) => {
    let best: Dot | null = null;
    let bd = 24 * 24;
    for (const dd of dots) {
      const dist = (dd.x! - mx) ** 2 + (dd.y! - my) ** 2 - dd.r * dd.r;
      if (dist < bd) {
        bd = dist;
        best = dd;
      }
    }
    return best;
  };

  return (
    <ChartCard
      index="03"
      eyebrow="Era swarm"
      title="시대의 군집"
      headline={
        peak.hours > 0 ? (
          <>
            <span className="text-white/90">
              {peak.from}–{peak.from + 4}년
            </span>{' '}
            출시작에
            <br />
            시간이 가장 몰려 있어요
          </>
        ) : (
          '출시 연도 정보가 아직 없어요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            게임 하나가 점 하나, 가로 위치가 출시 연도, 크기가 플레이 시간입니다.
            {sleepMedian !== undefined && ` 아직 잠든 게임은 ${sleepMedian}년 전후에 가장 많아요.`}
          </p>
          <div className="flex flex-col gap-1.5">
            <LegendItem color={PLAYED} label="2시간 이상 플레이" />
            <span className="flex items-center gap-2 text-[11.5px] text-white/60">
              <span className="size-2 rounded-full border" style={{ borderColor: SLEEP }} />
              백로그 · 찍먹 (잠든 게임)
            </span>
          </div>
        </>
      }
      table={{
        columns: [{ label: '게임' }, { label: '출시', align: 'right' }, { label: '플레이 시간', align: 'right' }, { label: '상태' }],
        rows: [...games].sort((a, b) => a.game!.releaseYear - b.game!.releaseYear).map((g) => [g.label, String(g.game!.releaseYear), fmtHours(g.hours), PLAY_STATUS[g.game!.status].label.ko]),
      }}
    >
      <div
        ref={ref}
        className="relative"
        style={{ height: H }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(nearest(e.clientX - r.left, e.clientY - r.top));
        }}
        onMouseLeave={() => setHover(null)}
        onClick={() => hover && onOpen(hover.node.id)}
      >
        {width > 0 && (
          <svg width={width} height={H} role="img" aria-label="출시 연도별 게임 분포" className={hover ? 'cursor-pointer' : ''}>
            {/* 축: 실선 헤어라인 */}
            <line x1={M.l} x2={width - M.r} y1={H - M.b + 6} y2={H - M.b + 6} stroke="rgba(255,255,255,0.1)" />
            {ticks.map((t) => (
              <g key={t} transform={`translate(${x(t)},${H - M.b + 6})`}>
                <line y2={4} stroke="rgba(255,255,255,0.2)" />
                <text y={18} textAnchor="middle" className="num fill-white/40 font-mono text-[10px]">
                  {t}
                </text>
              </g>
            ))}
            {dots.map((dd) => {
              const on = hover === dd;
              return dd.awake ? (
                <circle key={dd.node.id} cx={dd.x} cy={dd.y} r={dd.r} fill={PLAYED} fillOpacity={on ? 1 : 0.82} stroke={on ? '#fff' : SURFACE} strokeWidth={on ? 1.5 : 1.5} />
              ) : (
                <circle key={dd.node.id} cx={dd.x} cy={dd.y} r={Math.max(3, dd.r - 0.75)} fill="none" stroke={on ? '#fff' : SLEEP} strokeWidth={1.5} />
              );
            })}
          </svg>
        )}
        {hover && (
          <Tooltip x={hover.x!} y={hover.y!} width={width}>
            <div className="mb-1.5 text-[12.5px] font-medium text-white">{hover.node.label}</div>
            <TipRow label="출시" value={`${hover.year}년`} />
            <TipRow label="플레이" value={fmtHours(hover.node.hours)} />
            <TipRow label="상태" value={PLAY_STATUS[hover.node.game!.status].label.ko} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
