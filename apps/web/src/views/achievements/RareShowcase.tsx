import { useEffect, useMemo, useState } from 'react';
import type { OntNode, OntologyGraph } from '@steamverse/shared';
import { GameImage } from '../../components/GameImage';
import { ChartCard } from '../charts/kit';

const POLL_MS = 3000;
const SHOW = 12;

/** 등급은 색이 아니라 글자로 구분한다 (상태색은 의미가 따로 있다) */
const TIERS = [
  { max: 1, label: '전설', hint: '1% 이하' },
  { max: 5, label: '희귀', hint: '5% 이하' },
  { max: 15, label: '드묾', hint: '15% 이하' },
  { max: 101, label: '보통', hint: '15% 초과' },
];
const tierOf = (pct: number) => TIERS.find((t) => pct <= t.max)!;

interface Rare {
  game: OntNode;
  name: string;
  pct: number;
  t: number;
}

type Status = { phase: 'idle' | 'loading' | 'done' | 'offline'; ready: number; total: number };

/** 업적의 전 세계 달성률을 서버에서 받는다. 샘플·시연 데이터는 지어낸 달성률을 갖고 있어 서버에 묻지 않는다 */
function useGlobalPercentages(appids: number[], needed: boolean) {
  const [map, setMap] = useState<Record<number, Record<string, number>>>({});
  const [status, setStatus] = useState<Status>({ phase: 'idle', ready: 0, total: 0 });
  const key = appids.join(',');
  useEffect(() => {
    if (!needed || !appids.length) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/achievements/global?appids=${key}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { apps: Record<number, Record<string, number>>; status: { ready: number; total: number; pending: number } };
        if (cancelled) return;
        setMap(body.apps);
        const done = body.status.pending === 0;
        setStatus({ phase: done ? 'done' : 'loading', ready: body.status.ready, total: body.status.total });
        if (!done) timer = window.setTimeout(poll, POLL_MS);
      } catch {
        if (!cancelled) setStatus((s) => ({ ...s, phase: 'offline' }));
      }
    };
    setStatus({ phase: 'loading', ready: 0, total: appids.length });
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needed]);
  return { map, status };
}

/** 희귀 업적 쇼케이스: 전 세계 달성률이 낮은 순서로 내가 깬 업적 */
export function RareShowcase({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const games = useMemo(() => graph.nodes.filter((n) => n.game?.achievementLog?.length), [graph]);
  const needed = games.some((g) => g.game!.achievementLog!.some((u) => u.samplePct === undefined));
  const appids = useMemo(() => games.map((g) => g.game!.appid).sort((a, b) => a - b), [games]);
  const { map, status } = useGlobalPercentages(appids, needed);

  const all = useMemo(() => {
    const out: Rare[] = [];
    for (const g of games) {
      const pcts = map[g.game!.appid];
      for (const u of g.game!.achievementLog!) {
        const pct = u.samplePct ?? pcts?.[u.api];
        if (pct === undefined) continue;
        out.push({ game: g, name: u.name ?? u.api, pct, t: u.t });
      }
    }
    return out.sort((a, b) => a.pct - b.pct || b.t - a.t);
  }, [games, map]);

  const counts = TIERS.map((t) => ({ ...t, n: all.filter((r) => tierOf(r.pct) === t).length }));
  const rarest = all[0];
  const fmtDate = (t: number) => {
    const d = new Date(t * 1000);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <ChartCard
      index="02"
      eyebrow="Rare achievements"
      title="희귀 업적 쇼케이스"
      badge={status.phase === 'loading' ? `global ${status.ready}/${status.total}` : status.phase === 'offline' ? 'offline' : undefined}
      headline={
        rarest ? (
          <>
            전 세계 <span className="text-white/90">{rarest.pct}%</span>만 가진
            <br />
            「{rarest.name}」
          </>
        ) : status.phase === 'loading' ? (
          '전 세계 달성률을 받는 중이에요'
        ) : (
          '아직 보여 줄 업적이 없어요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            내가 깬 업적을, 그 업적을 가진 전 세계 플레이어 비율이 낮은 순서로 늘어놓았습니다. 달성률은 Steam이 공개하는 게임별 통계입니다.
          </p>
          <div className="flex flex-col gap-1.5">
            {counts.map((t) => (
              <div key={t.label} className="flex items-baseline justify-between text-[12px]">
                <span className="text-white/70">
                  {t.label} <span className="text-white/35">· {t.hint}</span>
                </span>
                <span className="num font-mono text-white/60">{t.n}개</span>
              </div>
            ))}
          </div>
        </>
      }
      table={{
        columns: [{ label: '업적' }, { label: '게임' }, { label: '전 세계 달성률', align: 'right' }, { label: '등급' }, { label: '해금', align: 'right' }],
        rows: all.map((r) => [r.name, r.game.label, `${r.pct}%`, tierOf(r.pct).label, fmtDate(r.t)]),
      }}
    >
      {all.length ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {all.slice(0, SHOW).map((r, i) => {
            const tier = tierOf(r.pct);
            return (
              <button
                key={`${r.game.id}-${r.name}-${i}`}
                onClick={() => onOpen(r.game.id)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] text-left transition hover:border-white/20"
              >
                <div className="relative">
                  <GameImage appid={r.game.game!.appid} kind="header" label={r.game.label} className="aspect-[460/150] w-full object-cover opacity-60 transition group-hover:opacity-80" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#06070d] via-[#06070d]/60 to-transparent" />
                  <span className="absolute top-2 left-2 rounded-full border border-white/25 bg-black/50 px-2 py-0.5 text-[10px] tracking-wider text-white/85 backdrop-blur">{tier.label}</span>
                  <span className="absolute right-3 bottom-1 text-[26px] leading-none font-semibold tracking-tight text-white">
                    {r.pct}
                    <span className="ml-0.5 text-[13px] text-white/60">%</span>
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1 px-3.5 pt-2 pb-3">
                  <div className="line-clamp-2 text-[13px] leading-snug font-medium text-white">{r.name}</div>
                  <div className="mt-auto flex items-baseline justify-between gap-2 text-[11px] text-white/45">
                    <span className="truncate">{r.game.label}</span>
                    <span className="num shrink-0 font-mono">{fmtDate(r.t)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid h-[220px] place-items-center text-[13px] text-white/40">
          {status.phase === 'loading' ? `전 세계 달성률을 받는 중… ${status.ready}/${status.total}` : status.phase === 'offline' ? '서버에 연결하지 못했습니다' : '업적을 깬 게임이 없어요'}
        </div>
      )}
    </ChartCard>
  );
}
