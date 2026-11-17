import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { PLAY_STATUS, steamImage, type OntNode, type OntologyGraph } from '@steamverse/shared';
import { samplePrice } from '../../data/samplePrices';
import { formatHours } from '../../lib/format';
import { ChartCard, INK, SERIES, TipRow, Tooltip, formatWon, useSize } from './kit';

const H = 460;
const WATER = H * 0.5;
const SLEEP_COLOR = '#8b93a7';

interface Shard {
  node: OntNode;
  price: number;
  above: boolean;
  slot: number;
}

/** 큰 조각을 가운데에, 작은 조각을 바깥으로: 빙산 실루엣이 된다 */
function centerOut<T>(sorted: T[]): { item: T; slot: number }[] {
  return sorted.map((item, i) => ({ item, slot: i === 0 ? 0 : i % 2 ? Math.ceil(i / 2) : -i / 2 }));
}

function jitter(appid: number) {
  return ((appid * 9301 + 49297) % 233280) / 233280;
}

export function Iceberg({ graph, onOpen }: { graph: OntologyGraph; onOpen: (id: string) => void }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Shard | null>(null);

  const d = useMemo(() => {
    const games = graph.nodes.filter((n) => n.cls === 'Game');
    const sleeping = (n: OntNode) => n.game!.status === 'backlog' || n.game!.status === 'tried';
    // 상점 가격이 있으면 그것을, 없으면 샘플 가격을 쓴다
    const paid = games.map((n) => ({ node: n, price: n.game!.priceKrw ?? samplePrice(n.game!.appid) })).filter((x) => x.price > 0);
    // 상점 가격을 못 받은 유료 게임 수 (묶음 상품으로만 팔거나 지역 제한)
    const estimated = paid.filter((x) => x.node.game!.priceKrw === undefined).length;
    const anyReal = games.some((n) => n.game!.priceKrw !== undefined);
    const up = paid.filter((x) => !sleeping(x.node)).sort((a, b) => b.price - a.price);
    const down = paid.filter((x) => sleeping(x.node)).sort((a, b) => b.price - a.price);
    const shards: Shard[] = [
      ...centerOut(up).map(({ item, slot }) => ({ ...item, above: true, slot })),
      ...centerOut(down).map(({ item, slot }) => ({ ...item, above: false, slot })),
    ];
    const upSum = up.reduce((s, x) => s + x.price, 0);
    const downSum = down.reduce((s, x) => s + x.price, 0);
    const free = games.length - paid.length;

    // 잠든 게임 중, 내가 좋아한 게임과 가장 닮은 것
    let pick: { node: OntNode; like: OntNode; sim: number } | null = null;
    for (const { node } of down) {
      for (const e of graph.adjacency.get(node.id) ?? []) {
        if (e.rel !== 'similarTo') continue;
        const other = graph.nodeById.get(e.source === node.id ? e.target : e.source)!;
        const st = other.game?.status;
        if ((st === 'favorite' || st === 'played') && (!pick || (e.weight ?? 0) > pick.sim)) pick = { node, like: other, sim: e.weight ?? 0 };
      }
    }
    return { shards, up, down, upSum, downSum, free, pick, estimated, anyReal, max: Math.max(...paid.map((x) => x.price)) };
  }, [graph]);

  const band = width > 0 ? Math.min(20, (width - 40) / Math.max(d.up.length, 1)) : 0;
  const avail = Math.min(WATER - 40, H - WATER - 30);
  const h = scaleLinear().domain([0, d.max]).range([0, avail]);
  const cx = width / 2;
  const share = d.downSum / (d.upSum + d.downSum);

  const shardPath = (s: Shard) => {
    // 이웃 조각과 겹치게 넓혀서 하나의 얼음 덩어리처럼 보이게 한다
    const w = band * 1.9;
    const x0 = cx + s.slot * band - w / 2;
    const x1 = x0 + w;
    const len = Math.max(4, h(s.price));
    const dir = s.above ? -1 : 1;
    const j = jitter(s.node.game!.appid);
    const tip = WATER + dir * len;
    const shoulder = band * (0.5 + j * 0.8);
    return `M${x0},${WATER} L${x0},${tip - dir * shoulder * (0.4 + j)} L${(x0 + x1) / 2 + (j - 0.5) * band * 0.4},${tip} L${x1},${tip - dir * shoulder} L${x1},${WATER} Z`;
  };

  const wave = useMemo(() => {
    if (width <= 0) return '';
    const pts: string[] = [];
    for (let x = 0; x <= width; x += 6) pts.push(`${x},${WATER + Math.sin(x / 26) * 2.2}`);
    return `M${pts.join('L')}`;
  }, [width]);

  const hs = hover;

  return (
    <ChartCard
      index="04"
      eyebrow="Backlog iceberg"
      title="백로그 빙산"
      badge={!d.anyReal ? 'sample price' : d.estimated ? `store price · ${d.estimated} est.` : 'store price · KRW'}
      headline={
        <>
          <span className="text-white/90">{formatWon(d.downSum)}</span>어치가
          <br />
          수면 아래 잠들어 있어요
        </>
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            조각 하나가 게임 하나, 높이가 정가입니다. 수면 위는 2시간 이상 즐긴 게임, 아래는 아직 손대지 않았거나 잠깐 켜 본 게임이에요.
            유료 게임에 쓴 돈의 {Math.round(share * 100)}%가 잠들어 있습니다. (무료 게임 {d.free}개 제외)
          </p>
          {d.pick && (
            <button
              onClick={() => onOpen(d.pick!.node.id)}
              className="group overflow-hidden rounded-xl border border-white/[0.08] text-left transition hover:border-white/20"
            >
              <img src={steamImage(d.pick.node.game!.appid, 'header')} alt="" className="aspect-[460/215] w-full object-cover opacity-90 group-hover:opacity-100" />
              <div className="px-3.5 py-3">
                <div className="eyebrow !text-[9px]">이번 주에 꺼내 볼 게임</div>
                <div className="mt-1 text-[13.5px] font-medium text-white">{d.pick.node.label}</div>
                <div className="mt-0.5 text-[11.5px] text-white/45">
                  즐겨 한 {d.pick.like.label}와 {Math.round(d.pick.sim * 100)}% 닮았어요
                </div>
              </div>
            </button>
          )}
        </>
      }
      table={{
        columns: [{ label: '게임' }, { label: '상태' }, { label: '정가', align: 'right' }, { label: '시간', align: 'right' }],
        rows: [...d.down, ...d.up].map((x) => [
          x.node.label,
          PLAY_STATUS[x.node.game!.status].label.ko,
          formatWon(x.price),
          formatHours(x.node.hours),
        ]),
      }}
    >
      <div ref={ref} className="relative overflow-hidden rounded-2xl" style={{ height: H }}>
        {width > 0 && (
          <svg width={width} height={H}>
            <defs>
              <linearGradient id="ib-sea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1d3a7a" stopOpacity="0.35" />
                <stop offset="1" stopColor="#04050a" stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id="ib-ice" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor={SERIES.me} stopOpacity="0.55" />
                <stop offset="1" stopColor="#dbe7ff" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="ib-deep" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={SLEEP_COLOR} stopOpacity="0.75" />
                <stop offset="1" stopColor={SLEEP_COLOR} stopOpacity="0.25" />
              </linearGradient>
            </defs>

            <rect y={WATER} width={width} height={H - WATER} fill="url(#ib-sea)" />

            {/* 같은 축(원) 하나를 위아래로 */}
            {[20000, 40000, 60000, 80000].filter((v) => v <= d.max).map((v) => (
              <g key={v}>
                <line x1={0} x2={width} y1={WATER - h(v)} y2={WATER - h(v)} stroke={INK.grid} />
                <line x1={0} x2={width} y1={WATER + h(v)} y2={WATER + h(v)} stroke="rgba(255,255,255,0.04)" />
                <text x={4} y={WATER - h(v) - 4} fontSize="9.5" fill={INK.muted} fontFamily="var(--font-mono)">
                  {formatWon(v)}
                </text>
                <text x={4} y={WATER + h(v) - 4} fontSize="9.5" fill="rgba(255,255,255,0.25)" fontFamily="var(--font-mono)">
                  {formatWon(v)}
                </text>
              </g>
            ))}

            {[...d.shards].sort((a, b) => a.price - b.price).map((s) => (
              <path
                key={s.node.id}
                d={shardPath(s)}
                fill={s.above ? 'url(#ib-ice)' : 'url(#ib-deep)'}
                stroke={hs === s ? '#ffffff' : s.above ? 'rgba(220,232,255,0.35)' : 'rgba(160,170,190,0.3)'}
                strokeWidth={hs === s ? 1.5 : 0.75}
                strokeLinejoin="round"
                opacity={hs && hs !== s ? 0.5 : 1}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onOpen(s.node.id)}
              />
            ))}

            <path d={wave} fill="none" stroke="rgba(170,205,255,0.55)" strokeWidth={1.5} />

            <g fontSize="11">
              <text x={width - 8} y={18} textAnchor="end" fill={INK.secondary}>
                수면 위 · 즐긴 게임 {d.up.length}개 · <tspan fill={INK.primary}>{formatWon(d.upSum)}</tspan>
              </text>
              <text x={width - 8} y={H - 14} textAnchor="end" fill={INK.secondary}>
                수면 아래 · 잠든 게임 {d.down.length}개 · <tspan fill={INK.primary}>{formatWon(d.downSum)}</tspan>
              </text>
            </g>
          </svg>
        )}
        {hs && width > 0 && (
          <Tooltip
            x={cx + hs.slot * band}
            y={Math.max(60, Math.min(H - 60, WATER + (hs.above ? -1 : 1) * h(hs.price) * 0.7))}
            width={width}
          >
            <img src={steamImage(hs.node.game!.appid, 'capsule')} alt="" className="mb-2 h-[44px] w-[117px] rounded-md object-cover" />
            <div className="mb-1.5 text-[12.5px] font-medium text-white">{hs.node.label}</div>
            <TipRow
              label={d.anyReal && hs.node.game!.priceKrw === undefined ? '정가 (추정)' : '정가'}
              value={formatWon(hs.price)}
            />
            <TipRow label="플레이" value={formatHours(hs.node.hours)} />
            <TipRow label="상태" value={PLAY_STATUS[hs.node.game!.status].label.ko} />
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
