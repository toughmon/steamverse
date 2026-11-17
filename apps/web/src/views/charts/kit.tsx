import { useLayoutEffect, useRef, useState } from 'react';

/** 검증한 시리즈 색 (어두운 표면 #06070d 기준, dataviz validator 통과) */
export const SERIES = { me: '#4f86f0', friend: '#d9608f' } as const;
export const INK = {
  primary: 'rgba(255,255,255,0.92)',
  secondary: 'rgba(255,255,255,0.6)',
  muted: 'rgba(255,255,255,0.38)',
  grid: 'rgba(255,255,255,0.06)',
  surface: '#06070d',
} as const;

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function formatWon(v: number): string {
  if (v >= 10000) return `₩${(v / 10000).toFixed(v >= 100000 ? 0 : 1).replace(/\.0$/, '')}만`;
  return `₩${v.toLocaleString()}`;
}

/** 차트 위에 뜨는 툴팁. 오른쪽 끝에 닿으면 왼쪽으로 뒤집는다 */
export function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const flip = x > width - 240;
  return (
    <div
      className="pointer-events-none absolute z-20 w-max max-w-[240px] rounded-xl border border-white/10 bg-[#0b0d17]/95 px-3 py-2.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: y, transform: 'translateY(-50%)' }}
    >
      {children}
    </div>
  );
}

export function TipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-5 text-[11.5px]">
      <span className="text-white/45">{label}</span>
      <span className="num font-mono text-white/90">{value}</span>
    </div>
  );
}

export interface TableSpec {
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: (string | number)[][];
}

function DataTable({ columns, rows }: TableSpec) {
  return (
    <div className="sv-scroll max-h-[420px] overflow-auto rounded-xl border border-white/[0.07]">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-[#0a0c15]">
          <tr>
            {columns.map((c) => (
              <th key={c.label} className={`eyebrow !text-[9px] px-3.5 py-2.5 font-normal ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`px-3.5 py-2 ${columns[j]?.align === 'right' ? 'num text-right font-mono text-white/70 tabular-nums' : 'text-white/75'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CardProps {
  index: string;
  eyebrow: string;
  title: string;
  headline: React.ReactNode;
  aside?: React.ReactNode;
  badge?: string;
  table: TableSpec;
  children: React.ReactNode;
}

/** 리포트 한 장: 왼쪽 결론, 오른쪽 차트(또는 표) */
export function ChartCard({ index, eyebrow, title, headline, aside, badge, table, children }: CardProps) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="fade-up grid grid-cols-1 gap-8 rounded-3xl border border-white/[0.07] bg-[#06070d] p-7 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-white/30">{index}</span>
          <span className="eyebrow">{eyebrow}</span>
          {badge && (
            <span className="rounded-full border border-amber-200/20 px-1.5 py-px font-mono text-[8.5px] tracking-[0.12em] text-amber-200/70 uppercase">
              {badge}
            </span>
          )}
        </div>
        <h3 className="mt-2 text-[13px] text-white/50">{title}</h3>
        <div className="mt-3 text-[22px] leading-snug font-semibold tracking-tight text-white">{headline}</div>
        {aside && <div className="mt-6 flex flex-col gap-4">{aside}</div>}
        <button
          onClick={() => setShowTable((v) => !v)}
          className="mt-auto self-start pt-6 font-mono text-[10.5px] tracking-wider text-white/35 transition hover:text-white/80"
        >
          {showTable ? '← 차트로 보기' : '표로 보기 →'}
        </button>
      </div>
      <div className="relative min-w-0">{showTable ? <DataTable {...table} /> : children}</div>
    </section>
  );
}

export function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-white/60">
      {line ? (
        <span className="h-[2px] w-4 rounded-full" style={{ background: color }} />
      ) : (
        <span className="size-2 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
