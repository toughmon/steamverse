import { useEffect, useMemo, useRef, useState } from 'react';
import { PLAY_STATUS, steamStoreUrl, type OntNode, type OntologyGraph } from '@steamverse/shared';
import { GameImage } from './GameImage';

const ITEM_H = 76;
const REEL = 28;
const SPIN_MS = 2400;

interface Pick {
  node: OntNode;
  weight: number;
  reasons: string[];
  /** 닮은 게임들에 내가 쓴 평균 시간 (예상 플레이 시간 대용) */
  similarAvg?: number;
}

/**
 * 오늘 뭐 하지: 잠든 게임(백로그·찍먹) 중에서, 많이 한 게임과 닮았거나 친구가 가진 게임일수록 잘 뽑히게 돌린다.
 */
function candidates(graph: OntologyGraph, includeTried: boolean): Pick[] {
  const out: Pick[] = [];
  for (const n of graph.nodes) {
    const st = n.game?.status;
    if (st !== 'backlog' && !(includeTried && st === 'tried')) continue;
    const edges = graph.adjacency.get(n.id) ?? [];
    let anchor: { label: string; sim: number; score: number } | null = null;
    const similarHours: number[] = [];
    for (const e of edges) {
      if (e.rel !== 'similarTo') continue;
      const other = graph.nodeById.get(e.source === n.id ? e.target : e.source);
      if (!other?.game || other.hours < 2) continue;
      similarHours.push(other.hours);
      const score = (e.weight ?? 0) * Math.log10(1 + other.hours);
      if (other.hours >= 10 && (!anchor || score > anchor.score)) anchor = { label: other.label, sim: e.weight ?? 0, score };
    }
    const friends = edges.filter((e) => e.rel === 'owns' && e.source !== graph.meId && e.target === n.id).length;
    const reasons: string[] = [];
    if (anchor) reasons.push(`${anchor.label}와(과) ${Math.round(anchor.sim * 100)}% 닮았어요`);
    if (friends) reasons.push(`친구 ${friends}명이 가진 게임이에요`);
    if (st === 'tried') reasons.push(`${Math.round(n.hours * 10) / 10}시간 해 보고 멈췄어요`);
    if (!reasons.length) reasons.push('아직 한 번도 켜 보지 않았어요');
    out.push({
      node: n,
      weight: 0.4 + (anchor?.score ?? 0) * 2 + friends * 0.5,
      reasons,
      similarAvg: similarHours.length ? similarHours.reduce((a, b) => a + b, 0) / similarHours.length : undefined,
    });
  }
  return out;
}

function weightedPick(list: Pick[], rnd: () => number): Pick {
  const total = list.reduce((a, p) => a + p.weight, 0);
  let r = rnd() * total;
  for (const p of list) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return list[list.length - 1]!;
}

export function Roulette({ graph, onClose, onOpen }: { graph: OntologyGraph; onClose: () => void; onOpen: (id: string) => void }) {
  const [includeTried, setIncludeTried] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const pool = useMemo(() => candidates(graph, includeTried).filter((p) => !skipped.has(p.node.id)), [graph, includeTried, skipped]);
  const [reel, setReel] = useState<Pick[]>([]);
  const [result, setResult] = useState<Pick | null>(null);
  const [offset, setOffset] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const reduce = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer.current);
    };
  }, [onClose]);

  const spin = () => {
    if (!pool.length || spinning) return;
    const final = weightedPick(pool, Math.random);
    // 앞은 아무거나, 마지막 칸에 뽑힌 게임
    const items = Array.from({ length: REEL - 1 }, () => pool[Math.floor(Math.random() * pool.length)]!);
    items.push(final);
    setResult(null);
    setReel(items);
    if (reduce.current) {
      setOffset((REEL - 1) * ITEM_H);
      setResult(final);
      return;
    }
    setSpinning(true);
    setOffset(0);
    // 다음 프레임에 목표 위치로 → CSS 전환으로 감속하며 멈춘다
    requestAnimationFrame(() => requestAnimationFrame(() => setOffset((REEL - 1) * ITEM_H)));
    timer.current = window.setTimeout(() => {
      setSpinning(false);
      setResult(final);
    }, SPIN_MS + 80);
  };

  // 열자마자 한 번 돌린다
  useEffect(() => {
    spin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="오늘 뭐 하지"
        className="w-full max-w-[460px] rounded-2xl border border-white/[0.08] bg-[#0a0c16] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="eyebrow">Backlog roulette</div>
            <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight text-white">오늘 뭐 하지?</h2>
            <p className="mt-1 text-[12px] text-white/45">잠든 게임 {pool.length}개 중에서, 내가 좋아한 게임과 닮은 것일수록 잘 나와요</p>
          </div>
          <button onClick={onClose} className="rounded-full px-2.5 py-1 text-[13px] text-white/45 hover:bg-white/[0.06] hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 슬롯 */}
        <div className="relative mt-5 overflow-hidden rounded-xl border border-white/[0.08] bg-black/40" style={{ height: ITEM_H }}>
          {pool.length === 0 ? (
            <div className="grid h-full place-items-center text-[13px] text-white/45">잠든 게임이 없어요. 대단해요!</div>
          ) : (
            <div
              style={{
                transform: `translateY(-${offset}px)`,
                transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : 'none',
              }}
            >
              {reel.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-3" style={{ height: ITEM_H }}>
                  <GameImage appid={p.node.game!.appid} kind="capsule" label={p.node.label} className="h-[52px] w-[138px] shrink-0 rounded-md object-cover" />
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-white">{p.node.label}</div>
                    <div className="text-[11px] text-white/45">{PLAY_STATUS[p.node.game!.status].label.ko}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 위아래 흐림 */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40" />
        </div>

        {/* 결과 */}
        <div className="mt-4 min-h-[118px]">
          {result && (
            <div className="fade-up">
              <ul className="flex flex-col gap-1 text-[12.5px] text-white/70">
                {result.reasons.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
                {result.similarAvg !== undefined && <li className="text-white/45">· 닮은 게임들은 평균 {Math.round(result.similarAvg)}시간 했어요</li>}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => onOpen(result.node.id)}
                  className="rounded-full bg-white/[0.1] px-3.5 py-1.5 text-[12px] text-white transition hover:bg-white/[0.16]"
                >
                  탐색기에서 보기
                </button>
                <a
                  href={steamStoreUrl(result.node.game!.appid)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-white/15 px-3.5 py-1.5 text-[12px] text-white/75 transition hover:border-white/35 hover:text-white"
                >
                  Steam 상점 ↗
                </a>
                <button
                  onClick={() => {
                    setSkipped((s) => new Set(s).add(result.node.id));
                    setResult(null);
                  }}
                  className="rounded-full border border-white/10 px-3.5 py-1.5 text-[12px] text-white/50 transition hover:text-white"
                  title="이번에는 후보에서 뺍니다"
                >
                  이건 패스
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <label className="flex items-center gap-2 text-[12px] text-white/55">
            <input type="checkbox" checked={includeTried} onChange={(e) => setIncludeTried(e.target.checked)} className="accent-sky-400" />
            찍먹한 게임도 포함
          </label>
          <button
            onClick={spin}
            disabled={spinning || !pool.length}
            className="rounded-full bg-gradient-to-r from-[#3987e5] to-[#9085e9] px-5 py-2 text-[13px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {spinning ? '돌리는 중…' : result ? '다시 돌리기' : '돌리기'}
          </button>
        </div>
      </div>
    </div>
  );
}
