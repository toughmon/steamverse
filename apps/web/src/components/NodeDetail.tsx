import { useMemo, useState } from 'react';
import {
  CLASSES,
  PLAY_STATUS,
  RELATIONS,
  RELATION_READING,
  nodeTurtle,
  otherEnd,
  steamImage,
  type OntNode,
  type OntologyGraph,
  type RelationId,
} from '@steamverse/shared';
import { formatDate, formatHours, formatNumber, percent } from '../lib/format';

interface Props {
  graph: OntologyGraph;
  nodeId: string;
  onSelect: (id: string) => void;
  /** 3D 뷰 오버레이처럼 좁은 곳에서 쓸 때 */
  compact?: boolean;
  actions?: React.ReactNode;
}

interface RelationGroup {
  key: string;
  rel: RelationId;
  title: string;
  items: { node: OntNode; weight?: number }[];
}

const DECK_LABEL = { verified: '확인됨', playable: '플레이 가능', unsupported: '지원 안 됨', unknown: '—' };
const GROUP_ORDER: RelationId[] = [
  'developedBy', 'publishedBy', 'partOfFranchise', 'similarTo', 'hasGenre', 'hasTag',
  'favoriteDeveloper', 'owns', 'friendOf',
];

export function ClassBadge({ cls }: { cls: OntNode['cls'] }) {
  const c = CLASSES[cls];
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.14em] uppercase" style={{ color: c.color }}>
      <span className="size-[6px] rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
      {c.label.en}
    </span>
  );
}

const won = (v: number) => `₩${formatNumber(Math.round(v))}`;

/** 상점 정가. 할인 중이면 할인가와 할인율을 아래에 */
function PriceFigure({ price, sale }: { price?: number; sale?: { priceKrw: number; discountPercent: number } }) {
  if (price === undefined) return <Figure label="Price" value="—" sub="상점 가격 없음" />;
  if (price === 0) return <Figure label="Price" value="무료" />;
  return (
    <div className="px-3.5 py-3">
      <div className="eyebrow !text-[9px]">Price</div>
      <div className="num mt-1.5 leading-none">
        <span className={`text-[19px] font-semibold tracking-tight ${sale ? 'text-white/40 line-through decoration-white/30' : 'text-white'}`}>{won(price)}</span>
      </div>
      {sale ? (
        <div className="num mt-1 flex items-center gap-1.5 text-[10.5px]">
          <span className="rounded bg-emerald-400/15 px-1 py-px font-mono text-[9.5px] text-emerald-200">-{sale.discountPercent}%</span>
          <span className="text-white/80">{won(sale.priceKrw)}</span>
        </div>
      ) : (
        <div className="mt-1 text-[10.5px] text-white/35">Steam 정가</div>
      )}
    </div>
  );
}

/** 정가를 플레이 시간으로 나눈 값: 이 게임이 얼마나 본전을 뽑았나 */
function CostPerHour({ price, hours }: { price?: number; hours: number }) {
  if (price === undefined) return <Figure label="Cost / hour" value="—" />;
  if (price === 0) return <Figure label="Cost / hour" value="₩0" sub="무료 게임" />;
  if (hours < 0.1) return <Figure label="Cost / hour" value="—" sub="아직 플레이 전" />;
  return <Figure label="Cost / hour" value={won(price / hours)} sub="플레이 1시간당" />;
}

/** 큰 숫자 + 작은 단위 + 모노 라벨 */
function Figure({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="px-3.5 py-3">
      <div className="eyebrow !text-[9px]">{label}</div>
      <div className="num mt-1.5 leading-none">
        <span className="text-[19px] font-semibold tracking-tight text-white">{value}</span>
        {unit && <span className="ml-1 text-[11px] text-white/45">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[10.5px] text-white/35">{sub}</div>}
    </div>
  );
}

function splitHours(h: number): { value: string; unit: string } {
  if (h <= 0) return { value: '0', unit: '시간' };
  if (h < 1) return { value: String(Math.round(h * 60)), unit: '분' };
  return { value: h < 10 ? h.toFixed(1).replace(/\.0$/, '') : formatNumber(h), unit: '시간' };
}

function NeighborGame({ node, weight, rel, onSelect }: { node: OntNode; weight?: number; rel: RelationId; onSelect: (id: string) => void }) {
  const status = PLAY_STATUS[node.game!.status];
  return (
    <button
      onClick={() => onSelect(node.id)}
      className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]"
    >
      <span className="relative shrink-0">
        <img
          src={steamImage(node.game!.appid, 'capsule')}
          alt=""
          loading="lazy"
          className="h-[30px] w-[80px] rounded-md object-cover opacity-85 ring-1 ring-white/10 transition group-hover:opacity-100"
        />
        <span className="absolute -top-0.5 -right-0.5 size-[7px] rounded-full ring-2 ring-[#0a0c16]" style={{ background: status.color }} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-white/75 group-hover:text-white">{node.label}</span>
      <span className="num shrink-0 font-mono text-[10.5px] text-white/35">
        {rel === 'similarTo' && weight !== undefined
          ? `${Math.round(weight * 100)}%`
          : formatHours(rel === 'owns' && weight !== undefined ? weight : node.hours)}
      </span>
    </button>
  );
}

function NeighborChip({ node, onSelect }: { node: OntNode; onSelect: (id: string) => void }) {
  const c = CLASSES[node.cls];
  return (
    <button
      onClick={() => onSelect(node.id)}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-[5px] text-[11.5px] text-white/70 transition hover:border-white/20 hover:text-white"
    >
      <span className="size-[6px] rounded-full" style={{ background: c.color }} />
      {node.label}
      {node.gameCount > 0 && <span className="num font-mono text-[10px] text-white/30">{node.gameCount}</span>}
    </button>
  );
}

export function NodeDetail({ graph, nodeId, onSelect, compact, actions }: Props) {
  const node = graph.nodeById.get(nodeId);
  const [showRdf, setShowRdf] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = useMemo<RelationGroup[]>(() => {
    if (!node) return [];
    const map = new Map<string, RelationGroup>();
    for (const e of graph.adjacency.get(node.id) ?? []) {
      // 내 보유 관계는 "모든 게임"이라 상세에서는 생략
      if (e.rel === 'owns' && e.source === graph.meId && node.cls === 'Game') continue;
      const def = RELATIONS[e.rel];
      const outgoing = e.source === node.id;
      const key = def.symmetric ? e.rel : `${e.rel}:${outgoing ? 'out' : 'in'}`;
      const title = outgoing ? RELATION_READING[e.rel].out : RELATION_READING[e.rel].in;
      const other = graph.nodeById.get(otherEnd(e, node.id))!;
      const g = map.get(key) ?? { key, rel: e.rel, title, items: [] };
      g.items.push({ node: other, weight: e.weight });
      map.set(key, g);
    }
    for (const g of map.values()) {
      g.items.sort((a, b) =>
        g.rel === 'similarTo' ? (b.weight ?? 0) - (a.weight ?? 0) : (b.weight ?? b.node.hours) - (a.weight ?? a.node.hours),
      );
    }
    return [...map.values()].sort((a, b) => GROUP_ORDER.indexOf(a.rel) - GROUP_ORDER.indexOf(b.rel));
  }, [graph, node]);

  if (!node) return null;
  const game = node.game;
  const status = game ? PLAY_STATUS[game.status] : null;
  const limit = compact ? 6 : 24;
  const hours = splitHours(node.hours);
  const ttl = showRdf ? nodeTurtle(graph, node.id) : '';

  return (
    <div className="fade-up flex flex-col gap-5" key={node.id}>
      {/* ── 머리 ── */}
      {game ? (
        <div className="relative -mx-4 -mt-4 overflow-hidden rounded-t-[inherit]">
          <img src={steamImage(game.appid, 'header')} alt="" className="aspect-[460/215] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0c16] via-[#0a0c16]/55 to-transparent" />
          <div className="absolute inset-x-4 bottom-3">
            <div className="flex items-center gap-3">
              <ClassBadge cls="Game" />
              {status && (
                <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase" style={{ color: status.color === '#3b4357' ? '#8b93a7' : status.color }}>
                  {status.label.en}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-[19px] leading-tight font-semibold tracking-tight text-white drop-shadow">{node.label}</h2>
          </div>
        </div>
      ) : (
        <div>
          <ClassBadge cls={node.cls} />
          <h2 className="mt-2 text-[21px] leading-tight font-semibold tracking-tight text-white">
            {node.label}
            {node.player?.isMe && <span className="ml-2 align-middle font-mono text-[10px] tracking-wider text-pink-300/80">ME</span>}
          </h2>
          {node.org && node.org.aliases.length > 1 && (
            <p className="mt-2 text-[11.5px] text-white/40">
              <span className="text-amber-200/70">병합된 표기</span> · {node.org.aliases.join(' / ')}
            </p>
          )}
        </div>
      )}

      {/* ── 지표 ── */}
      <div className="grid grid-cols-2 divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t [&>*]:border-white/[0.06]">
        {game ? (
          <>
            <Figure label="Playtime" value={hours.value} unit={hours.unit} sub={game.hours2w > 0 ? `최근 2주 ${formatHours(game.hours2w)}` : undefined} />
            <Figure label="Last played" value={formatDate(game.lastPlayed)} sub={`${game.releaseYear}년 출시`} />
            <Figure label="Steam Deck" value={DECK_LABEL[game.deck]} />
            <Figure label="Taste galaxy" value={graph.clusters[node.cluster ?? -1]?.name.split(' · ')[0] ?? '—'} sub={graph.clusters[node.cluster ?? -1]?.name.split(' · ')[1]} />
            <PriceFigure price={game.priceKrw} sale={game.sale} />
            <CostPerHour price={game.priceKrw} hours={node.hours} />
          </>
        ) : node.cls === 'Player' && !node.player?.isMe ? (
          <>
            <Figure label="Friends since" value={formatDate(node.player?.since)} />
            <Figure label="Shared games" value={String(node.player?.sharedGames ?? 0)} unit="개" sub={`친구 플레이 ${formatHours(node.hours)}`} />
          </>
        ) : node.cls === 'Player' ? (
          <>
            <Figure label="Library" value={String(graph.stats.totalGames)} unit="개" />
            <Figure label="Playtime" value={formatNumber(graph.stats.totalHours)} unit="시간" />
          </>
        ) : (
          <>
            <Figure label="My games" value={String(node.gameCount)} unit="개" />
            <Figure label="Playtime" value={hours.value} unit={hours.unit} />
            {node.org && (
              <>
                <Figure label="Developed" value={String(node.org.developed)} unit="개" />
                <Figure label="Published" value={String(node.org.published)} unit="개" />
              </>
            )}
          </>
        )}
      </div>

      {game?.achievements && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">Achievements</span>
            <span className="num font-mono text-[11px] text-white/50">
              {game.achievements.unlocked} / {game.achievements.total}
              <span className="ml-2 text-white">{percent(game.achievements.unlocked, game.achievements.total)}</span>
            </span>
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.07]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#7aa2ff] via-[#b69cff] to-[#ff8fb1]"
              style={{ width: percent(game.achievements.unlocked, game.achievements.total) }}
            />
          </div>
        </div>
      )}

      {actions}

      {/* ── 관계 ── */}
      {groups.map((g) => (
        <section key={g.key}>
          <h3 className="mb-2 flex items-center gap-2">
            <span className="eyebrow">{g.title}</span>
            <span className="num font-mono text-[10px] text-white/25">{g.items.length}</span>
            {RELATIONS[g.rel].inferred && (
              <span className="rounded-full border border-sky-300/20 px-1.5 py-px font-mono text-[8.5px] tracking-[0.12em] text-sky-200/70 uppercase">
                inferred
              </span>
            )}
          </h3>
          <div className={g.items[0]?.node.cls === 'Game' ? 'flex flex-col' : 'flex flex-wrap gap-1.5'}>
            {g.items.slice(0, limit).map(({ node: n, weight }) =>
              n.cls === 'Game' ? (
                <NeighborGame key={n.id} node={n} weight={weight} rel={g.rel} onSelect={onSelect} />
              ) : (
                <NeighborChip key={n.id} node={n} onSelect={onSelect} />
              ),
            )}
            {g.items.length > limit && <span className="px-1.5 py-1 font-mono text-[10.5px] text-white/30">+{g.items.length - limit}</span>}
          </div>
        </section>
      ))}

      {!compact && (
        <section className="overflow-hidden rounded-xl border border-white/[0.07]">
          <button
            onClick={() => setShowRdf((v) => !v)}
            className="flex w-full items-center justify-between bg-white/[0.02] px-3.5 py-2.5 text-left transition hover:bg-white/[0.04]"
          >
            <span className="flex items-center gap-2">
              <span className="eyebrow">RDF · Turtle</span>
            </span>
            <span className={`text-[11px] text-white/40 transition ${showRdf ? 'rotate-90' : ''}`}>›</span>
          </button>
          {showRdf && (
            <div className="relative border-t border-white/[0.06] bg-black/30">
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(ttl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1400);
                }}
                className="absolute top-2 right-2 rounded-md border border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/50 hover:text-white"
              >
                {copied ? 'copied' : 'copy'}
              </button>
              <pre className="sv-scroll max-h-80 overflow-auto p-3.5 font-mono text-[10.5px] leading-relaxed text-[#a8e6cf]/85">{ttl}</pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
