import { useMemo, useState } from 'react';
import {
  CLASSES,
  CLASS_ORDER,
  PLAY_STATUS,
  RELATIONS,
  RELATION_ORDER,
  vocabularyTurtle,
  type ClassId,
  type OntologyGraph,
  type RelationId,
} from '@steamverse/shared';
import { formatNumber } from '../lib/format';

interface Props {
  graph: OntologyGraph;
}

// 스키마 다이어그램 배치 (화면 표현용 좌표 — 의미는 ontology.ts에 있다)
const POS: Record<ClassId, { x: number; y: number }> = {
  Player: { x: 130, y: 250 },
  Game: { x: 440, y: 250 },
  Organization: { x: 760, y: 110 },
  Franchise: { x: 790, y: 260 },
  Genre: { x: 730, y: 420 },
  Tag: { x: 440, y: 450 },
};
const BOX = { w: 172, h: 58 };
/** 같은 두 클래스 사이 여러 관계를 겹치지 않게 휘는 정도 */
const CURVE: Partial<Record<RelationId, number>> = {
  developedBy: 0.18,
  publishedBy: -0.18,
  favoriteDeveloper: -0.42,
};

function boxEdgePoint(cx: number, cy: number, tx: number, ty: number) {
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(BOX.w / 2 / Math.abs(dx || 1e-6), BOX.h / 2 / Math.abs(dy || 1e-6));
  return { x: cx + dx * t, y: cy + dy * t };
}

function relationPath(rel: RelationId) {
  const def = RELATIONS[rel];
  const a = POS[def.domain];
  const b = POS[def.range];
  if (def.domain === def.range) {
    // 자기 자신으로 가는 관계는 상자 위쪽 고리
    const x = a.x;
    const y = a.y - BOX.h / 2;
    return { d: `M ${x - 26} ${y} C ${x - 70} ${y - 95}, ${x + 70} ${y - 95}, ${x + 26} ${y}`, lx: x, ly: y - 78 };
  }
  const k = CURVE[rel] ?? 0;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const cx = mx - (b.y - a.y) * k;
  const cy = my + (b.x - a.x) * k;
  const s = boxEdgePoint(a.x, a.y, cx, cy);
  const e = boxEdgePoint(b.x, b.y, cx, cy);
  // 2차 베지어의 중간점
  const lx = 0.25 * s.x + 0.5 * cx + 0.25 * e.x;
  const ly = 0.25 * s.y + 0.5 * cy + 0.25 * e.y;
  return { d: `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`, lx, ly };
}

function solid(color: string) {
  return color.replace(/rgba\(([^)]+),[\d.]+\)/, 'rgb($1)');
}

export function OntologyView({ graph }: Props) {
  const [hoverRel, setHoverRel] = useState<RelationId | null>(null);
  const [copied, setCopied] = useState(false);
  const ttl = useMemo(() => vocabularyTurtle(), []);

  const classCounts = useMemo(() => {
    const c = Object.fromEntries(CLASS_ORDER.map((k) => [k, 0])) as Record<ClassId, number>;
    for (const n of graph.nodes) c[n.cls] += 1;
    return c;
  }, [graph]);
  const relCounts = useMemo(() => {
    const c = Object.fromEntries(RELATION_ORDER.map((k) => [k, 0])) as Record<RelationId, number>;
    for (const e of graph.edges) c[e.rel] += 1;
    return c;
  }, [graph]);

  const copy = async () => {
    await navigator.clipboard.writeText(ttl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full min-h-0 bg-[#04050a]">
      <div className="sv-scroll min-w-0 flex-1 overflow-y-auto px-10 py-9">
        <div className="mx-auto max-w-[1000px]">
          <div className="eyebrow">Ontology · Schema</div>
          <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-white">온톨로지 스키마</h2>
          <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-white/45">
            <code className="rounded-md border border-white/[0.08] px-1.5 py-0.5 font-mono text-[11.5px] text-white/70">packages/shared/src/ontology.ts</code>{' '}
            한 파일에서 이 다이어그램, 그래프의 색과 범례, 오른쪽 Turtle 어휘가 모두 생성됩니다. 점선은 규칙으로 계산한 추론 관계입니다.
          </p>

          {/* 스키마 다이어그램 */}
          <div className="relative mt-7 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#06070d]">
            <div className="dot-grid pointer-events-none absolute inset-0 opacity-50" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(122,162,255,0.06),transparent_65%)]" />
            <div className="absolute top-4 left-5 eyebrow !text-[9px]">Class diagram</div>
            <div className="absolute top-4 right-5 flex items-center gap-4 font-mono text-[9.5px] tracking-wider text-white/35">
              <span className="flex items-center gap-1.5">
                <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="1.2" /></svg>ASSERTED
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 3" /></svg>INFERRED
              </span>
            </div>
            <svg viewBox="0 0 920 540" className="relative w-full">
              <defs>
                {RELATION_ORDER.map((r) => (
                  <marker key={r} id={`arrow-${r}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke={solid(RELATIONS[r].color)} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                ))}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="14" />
                </filter>
              </defs>

              {RELATION_ORDER.map((r) => {
                const def = RELATIONS[r];
                const { d, lx, ly } = relationPath(r);
                const dim = hoverRel && hoverRel !== r;
                const color = solid(def.color);
                return (
                  <g
                    key={r}
                    opacity={dim ? 0.12 : 1}
                    onMouseEnter={() => setHoverRel(r)}
                    onMouseLeave={() => setHoverRel(null)}
                    className="cursor-default transition-opacity"
                  >
                    <path d={d} fill="none" stroke="transparent" strokeWidth="14" />
                    <path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeOpacity={hoverRel === r ? 1 : 0.7}
                      strokeWidth={hoverRel === r ? 1.8 : 1.1}
                      strokeDasharray={def.inferred ? '4 4' : undefined}
                      markerEnd={`url(#arrow-${r})`}
                      markerStart={def.symmetric ? `url(#arrow-${r})` : undefined}
                    />
                    <g transform={`translate(${lx} ${ly})`}>
                      <rect
                        x={-def.id.length * 3.3 - 9}
                        y={-9.5}
                        width={def.id.length * 6.6 + 18}
                        height={19}
                        rx={9.5}
                        fill="#07080f"
                        stroke={color}
                        strokeOpacity={hoverRel === r ? 0.7 : 0.28}
                      />
                      <text textAnchor="middle" dy="3.6" fontSize="10" letterSpacing="0.2" fill={color} fontFamily='"JetBrains Mono", ui-monospace, monospace'>
                        {def.id}
                      </text>
                    </g>
                  </g>
                );
              })}

              {CLASS_ORDER.map((cls) => {
                const c = CLASSES[cls];
                const p = POS[cls];
                return (
                  <g key={cls} transform={`translate(${p.x - BOX.w / 2} ${p.y - BOX.h / 2})`}>
                    <rect width={BOX.w} height={BOX.h} rx={12} fill={c.color} opacity={0.1} filter="url(#glow)" />
                    <rect width={BOX.w} height={BOX.h} rx={12} fill="#0a0c15" stroke="rgba(255,255,255,0.1)" />
                    <rect x={0.5} y={0.5} width={BOX.w - 1} height={BOX.h - 1} rx={11.5} fill="none" stroke={c.color} strokeOpacity={0.35} />
                    <circle cx={19} cy={BOX.h / 2} r={4} fill={c.color} />
                    <circle cx={19} cy={BOX.h / 2} r={8} fill="none" stroke={c.color} strokeOpacity={0.3} />
                    <text x={36} y={25} fontSize="14" fontWeight="600" fill="#ffffff" letterSpacing="-0.2">
                      {c.label.ko}
                    </text>
                    <text x={36} y={42} fontSize="9.5" fill="rgba(255,255,255,0.4)" letterSpacing="0.3" fontFamily='"JetBrains Mono", ui-monospace, monospace'>
                      sv:{c.id} · {classCounts[cls]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* 클래스 */}
            <section>
              <SectionTitle title="Classes" sub="클래스" count={CLASS_ORDER.length} />
              <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
                {CLASS_ORDER.map((cls) => {
                  const c = CLASSES[cls];
                  return (
                    <div key={cls} className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="size-[7px] rounded-full" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
                        <span className="text-[13.5px] font-medium text-white">{c.label.ko}</span>
                        <span className="font-mono text-[10.5px] text-white/35">sv:{c.id}</span>
                        {c.schemaOrg && <span className="font-mono text-[10.5px] text-white/25">≡ {c.schemaOrg}</span>}
                        <span className="num ml-auto font-mono text-[11px] text-white/45">{formatNumber(classCounts[cls])}</span>
                      </div>
                      <p className="mt-1.5 pl-[17px] text-[12px] leading-relaxed text-white/45">{c.description}</p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 관계 */}
            <section>
              <SectionTitle title="Properties" sub="관계" count={RELATION_ORDER.length} />
              <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
                {RELATION_ORDER.map((r) => {
                  const def = RELATIONS[r];
                  return (
                    <div
                      key={r}
                      onMouseEnter={() => setHoverRel(r)}
                      onMouseLeave={() => setHoverRel(null)}
                      className={`px-4 py-3 transition ${hoverRel === r ? 'bg-white/[0.04]' : ''}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-[12px] font-medium" style={{ color: solid(def.color) }}>
                          {def.id}
                        </span>
                        <span className="text-[11.5px] text-white/40">
                          {CLASSES[def.domain].label.ko} {def.symmetric ? '↔' : '→'} {CLASSES[def.range].label.ko}
                        </span>
                        {def.inferred && (
                          <span className="rounded-full border border-sky-300/20 px-1.5 py-px font-mono text-[8.5px] tracking-[0.12em] text-sky-200/70 uppercase">
                            inferred
                          </span>
                        )}
                        <span className="num ml-auto font-mono text-[11px] text-white/45">{formatNumber(relCounts[r])}</span>
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed text-white/45">{def.description}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="mt-10">
            <SectionTitle title="Derived classification" sub="파생 분류 · 플레이 상태" />
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015] md:grid-cols-4 [&>*+*]:border-l [&>*]:border-white/[0.06]">
              {Object.values(PLAY_STATUS).map((s) => {
                const color = s.color === '#3b4357' ? '#8b93a7' : s.color;
                return (
                  <div key={s.id} className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="size-[10px] rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${color}` }} />
                      <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase" style={{ color }}>
                        {s.label.en}
                      </span>
                    </div>
                    <div className="mt-2.5 flex items-baseline gap-1.5">
                      <span className="num text-[24px] font-semibold tracking-tight text-white">{graph.stats.byStatus[s.id]}</span>
                      <span className="text-[12px] text-white/50">{s.label.ko}</span>
                    </div>
                    <p className="mt-1 text-[11.5px] text-white/35">{s.rule}</p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-10 mb-6">
            <SectionTitle title="Entity resolution" sub={`회사 표기 병합 · ${graph.stats.mergedOrganizations}건`} />
            <p className="mb-3 text-[12px] text-white/40">표기가 다른 회사 이름을 법인 접미사 제거 규칙으로 하나의 엔티티로 합쳤습니다.</p>
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.015]">
              {graph.nodes
                .filter((n) => n.org && n.org.aliases.length > 1)
                .map((n) => (
                  <li key={n.id} className="flex items-center gap-4 px-4 py-2.5 text-[12px]">
                    <span className="w-[160px] shrink-0 font-medium text-[#e6c07b]">{n.label}</span>
                    <span className="text-white/20">←</span>
                    <span className="flex flex-wrap gap-1.5">
                      {n.org!.aliases.map((a) => (
                        <span key={a} className="rounded-md border border-white/[0.07] px-1.5 py-px font-mono text-[10.5px] text-white/50">
                          {a}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      </div>

      {/* 오른쪽: Turtle */}
      <aside className="flex w-[440px] shrink-0 flex-col border-l border-white/[0.06] bg-[#06070d]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="eyebrow">RDF · Turtle</div>
            <p className="mt-1 text-[11.5px] text-white/40">ontology.ts에서 자동 생성 · Protégé에서 열 수 있음</p>
          </div>
          <button
            onClick={copy}
            className="rounded-lg border border-white/10 px-3 py-1.5 font-mono text-[10.5px] text-white/60 transition hover:bg-white/[0.05] hover:text-white"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
        <pre className="sv-scroll flex-1 overflow-auto px-5 py-4 font-mono text-[10.5px] leading-[1.7] text-[#a8e6cf]/80">{ttl}</pre>
      </aside>
    </div>
  );
}

function SectionTitle({ title, sub, count }: { title: string; sub: string; count?: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="eyebrow">{title}</span>
      {count !== undefined && <span className="num font-mono text-[10px] text-white/25">{count}</span>}
      <span className="ml-auto text-[11px] text-white/30">{sub}</span>
    </div>
  );
}
