import { useMemo, useState } from 'react';
import { curveCatmullRomClosed, lineRadial } from 'd3-shape';
import type { OntologyGraph } from '@steamverse/shared';
import { ChartCard, INK, LegendItem, SERIES, TipRow, Tooltip, useSize } from './kit';

const AXES = 12;
const RINGS = 9;
const H = 470;

type Vec = Map<string, number>;

/** 사람별 태그 벡터: 게임마다 log(1+시간)만큼 그 게임의 태그에 더한다 (한 게임이 독식하지 않게) */
function tagVector(graph: OntologyGraph, games: { id: string; hours: number }[]): Vec {
  const v: Vec = new Map();
  for (const { id, hours } of games) {
    const g = graph.nodeById.get(id)?.game;
    if (!g) continue;
    const w = Math.log1p(hours);
    for (const t of g.tags) v.set(t, (v.get(t) ?? 0) + w);
  }
  return v;
}

function cosine(a: Vec, b: Vec): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    dot += x * (b.get(k) ?? 0);
  }
  for (const x of b.values()) nb += x * x;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function Fingerprint({ graph }: { graph: OntologyGraph }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hoverAxis, setHoverAxis] = useState<number | null>(null);

  const data = useMemo(() => {
    const myGames = graph.nodes.filter((n) => n.cls === 'Game').map((n) => ({ id: n.id, hours: n.hours }));
    const me = tagVector(graph, myGames);
    const axes = [...me.entries()].sort((a, b) => b[1] - a[1]).slice(0, AXES).map(([t]) => t);
    const friends = graph.nodes
      .filter((n) => n.cls === 'Player' && !n.player?.isMe)
      .map((f) => {
        const owned = (graph.adjacency.get(f.id) ?? [])
          .filter((e) => e.rel === 'owns' && e.source === f.id)
          .map((e) => ({ id: e.target, hours: e.weight ?? 0 }));
        const vec = tagVector(graph, owned);
        const own = [...vec.entries()]
          .filter(([t]) => !axes.includes(t))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t]) => t);
        return { id: f.id, name: f.label, vec, match: cosine(me, vec), own };
      })
      .sort((a, b) => b.match - a.match);
    return { me, axes, friends };
  }, [graph]);

  const [friendId, setFriendId] = useState<string | null>(null);
  const friend = data.friends.find((f) => f.id === friendId) ?? data.friends[0];

  const norm = (v: Vec) => {
    const vals = data.axes.map((t) => v.get(t) ?? 0);
    const max = Math.max(...vals, 1e-6);
    return vals.map((x) => x / max);
  };
  const meW = norm(data.me);
  const frW = friend ? norm(friend.vec) : [];

  const size = Math.min(width, H);
  const R1 = size / 2 - 62;
  const R0 = R1 * 0.16;
  const angle = (i: number) => (i / AXES) * Math.PI * 2;
  const ring = (w: number[], t: number) =>
    lineRadial<number>()
      .angle((_, i) => angle(i))
      .radius((x) => R0 + t * (R1 - R0) * (0.3 + 0.7 * x))
      .curve(curveCatmullRomClosed.alpha(0.5))(w) ?? '';

  const cx = width / 2;
  const cy = H / 2;
  const rings = Array.from({ length: RINGS }, (_, k) => (k + 1) / RINGS);
  const sector = (i: number) => {
    const a0 = angle(i) - Math.PI / AXES;
    const a1 = angle(i) + Math.PI / AXES;
    const r = R1 + 40;
    // 각도 0 = 위쪽(시계 방향), lineRadial과 같은 기준
    const p = (a: number, rr: number) => `${Math.sin(a) * rr} ${-Math.cos(a) * rr}`;
    return `M ${p(a0, R0)} L ${p(a0, r)} A ${r} ${r} 0 0 1 ${p(a1, r)} L ${p(a1, R0)} A ${R0} ${R0} 0 0 0 ${p(a0, R0)} Z`;
  };

  const ha = hoverAxis;

  return (
    <ChartCard
      index="02"
      eyebrow="Taste fingerprint"
      title="취향 지문"
      headline={
        friend ? (
          <>
            {friend.name}님과
            <br />
            취향이 <span style={{ color: SERIES.friend }}>{Math.round(friend.match * 100)}%</span> 겹쳐요
          </>
        ) : (
          '친구 데이터가 없어요'
        )
      }
      aside={
        <>
          <p className="text-[12.5px] leading-relaxed text-white/50">
            내가 가장 오래 머문 태그 {AXES}개로 지문을 그렸습니다. 바깥으로 튀어나온 곳이 내 취향의 중심입니다.
            {friend && friend.own.length > 0 && (
              <>
                {' '}
                {friend.name}님은 <span className="text-white/75">{friend.own.join(', ')}</span> 쪽으로 더 뻗어 있어요.
              </>
            )}
          </p>
          <div>
            <div className="eyebrow mb-2">Compare with</div>
            <div className="flex flex-col">
              {data.friends.map((f) => {
                const active = f.id === friend?.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFriendId(f.id)}
                    className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition ${active ? 'bg-white/[0.06] text-white' : 'text-white/55 hover:text-white'}`}
                  >
                    <span className="size-[7px] rounded-full" style={{ background: active ? SERIES.friend : 'rgba(255,255,255,0.2)' }} />
                    <span className="flex-1">{f.name}</span>
                    <span className="h-[3px] w-14 overflow-hidden rounded-full bg-white/[0.07]">
                      <span className="block h-full rounded-full" style={{ width: `${f.match * 100}%`, background: active ? SERIES.friend : 'rgba(255,255,255,0.3)' }} />
                    </span>
                    <span className="num w-8 text-right font-mono text-[10.5px] text-white/45">{Math.round(f.match * 100)}%</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      }
      table={{
        columns: [{ label: '태그' }, { label: '나', align: 'right' }, { label: friend?.name ?? '친구', align: 'right' }],
        rows: data.axes.map((t, i) => [t, Math.round(meW[i]! * 100), Math.round((frW[i] ?? 0) * 100)]),
      }}
    >
      <div ref={ref} className="relative" style={{ height: H }}>
        <div className="absolute top-0 right-0 flex gap-4">
          <LegendItem color={SERIES.me} label="나" line />
          {friend && <LegendItem color={SERIES.friend} label={friend.name} line />}
        </div>
        {width > 0 && (
          <svg width={width} height={H}>
            <g transform={`translate(${cx} ${cy})`}>
              {/* 바퀴살 */}
              {data.axes.map((t, i) => {
                const a = angle(i);
                const lx = Math.sin(a) * (R1 + 22);
                const ly = -Math.cos(a) * (R1 + 22);
                const anchor = Math.abs(lx) < 8 ? 'middle' : lx > 0 ? 'start' : 'end';
                return (
                  <g key={t}>
                    <line
                      x1={Math.sin(a) * R0}
                      y1={-Math.cos(a) * R0}
                      x2={Math.sin(a) * (R1 + 8)}
                      y2={-Math.cos(a) * (R1 + 8)}
                      stroke={ha === i ? 'rgba(255,255,255,0.3)' : INK.grid}
                    />
                    <text
                      x={lx}
                      y={ly}
                      dy="0.32em"
                      textAnchor={anchor}
                      fontSize="11"
                      fill={ha === i ? INK.primary : i < 3 ? INK.secondary : INK.muted}
                      fontWeight={i < 3 ? 600 : 400}
                    >
                      {t}
                    </text>
                  </g>
                );
              })}

              {/* 내 지문: 안쪽은 옅게, 바깥으로 갈수록 진하게 */}
              {rings.map((t, k) => (
                <path
                  key={`me${k}`}
                  d={ring(meW, t)}
                  fill="none"
                  stroke={SERIES.me}
                  strokeOpacity={0.18 + 0.6 * t}
                  strokeWidth={k === RINGS - 1 ? 2 : 1.1}
                />
              ))}
              {/* 친구 지문: 바깥 세 겹만 겹쳐서 비교 */}
              {friend &&
                rings.slice(-3).map((t, k) => (
                  <path
                    key={`fr${k}`}
                    d={ring(frW, t)}
                    fill={k === 2 ? SERIES.friend : 'none'}
                    fillOpacity={k === 2 ? 0.06 : 0}
                    stroke={SERIES.friend}
                    strokeOpacity={0.35 + 0.3 * k}
                    strokeWidth={k === 2 ? 2 : 1.1}
                  />
                ))}

              {/* 가운데 일치율 */}
              {friend && (
                <g>
                  <circle r={R0 - 4} fill={INK.surface} />
                  <text textAnchor="middle" dy="0.1em" fontSize="18" fontWeight={600} fill={INK.primary}>
                    {Math.round(friend.match * 100)}%
                  </text>
                  <text textAnchor="middle" dy="1.7em" fontSize="9" fill={INK.muted} letterSpacing="0.12em">
                    MATCH
                  </text>
                </g>
              )}

              {/* 호버 영역 */}
              {data.axes.map((t, i) => (
                <path key={`hit${t}`} d={sector(i)} fill="transparent" onMouseEnter={() => setHoverAxis(i)} onMouseLeave={() => setHoverAxis(null)} />
              ))}
            </g>
          </svg>
        )}
        {ha !== null && width > 0 && (
          <Tooltip x={cx + Math.sin(angle(ha)) * R1 * 0.75} y={cy - Math.cos(angle(ha)) * R1 * 0.75} width={width}>
            <div className="mb-1.5 text-[12.5px] font-medium text-white">{data.axes[ha]}</div>
            <TipRow label="나" value={`${Math.round(meW[ha]! * 100)}`} />
            {friend && <TipRow label={friend.name} value={`${Math.round((frW[ha] ?? 0) * 100)}`} />}
            <div className="mt-1.5 text-[10.5px] text-white/35">가장 강한 태그 = 100</div>
          </Tooltip>
        )}
      </div>
    </ChartCard>
  );
}
