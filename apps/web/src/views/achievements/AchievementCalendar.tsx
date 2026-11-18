import { useMemo, useState } from 'react';
import type { OntologyGraph } from '@steamverse/shared';
import { ChartCard, Tooltip, TipRow, useSize } from '../charts/kit';
import { CAT8 } from '../signal/data';

/** 많을수록 밝게 — 어두운 표면(#06070d)에서 검증한 한 색 5단계 */
const RAMP = ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#cde2fb'];
const EMPTY = 'rgba(255,255,255,0.05)';
const CELL = 13;
const GAP = 3;
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

interface Day {
  key: string;
  date: Date;
  count: number;
  games: Map<string, number>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 이 컴퓨터의 시간대 기준 날짜 키 */
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * 업적 활동 캘린더: 업적을 깬 날을 잔디처럼 칠한다. 플레이 시간 기록이 없는 과거도 업적 시각으로 복원된다.
 */
export function AchievementCalendar({ graph }: { graph: OntologyGraph }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ day: Day; x: number; y: number } | null>(null);

  // 날짜별 해금 수와 그날의 게임
  const d = useMemo(() => {
    const days = new Map<string, Day>();
    for (const n of graph.nodes) {
      for (const u of n.game?.achievementLog ?? []) {
        const date = new Date(u.t * 1000);
        const k = dayKey(date);
        let day = days.get(k);
        if (!day) {
          day = { key: k, date: new Date(date.getFullYear(), date.getMonth(), date.getDate()), count: 0, games: new Map() };
          days.set(k, day);
        }
        day.count += 1;
        day.games.set(n.label, (day.games.get(n.label) ?? 0) + 1);
      }
    }
    const years = new Map<number, number>();
    for (const day of days.values()) years.set(day.date.getFullYear(), (years.get(day.date.getFullYear()) ?? 0) + day.count);
    return { days, years: [...years.entries()].sort((a, b) => a[0] - b[0]) };
  }, [graph]);

  const latest = d.years.at(-1)?.[0];
  const [pickedYear, setYear] = useState<number | null>(null);
  const year = pickedYear && d.years.some(([y]) => y === pickedYear) ? pickedYear : latest;

  // 고른 해의 주 × 요일 격자
  const grid = useMemo(() => {
    if (!year) return null;
    const first = new Date(year, 0, 1);
    const start = new Date(year, 0, 1 - first.getDay());
    const cells: { date: Date; day?: Day; inYear: boolean; week: number; dow: number }[] = [];
    for (let i = 0; ; i++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (date.getFullYear() > year && date.getDay() === 0) break;
      cells.push({ date, day: d.days.get(dayKey(date)), inYear: date.getFullYear() === year, week: Math.floor(i / 7), dow: date.getDay() });
    }
    const counts = cells.filter((c) => c.inYear && c.day).map((c) => c.day!.count).sort((a, b) => a - b);
    // 구간: 0 / 하위 20% / … / 상위 20% (해마다 몰아치는 정도가 달라서 그 해 분포로 나눈다)
    const q = (p: number) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))] ?? 1;
    const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const level = (n: number) => (n <= 0 ? -1 : cuts.filter((c) => n > c).length);

    // 통계
    const inYear = cells.filter((c) => c.inYear);
    const active = inYear.filter((c) => c.day);
    let streak = 0;
    let best = 0;
    for (const c of inYear) {
      streak = c.day ? streak + 1 : 0;
      best = Math.max(best, streak);
    }
    const busiest = active.reduce<(typeof active)[number] | null>((m, c) => (!m || c.day!.count > m.day!.count ? c : m), null);
    const byMonth = Array.from({ length: 12 }, () => new Map<string, number>());
    for (const c of active) for (const [g, n] of c.day!.games) byMonth[c.date.getMonth()]!.set(g, (byMonth[c.date.getMonth()]!.get(g) ?? 0) + n);
    const monthTotals = byMonth.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
    const topMonth = monthTotals.indexOf(Math.max(...monthTotals));
    const topGame = [...(byMonth[topMonth] ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      cells,
      weeks: (cells.at(-1)?.week ?? 0) + 1,
      level,
      cuts,
      total: active.reduce((a, c) => a + c.day!.count, 0),
      activeDays: active.length,
      best,
      busiest,
      topMonth,
      topGame,
    };
  }, [d, year]);

  const LEFT = 22;
  const TOP = 18;
  const gridW = grid ? LEFT + grid.weeks * (CELL + GAP) : 0;
  const scale = width && gridW > width ? width / gridW : 1;
  const maxYear = Math.max(1, ...d.years.map(([, n]) => n));

  if (!grid) {
    return (
      <ChartCard index="01" eyebrow="Achievement calendar" title="업적 활동 캘린더" headline="아직 업적 기록이 없어요" table={{ columns: [{ label: '날짜' }], rows: [] }}>
        <div className="grid h-[200px] place-items-center text-[13px] leading-relaxed text-white/40">
          업적이 있는 게임을 플레이했거나, Steam 프로필의 게임 세부 정보가 공개여야 보입니다
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      index="01"
      eyebrow="Achievement calendar"
      title="업적 활동 캘린더"
      headline={
        grid.total > 0 ? (
          <>
            {year}년엔 <span className="text-white/90">{grid.topMonth + 1}월</span>에 가장 불탔어요
            {grid.topGame && (
              <>
                <br />
                <span className="text-[17px] text-white/60">그달의 주인공은 {grid.topGame}</span>
              </>
            )}
          </>
        ) : (
          `${year}년엔 업적 기록이 없어요`
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            업적을 깬 날을 칸 하나로 칠했습니다. 밝을수록 그날 많이 깼다는 뜻이에요. 플레이 시간은 날짜별로 남지 않지만, 업적 시각으로 언제 무엇에 빠져 있었는지 되살릴 수
            있습니다.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['업적', `${grid.total.toLocaleString()}개`],
              ['활동한 날', `${grid.activeDays}일`],
              ['최장 연속', `${grid.best}일`],
              ['가장 몰린 날', grid.busiest ? `${grid.busiest.date.getMonth() + 1}/${grid.busiest.date.getDate()} · ${grid.busiest.day!.count}개` : '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="eyebrow !text-[9px]">{k}</div>
                <div className="mt-0.5 text-[15px] font-semibold text-white">{v}</div>
              </div>
            ))}
          </div>
        </>
      }
      table={{
        columns: [{ label: '날짜' }, { label: '업적', align: 'right' }, { label: '게임' }],
        rows: grid.cells
          .filter((c) => c.inYear && c.day)
          .map((c) => [
            c.day!.key,
            `${c.day!.count}개`,
            [...c.day!.games.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([g, n]) => `${g} ${n}`)
              .join(', '),
          ]),
      }}
    >
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        {/* 연도 고르기: 해마다 깬 업적 수 막대 */}
        <div className="mb-5 flex items-end gap-1.5 overflow-x-auto pb-1">
          {d.years.map(([y, n]) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`flex w-12 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition ${y === year ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}
              title={`${y}년 · 업적 ${n}개`}
            >
              <span className="flex h-10 w-3 items-end">
                <span className="w-full rounded-t-[4px]" style={{ height: `${Math.max(6, (n / maxYear) * 100)}%`, background: CAT8[0], opacity: y === year ? 1 : 0.45 }} />
              </span>
              <span className={`num font-mono text-[10px] ${y === year ? 'text-white' : 'text-white/40'}`}>{y}</span>
            </button>
          ))}
        </div>

        <svg width={gridW * scale} height={(TOP + 7 * (CELL + GAP)) * scale} role="img" aria-label={`${year}년 업적 활동 캘린더`}>
          <g transform={`scale(${scale})`}>
            {/* 월 이름 */}
            {grid.cells
              .filter((c) => c.inYear && c.date.getDate() <= 7 && c.dow === 0)
              .map((c) => (
                <text key={c.week} x={LEFT + c.week * (CELL + GAP)} y={10} className="fill-white/40 text-[10px]">
                  {c.date.getMonth() + 1}월
                </text>
              ))}
            {[1, 3, 5].map((dw) => (
              <text key={dw} x={0} y={TOP + dw * (CELL + GAP) + CELL - 3} className="fill-white/30 text-[9.5px]">
                {DOW[dw]}
              </text>
            ))}
            {grid.cells.map((c) => {
              if (!c.inYear) return null;
              const lv = grid.level(c.day?.count ?? 0);
              const x = LEFT + c.week * (CELL + GAP);
              const y = TOP + c.dow * (CELL + GAP);
              const on = hover?.day && c.day === hover.day;
              return (
                <rect
                  key={dayKey(c.date)}
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={lv < 0 ? EMPTY : RAMP[lv]}
                  stroke={on ? '#fff' : 'none'}
                  strokeWidth={1.5}
                  onMouseEnter={() => c.day && setHover({ day: c.day, x: (x + CELL / 2) * scale, y: (y + 60) * scale })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>

        <div className="mt-3 flex items-center gap-1.5 text-[10.5px] text-white/40">
          적음
          <span className="size-[11px] rounded-[3px]" style={{ background: EMPTY }} />
          {RAMP.map((c) => (
            <span key={c} className="size-[11px] rounded-[3px]" style={{ background: c }} />
          ))}
          많음
        </div>

        {hover && (
          <Tooltip x={hover.x} y={hover.y} width={width}>
            <div className="mb-1.5 text-[12.5px] font-medium text-white">
              {hover.day.date.getFullYear()}년 {hover.day.date.getMonth() + 1}월 {hover.day.date.getDate()}일 ({DOW[hover.day.date.getDay()]})
            </div>
            <TipRow label="업적" value={`${hover.day.count}개`} />
            {[...hover.day.games.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([g, n]) => (
                <TipRow key={g} label={g.length > 20 ? `${g.slice(0, 19)}…` : g} value={`${n}`} />
              ))}
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
