import { useMemo, useState } from 'react';
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { PLAY_STATUS, type OntologyGraph, type PlayStatus } from '@steamverse/shared';
import { ChartCard, TipRow, Tooltip, useSize } from '../charts/kit';
import { CAT8, STATUS_ORDER, STATUS_RAMP, gamesOf, orgOf, topNames } from './data';

const H = 440;
const PUBS = 6;
const GENRES = 6;
const NEUTRAL = 'rgba(255,255,255,0.5)';
const LINK = 'rgba(255,255,255,0.1)';
const HIGHLIGHT = CAT8[0];

interface NodeExtra {
  id: string;
  name: string;
  stage: 0 | 1 | 2;
  status?: PlayStatus;
}
interface LinkExtra {
  value: number;
}
type N = SankeyNode<NodeExtra, LinkExtra>;
type L = SankeyLink<NodeExtra, LinkExtra>;

/**
 * 잠든 게임의 흐름: 유통사 → 장르 → 플레이 상태. 띠 두께 = 게임 수.
 * 회사·장르는 중립색, 플레이 상태만 순서형 램프(덜 할수록 어둡게)로 칠한다.
 */
export function SleepFlow({ graph }: { graph: OntologyGraph }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [tip, setTip] = useState<{ l: L; x: number; y: number } | null>(null);

  const d = useMemo(() => {
    const games = gamesOf(graph);
    const pubOf = (id: string) => orgOf(graph, id, 'publishedBy') ?? orgOf(graph, id, 'developedBy') ?? '알 수 없음';
    const genreOf = (g: (typeof games)[number]) => g.game!.genres[0] ?? '장르 없음';
    const pubCount = new Map<string, number>();
    const genreCount = new Map<string, number>();
    for (const g of games) {
      pubCount.set(pubOf(g.id), (pubCount.get(pubOf(g.id)) ?? 0) + 1);
      genreCount.set(genreOf(g), (genreCount.get(genreOf(g)) ?? 0) + 1);
    }
    const keepPub = topNames(pubCount, PUBS);
    const keepGenre = topNames(genreCount, GENRES);

    const flows = new Map<string, number>();
    const add = (a: string, b: string) => flows.set(`${a}\u0000${b}`, (flows.get(`${a}\u0000${b}`) ?? 0) + 1);
    const nodes = new Map<string, NodeExtra>();
    const rows: { pub: string; genre: string; status: PlayStatus }[] = [];
    for (const g of games) {
      const pub = keepPub.has(pubOf(g.id)) ? pubOf(g.id) : '그 밖의 회사';
      const genre = keepGenre.has(genreOf(g)) ? genreOf(g) : '그 밖의 장르';
      const status = g.game!.status;
      nodes.set(`p:${pub}`, { id: `p:${pub}`, name: pub, stage: 0 });
      nodes.set(`g:${genre}`, { id: `g:${genre}`, name: genre, stage: 1 });
      nodes.set(`s:${status}`, { id: `s:${status}`, name: PLAY_STATUS[status].label.ko, stage: 2, status });
      add(`p:${pub}`, `g:${genre}`);
      add(`g:${genre}`, `s:${status}`);
      rows.push({ pub, genre, status });
    }
    const links = [...flows.entries()].map(([k, value]) => {
      const [source, target] = k.split('\u0000');
      return { source: source!, target: target!, value };
    });

    // 잠든 비율이 가장 높은 회사 (게임 3개 이상)
    const sleepyPub = [...keepPub]
      .map((p) => {
        const own = rows.filter((r) => r.pub === p);
        return { p, n: own.length, sleep: own.filter((r) => r.status === 'backlog' || r.status === 'tried').length };
      })
      .filter((x) => x.n >= 3)
      .sort((a, b) => b.sleep / b.n - a.sleep / a.n)[0];

    return { nodes: [...nodes.values()], links, rows, sleepyPub, total: games.length };
  }, [graph]);

  const layout = useMemo(() => {
    if (!width || d.links.length === 0) return null;
    const statusRank = (n: NodeExtra) => (n.status ? STATUS_ORDER.indexOf(n.status) : 0);
    // '그 밖의 …'는 항상 맨 아래
    const isOther = (n: NodeExtra) => n.name.startsWith('그 밖의');
    return sankey<NodeExtra, LinkExtra>()
      .nodeId((n) => n.id)
      .nodeWidth(10)
      .nodePadding(12)
      .nodeSort((a, b) =>
        a.stage === 2 && b.stage === 2
          ? statusRank(b) - statusRank(a)
          : Number(isOther(a)) - Number(isOther(b)) || (b.value ?? 0) - (a.value ?? 0),
      )
      .extent([
        [130, 8],
        [width - 96, H - 8],
      ])({ nodes: d.nodes.map((n) => ({ ...n })), links: d.links.map((l) => ({ ...l })) });
  }, [d, width]);

  const touches = (l: L) => {
    if (!hoverNode) return false;
    const s = (l.source as N).id;
    const t = (l.target as N).id;
    return s === hoverNode || t === hoverNode;
  };
  const linkPath = sankeyLinkHorizontal<NodeExtra, LinkExtra>();
  const nodeColor = (n: N) => (n.status ? STATUS_RAMP[n.status] : NEUTRAL);

  return (
    <ChartCard
      index="04"
      eyebrow="Sleep flow"
      title="잠든 게임의 흐름"
      headline={
        d.sleepyPub && d.sleepyPub.sleep > 0 ? (
          <>
            <span className="text-white/90">{d.sleepyPub.p}</span> 게임은
            <br />
            {d.sleepyPub.n}개 중 {d.sleepyPub.sleep}개가 잠들어 있어요
          </>
        ) : (
          '사 놓고 안 한 게임이 거의 없어요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            왼쪽 유통사에서 가운데 장르를 거쳐 오른쪽 플레이 상태로 흐릅니다. 띠 두께는 게임 수예요. 회사나 장르에 마우스를 올리면 그 흐름만 밝아집니다.
          </p>
          <div className="flex flex-col gap-1.5">
            {[...STATUS_ORDER].reverse().map((s) => (
              <span key={s} className="flex items-center gap-2 text-[11.5px] text-white/60">
                <span className="h-2.5 w-1.5 rounded-sm" style={{ background: STATUS_RAMP[s] }} />
                {PLAY_STATUS[s].label.ko} · {PLAY_STATUS[s].rule}
              </span>
            ))}
          </div>
        </>
      }
      table={{
        columns: [{ label: '유통사' }, { label: '장르' }, { label: '상태' }, { label: '게임 수', align: 'right' }],
        rows: (() => {
          const m = new Map<string, number>();
          for (const r of d.rows) {
            const k = `${r.pub}\u0000${r.genre}\u0000${PLAY_STATUS[r.status].label.ko}`;
            m.set(k, (m.get(k) ?? 0) + 1);
          }
          return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [...k.split('\u0000'), `${n}개`]);
        })(),
      }}
    >
      <div ref={ref} className="relative" style={{ height: H }} onMouseLeave={() => (setHoverNode(null), setTip(null))}>
        {layout && (
          <svg width={width} height={H} role="img" aria-label="유통사·장르·플레이 상태 생키 다이어그램">
            <g fill="none">
              {layout.links.map((l, i) => {
                const on = touches(l);
                const target = l.target as N;
                const fromOther = (l.source as N).name.startsWith('그 밖의');
                return (
                  <path
                    key={i}
                    d={linkPath(l) ?? undefined}
                    stroke={on ? HIGHLIGHT : target.status ? STATUS_RAMP[target.status] : LINK}
                    strokeOpacity={on ? 0.75 : hoverNode ? 0.04 : target.status ? 0.28 : fromOther ? 0.45 : 1}
                    strokeWidth={Math.max(1, l.width ?? 1)}
                    className="transition-[stroke-opacity] duration-200"
                    onMouseMove={(e) => {
                      const r = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                      setTip({ l, x: e.clientX - r.left, y: e.clientY - r.top });
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
            </g>
            {layout.nodes.map((n) => {
              const left = n.stage === 0;
              const right = n.stage === 2;
              const y = ((n.y0 ?? 0) + (n.y1 ?? 0)) / 2;
              return (
                <g key={n.id} onMouseEnter={() => setHoverNode(n.id)} className="cursor-pointer">
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))} rx={2} fill={nodeColor(n)} />
                  <text
                    x={left ? (n.x0 ?? 0) - 8 : (n.x1 ?? 0) + 8}
                    y={y}
                    dy="0.35em"
                    textAnchor={left ? 'end' : 'start'}
                    className={`text-[11px] ${hoverNode === n.id ? 'fill-white' : 'fill-white/65'}`}
                    // 띠 위에 놓인 가운데 이름표도 읽히게 어두운 테두리
                    stroke="#06070d"
                    strokeWidth={3}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {n.name.length > 16 ? `${n.name.slice(0, 15)}…` : n.name}
                    {(left || right) && <tspan className="fill-white/35 font-mono text-[10px]"> {n.value}</tspan>}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {tip && (
          <Tooltip x={tip.x} y={tip.y} width={width}>
            <div className="mb-1.5 text-[12.5px] font-medium text-white">
              {(tip.l.source as N).name} → {(tip.l.target as N).name}
            </div>
            <TipRow label="게임 수" value={`${tip.l.value}개`} />
            <TipRow label="비율" value={`${Math.round((tip.l.value / Math.max(1, (tip.l.source as N).value ?? 1)) * 100)}%`} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
