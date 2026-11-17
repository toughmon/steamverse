import { useMemo, useState } from 'react';
import { area, curveMonotoneX, line } from 'd3-shape';
import { scaleLinear } from 'd3-scale';
import { steamImage, type OntNode, type OntologyGraph } from '@steamverse/shared';
import { formatHours } from '../../lib/format';
import { ChartCard, INK, SERIES, TipRow, Tooltip, useSize } from './kit';

const H = 340;
const M = { t: 36, r: 20, b: 34, l: 46 };

export function LongTail({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const d = useMemo(() => {
    const games = graph.nodes.filter((n) => n.cls === 'Game').sort((a, b) => b.hours - a.hours);
    const total = games.reduce((s, g) => s + g.hours, 0);
    let acc = 0;
    const cum = games.map((g) => (acc += g.hours) / total);
    const half = cum.findIndex((c) => c >= 0.5) + 1;
    const topN = Math.min(5, cum.length);
    const top5 = cum[topN - 1] ?? 1;
    const tailStart = games.findIndex((g) => g.hours < 2);
    const tail = tailStart < 0 ? 0 : games.length - tailStart;
    return { games, total, cum, half, top5, topN, tailStart, tail };
  }, [graph]);

  const iw = Math.max(0, width - M.l - M.r);
  const ih = H - M.t - M.b;
  const x = scaleLinear().domain([0, d.games.length - 1]).range([0, iw]);
  const y = scaleLinear().domain([0, d.games[0]?.hours ?? 1]).nice().range([ih, 0]);
  const xs = (i: number) => x(i);
  const ys = (g: OntNode) => y(g.hours);
  const areaPath = area<OntNode>().x((_, i) => xs(i)).y0(ih).y1(ys).curve(curveMonotoneX)(d.games) ?? '';
  const linePath = line<OntNode>().x((_, i) => xs(i)).y(ys).curve(curveMonotoneX)(d.games) ?? '';
  const splitX = x(d.half - 0.5);
  const hg = hover !== null ? d.games[hover] : undefined;
  const top3 = d.games.slice(0, 3);

  return (
    <ChartCard
      index="01"
      eyebrow="Long tail"
      title="시간의 산맥"
      headline={
        <>
          플레이 시간의 절반이
          <br />
          <span style={{ color: SERIES.me }}>단 {d.half}개</span> 게임에 몰려 있어요
        </>
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            상위 {d.topN}개 게임이 전체 {Math.round(d.total).toLocaleString()}시간 중 {Math.round(d.top5 * 100)}%를 차지합니다. 나머지{' '}
            {d.tail}개는 2시간도 채 하지 않은 평원입니다.
          </p>
          <ol className="flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.07]">
            {top3.map((g, i) => (
              <li key={g.id}>
                <button onClick={() => onOpen(g.id)} className="group flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03]">
                  <span className="font-mono text-[10.5px] text-white/30">{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 truncate text-[12.5px] text-white/80 group-hover:text-white">{g.label}</span>
                  <span className="num font-mono text-[11px] text-white/45">{formatHours(g.hours)}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      }
      table={{
        columns: [{ label: '순위', align: 'right' }, { label: '게임' }, { label: '시간', align: 'right' }, { label: '누적', align: 'right' }],
        rows: d.games.map((g, i) => [i + 1, g.label, formatHours(g.hours), `${Math.round(d.cum[i]! * 100)}%`]),
      }}
    >
      <div ref={ref} className="relative" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H} className="overflow-visible">
            <defs>
              <linearGradient id="lt-head" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.me} stopOpacity="0.5" />
                <stop offset="1" stopColor={SERIES.me} stopOpacity="0.04" />
              </linearGradient>
              <linearGradient id="lt-tail" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SERIES.me} stopOpacity="0.18" />
                <stop offset="1" stopColor={SERIES.me} stopOpacity="0.02" />
              </linearGradient>
              <clipPath id="lt-left">
                <rect x={-1} y={-M.t} width={splitX + 1} height={H} />
              </clipPath>
              <clipPath id="lt-right">
                <rect x={splitX} y={-M.t} width={iw - splitX + 1} height={H} />
              </clipPath>
            </defs>
            <g transform={`translate(${M.l} ${M.t})`}>
              {y.ticks(4).map((t) => (
                <g key={t} transform={`translate(0 ${y(t)})`}>
                  <line x1={0} x2={iw} stroke={INK.grid} />
                  <text x={-10} dy="0.32em" textAnchor="end" fontSize="10" fill={INK.muted} fontFamily="var(--font-mono)">
                    {t}h
                  </text>
                </g>
              ))}

              {/* 머리(상위 절반 시간)는 진하게, 꼬리는 흐리게 */}
              <path d={areaPath} fill="url(#lt-head)" clipPath="url(#lt-left)" />
              <path d={areaPath} fill="url(#lt-tail)" clipPath="url(#lt-right)" />
              <path d={linePath} fill="none" stroke={SERIES.me} strokeWidth={2} strokeLinejoin="round" />

              {/* 50% 경계 */}
              <line x1={splitX} x2={splitX} y1={-8} y2={ih} stroke="rgba(255,255,255,0.35)" />
              <text x={splitX + 8} y={-2} fontSize="11" fill={INK.primary} fontWeight={600}>
                ← 여기까지 {d.half}개 = 시간의 50%
              </text>

              {/* 꼬리 평원 */}
              {d.tailStart > 0 && (
                <g transform={`translate(${(x(d.tailStart) + iw) / 2} ${ih - 26})`}>
                  <text textAnchor="middle" fontSize="11" fill={INK.secondary}>
                    {d.tail}개 게임이 2시간 미만
                  </text>
                  <line x1={x(d.tailStart) - (x(d.tailStart) + iw) / 2} x2={(iw - x(d.tailStart)) / 2} y1={10} y2={10} stroke="rgba(255,255,255,0.18)" />
                </g>
              )}

              {/* 정상 표시 */}
              {d.games[0] && (
                <g transform={`translate(${x(0)} ${y(d.games[0].hours)})`}>
                  <circle r={4} fill={SERIES.me} stroke={INK.surface} strokeWidth={2} />
                  <text x={10} dy="0.32em" fontSize="11.5" fill={INK.primary} fontWeight={600}>
                    {d.games[0].label}
                  </text>
                </g>
              )}

              {/* x축 */}
              <line x1={0} x2={iw} y1={ih} y2={ih} stroke="rgba(255,255,255,0.12)" />
              {[1, 10, 20, 30, 40, 50, 60, 70].filter((r) => r <= d.games.length).map((r) => (
                <text key={r} x={x(r - 1)} y={ih + 20} textAnchor="middle" fontSize="10" fill={INK.muted} fontFamily="var(--font-mono)">
                  {r}위
                </text>
              ))}

              {/* 호버 */}
              {hg && hover !== null && (
                <g transform={`translate(${x(hover)} 0)`}>
                  <line y1={0} y2={ih} stroke="rgba(255,255,255,0.25)" />
                  <circle cy={y(hg.hours)} r={5} fill={SERIES.me} stroke={INK.surface} strokeWidth={2} />
                </g>
              )}
              <rect
                width={iw}
                height={ih}
                fill="transparent"
                className="cursor-pointer"
                onMouseMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setHover(Math.max(0, Math.min(d.games.length - 1, Math.round(x.invert(e.clientX - r.left)))));
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => hg && onOpen(hg.id)}
              />
            </g>
          </svg>
        )}
        {hg && hover !== null && (
          <Tooltip x={M.l + x(hover)} y={M.t + y(hg.hours)} width={width}>
            <img src={steamImage(hg.game!.appid, 'capsule')} alt="" className="mb-2 h-[44px] w-[117px] rounded-md object-cover" />
            <div className="mb-1.5 text-[12.5px] font-medium text-white">{hg.label}</div>
            <TipRow label="순위" value={`${hover + 1}위`} />
            <TipRow label="플레이" value={formatHours(hg.hours)} />
            <TipRow label="누적 비중" value={`${Math.round(d.cum[hover]! * 100)}%`} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
