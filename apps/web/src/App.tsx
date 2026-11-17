import { Suspense, lazy, useMemo, useState } from 'react';
import { buildOntologyGraph } from '@steamverse/shared';
import { useLibrary, type CatalogState } from './data/useLibrary';
import { ExplorerView } from './views/ExplorerView';
import { OntologyView } from './views/OntologyView';
import { formatNumber, percent } from './lib/format';

// three.js가 커서 3D 뷰는 탭을 열 때 불러온다
const UniverseView = lazy(() => import('./views/UniverseView').then((m) => ({ default: m.UniverseView })));
const ChartView = lazy(() => import('./views/ChartView').then((m) => ({ default: m.ChartView })));

type View = 'explorer' | 'universe' | 'charts' | 'ontology';

const TABS: { id: View; index: string; label: string }[] = [
  { id: 'explorer', index: '01', label: '그래프 탐색기' },
  { id: 'universe', index: '02', label: '우주 뷰' },
  { id: 'charts', index: '03', label: '차트' },
  { id: 'ontology', index: '04', label: '온톨로지' },
];

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <radialGradient id="logo-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#c7d6ff" />
          <stop offset="1" stopColor="#7aa2ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="logo-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#b69cff" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="9" fill="url(#logo-core)" />
      <ellipse cx="16" cy="16" rx="14.5" ry="5.2" fill="none" stroke="url(#logo-ring)" strokeWidth="1.1" transform="rotate(-24 16 16)" />
      <circle cx="28.3" cy="10.6" r="1.5" fill="#fff" />
    </svg>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="eyebrow !text-[9px]">{label}</span>
      <span className="num leading-none">
        <span className="text-[15px] font-semibold tracking-tight text-white">{value}</span>
        {unit && <span className="ml-0.5 text-[11px] text-white/45">{unit}</span>}
        {sub && <span className="ml-1.5 font-mono text-[10px] text-white/30">{sub}</span>}
      </span>
    </div>
  );
}

/** 데이터 출처 표시: 상점 정보가 실데이터인지, 받는 중인지, 서버가 꺼져 샘플인지 */
function DataPill({ catalog }: { catalog: CatalogState }) {
  const base = 'flex items-center gap-1.5 rounded-full border px-2 py-[3px] font-mono text-[9px] tracking-[0.14em]';
  if (catalog.phase === 'live') {
    return (
      <span className={`${base} border-emerald-300/20 text-emerald-200/75`} title="게임 정보(회사·장르·태그·가격)는 Steam 상점 실데이터, 플레이 기록은 샘플">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.8)]" />
        STORE LIVE · PLAYTIME SAMPLE
      </span>
    );
  }
  if (catalog.phase === 'syncing') {
    const { ready, total } = catalog.status;
    return (
      <span className={`${base} border-sky-300/20 text-sky-200/75`} title="Steam 상점 정보를 받는 중 (요청 간격 제한 때문에 처음 한 번은 몇 분 걸린다)">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
        STORE SYNC {ready}/{total}
      </span>
    );
  }
  return (
    <span className={`${base} border-amber-200/20 text-amber-200/70`} title={catalog.phase === 'offline' ? 'API 서버에 연결하지 못해 샘플 데이터를 보여 준다' : undefined}>
      SAMPLE DATA
    </span>
  );
}

export default function App() {
  const { library, catalog } = useLibrary();
  const graph = useMemo(() => buildOntologyGraph(library), [library]);
  const [view, setView] = useState<View>('explorer');
  const [rawSelectedId, setSelectedId] = useState<string | null>(null);
  // 데이터가 갱신되며 선택한 노드가 사라졌을 수 있다
  const selectedId = rawSelectedId && graph.nodeById.has(rawSelectedId) ? rawSelectedId : null;
  const { stats } = graph;

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-8 border-b border-white/[0.06] bg-[#05060c]/95 px-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-[13px] font-semibold tracking-[0.22em] text-white">STEAMVERSE</span>
          <DataPill catalog={catalog} />
        </div>

        <nav className="flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] p-1">
          {TABS.map((t) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`flex items-center gap-2 rounded-full px-4 py-[7px] text-[12.5px] transition ${
                  active
                    ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : 'text-white/45 hover:text-white/80'
                }`}
              >
                <span className={`font-mono text-[9.5px] ${active ? 'text-sky-200/80' : 'text-white/25'}`}>{t.index}</span>
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-7">
          <Kpi label="Library" value={formatNumber(stats.totalGames)} unit="개" />
          <Kpi label="Playtime" value={formatNumber(stats.totalHours)} unit="시간" />
          <Kpi label="Backlog" value={formatNumber(stats.byStatus.backlog)} unit="개" sub={percent(stats.byStatus.backlog, stats.totalGames)} />
          <Kpi label="Last 2 weeks" value={formatNumber(stats.recentHours)} unit="시간" />
          <Kpi label="Friends" value={formatNumber(stats.friends)} unit="명" />
          <div className="flex items-center gap-3 border-l border-white/[0.08] pl-6">
            <div className="rounded-full bg-gradient-to-br from-[#ff8fb1] via-[#b69cff] to-[#7aa2ff] p-[1.5px]">
              <div className="grid size-8 place-items-center rounded-full bg-[#0a0c16] text-[12px] font-semibold text-white">나</div>
            </div>
            <div className="leading-tight">
              <div className="text-[12.5px] font-medium text-white">{library.player.name}</div>
              <div className="font-mono text-[10px] tracking-wider text-white/40">LV {library.player.level}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {view === 'explorer' && <ExplorerView graph={graph} selectedId={selectedId} onSelect={setSelectedId} />}
        {view === 'universe' && (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center bg-[#020309]">
                <span className="eyebrow animate-pulse">Loading universe</span>
              </div>
            }
          >
            <UniverseView
              graph={graph}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onOpenInExplorer={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
        {view === 'charts' && (
          <Suspense fallback={<div className="h-full bg-[#04050a]" />}>
            <ChartView
              graph={graph}
              onOpenInExplorer={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
        {view === 'ontology' && <OntologyView graph={graph} />}
      </main>
    </div>
  );
}
