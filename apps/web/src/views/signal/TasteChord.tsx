import { useMemo, useState } from 'react';
import { chord, ribbon, type Chord, type ChordGroup } from 'd3-chord';
import { arc } from 'd3-shape';
import type { OntologyGraph } from '@steamverse/shared';
import { ChartCard, LegendItem, TipRow, Tooltip, useSize } from '../charts/kit';
import { CAT8, SURFACE, fmtHours, gamesOf } from './data';

const N = 8;
const MAX_SIZE = 560;

/**
 * 취향 코드: 많이 한 태그 8개가 같은 게임 안에서 얼마나 얽혀 있는지.
 * 리본 두께 = 두 태그를 모두 가진 게임의 플레이 시간 합.
 */
export function TasteChord({ graph }: { graph: OntologyGraph }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hoverTag, setHoverTag] = useState<number | null>(null);
  const [hoverRibbon, setHoverRibbon] = useState<{ c: Chord; x: number; y: number } | null>(null);

  const d = useMemo(() => {
    const games = gamesOf(graph).filter((g) => g.hours > 0 && g.game!.tags.length);
    const tagHours = new Map<string, number>();
    for (const g of games) for (const t of g.game!.tags) tagHours.set(t, (tagHours.get(t) ?? 0) + g.hours);
    const tags = [...tagHours.entries()].sort((a, b) => b[1] - a[1]).slice(0, N).map(([t]) => t);
    const idx = new Map(tags.map((t, i) => [t, i]));
    const m = tags.map(() => tags.map(() => 0));
    const pairGames = tags.map(() => tags.map(() => 0));
    for (const g of games) {
      const own = g.game!.tags.map((t) => idx.get(t)).filter((i): i is number => i !== undefined);
      for (const i of own) for (const j of own) if (i !== j) {
        m[i]![j]! += g.hours;
        pairGames[i]![j]! += 1;
      }
    }
    const pairs: { a: number; b: number; hours: number; games: number }[] = [];
    for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) if (m[i]![j]! > 0) pairs.push({ a: i, b: j, hours: m[i]![j]!, games: pairGames[i]![j]! });
    pairs.sort((x, y) => y.hours - x.hours);
    return { tags, tagHours, m, pairGames, pairs };
  }, [graph]);

  const size = Math.min(MAX_SIZE, width || MAX_SIZE);
  // 이름표가 둘레 바깥으로 나가므로 여백을 넉넉히 (긴 태그 이름이 잘리지 않게)
  const outer = size / 2 - 96;
  const inner = outer - 12;
  const layout = useMemo(() => (d.tags.length >= 3 ? chord().padAngle(0.045).sortSubgroups((a, b) => b - a)(d.m) : null), [d]);
  const arcPath = arc<ChordGroup>().innerRadius(inner).outerRadius(outer).cornerRadius(2);
  const ribbonPath = ribbon<Chord, unknown>().radius(inner - 2);

  const top = d.pairs[0];
  const active = (c: Chord) => hoverTag === null || c.source.index === hoverTag || c.target.index === hoverTag;

  return (
    <ChartCard
      index="01"
      eyebrow="Taste chord"
      title="취향 코드"
      headline={
        top ? (
          <>
            <span className="text-white/90">{d.tags[top.a]}</span>과(와) <span className="text-white/90">{d.tags[top.b]}</span>이(가)
            <br />
            가장 단단히 엮여 있어요
          </>
        ) : (
          '태그 정보가 아직 부족해요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            많이 한 태그 8개를 둘레에 두고, 같은 게임에 함께 붙은 태그끼리 리본으로 이었습니다. 리본이 굵을수록 두 태그를 모두 가진 게임에 시간을 많이 썼다는
            뜻이에요.
          </p>
          <div className="flex flex-col gap-1.5">
            {d.tags.map((t, i) => (
              <LegendItem key={t} color={CAT8[i]!} label={`${t} · ${fmtHours(d.tagHours.get(t) ?? 0)}`} />
            ))}
          </div>
        </>
      }
      table={{
        columns: [{ label: '태그 A' }, { label: '태그 B' }, { label: '함께 붙은 게임', align: 'right' }, { label: '플레이 시간', align: 'right' }],
        rows: d.pairs.map((p) => [d.tags[p.a]!, d.tags[p.b]!, `${p.games}개`, fmtHours(p.hours)]),
      }}
    >
      <div ref={ref} className="relative flex justify-center" onMouseLeave={() => (setHoverTag(null), setHoverRibbon(null))}>
        {layout ? (
          <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} role="img" aria-label="태그 공존 코드 다이어그램" className="overflow-visible">
            <g>
              {layout.map((c, i) => (
                <path
                  key={i}
                  d={ribbonPath(c) as unknown as string}
                  fill={CAT8[c.source.index]}
                  fillOpacity={hoverRibbon?.c === c ? 0.85 : active(c) ? 0.5 : 0.05}
                  stroke={SURFACE}
                  strokeWidth={1}
                  className="cursor-pointer transition-[fill-opacity] duration-200"
                  onMouseMove={(e) => {
                    const r = e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect();
                    setHoverRibbon({ c, x: e.clientX - r.left, y: e.clientY - r.top });
                  }}
                  onMouseLeave={() => setHoverRibbon(null)}
                />
              ))}
            </g>
            {layout.groups.map((g) => {
              const mid = (g.startAngle + g.endAngle) / 2;
              const flip = mid > Math.PI;
              return (
                <g key={g.index} onMouseEnter={() => setHoverTag(g.index)} className="cursor-pointer">
                  <path d={arcPath(g) ?? undefined} fill={CAT8[g.index]} opacity={hoverTag === null || hoverTag === g.index ? 1 : 0.35} />
                  {/* 이름표: 둘레 바깥, 왼쪽 반은 뒤집어 읽히게 */}
                  <text
                    transform={`rotate(${(mid * 180) / Math.PI - 90}) translate(${outer + 10}) ${flip ? 'rotate(180)' : ''}`}
                    textAnchor={flip ? 'end' : 'start'}
                    dy="0.35em"
                    className="fill-white/75 text-[11px]"
                  >
                    {d.tags[g.index]}
                  </text>
                </g>
              );
            })}
          </svg>
        ) : (
          <div className="grid h-[320px] place-items-center text-[13px] text-white/40">태그가 붙은 게임이 3개 이상 필요해요</div>
        )}
        {hoverRibbon && (
          <Tooltip x={hoverRibbon.x} y={hoverRibbon.y} width={width}>
            <div className="mb-1.5 text-[12.5px] font-medium text-white">
              {d.tags[hoverRibbon.c.source.index]} × {d.tags[hoverRibbon.c.target.index]}
            </div>
            <TipRow label="함께 붙은 게임" value={`${d.pairGames[hoverRibbon.c.source.index]![hoverRibbon.c.target.index]}개`} />
            <TipRow label="플레이 시간" value={fmtHours(d.m[hoverRibbon.c.source.index]![hoverRibbon.c.target.index]!)} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
