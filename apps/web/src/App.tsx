import { Suspense, lazy, useMemo, useState } from 'react';
import { buildOntologyGraph } from '@steamverse/shared';
import { readSavedSource, saveSource, useLibrary, type AccountState, type AccountWarning, type CatalogState, type Source } from './data/useLibrary';
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

const WARNING_TEXT: Record<AccountWarning, string> = {
  'games-private': '게임 세부 정보가 비공개라 보유 게임을 받지 못했습니다',
  'friends-private': '친구 목록이 비공개라 친구를 받지 못했습니다',
  'achievements-private': '게임 세부 정보가 비공개라 업적을 받지 못했습니다',
};
const UNAVAILABLE_TEXT: Record<Extract<AccountState, { phase: 'unavailable' }>['reason'], string> = {
  'no-key': '.env에 STEAM_API_KEY가 없습니다',
  'no-user': '.env에 STEAM_TEST_USER가 없습니다',
  'not-found': 'Steam 계정을 찾지 못했습니다',
  offline: 'API 서버에 연결하지 못했습니다',
  'steam-failed': 'Steam에서 정보를 받지 못했습니다',
};

/** 데이터 출처 전환 + 상태: 내 계정인지 샘플인지, 상점 정보를 받는 중인지, 비공개 설정 때문에 빠진 게 있는지 */
function SourceSwitch({
  source,
  onChange,
  catalog,
  account,
}: {
  source: Source;
  onChange: (s: Source) => void;
  catalog: CatalogState;
  account: AccountState;
}) {
  const seg = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[10.5px] transition ${active ? 'bg-white/[0.09] text-white' : 'text-white/40 hover:text-white/70'}`;

  let dot = 'bg-white/30';
  let status = '';
  let title = '';
  if (account.phase === 'unavailable') {
    dot = 'bg-amber-300';
    status = 'SAMPLE · 계정 연결 안 됨';
    title = UNAVAILABLE_TEXT[account.reason];
  } else if (account.phase === 'loading' || catalog.phase === 'connecting') {
    dot = 'bg-sky-300 animate-pulse';
    status = 'LOADING';
  } else if (catalog.phase === 'syncing') {
    dot = 'bg-sky-300 animate-pulse';
    status = `STORE SYNC ${catalog.status.ready}/${catalog.status.total}`;
    title = 'Steam 상점 정보를 받는 중 (처음 한 번은 게임 수에 따라 몇 분 걸립니다)';
  } else if (catalog.phase === 'offline') {
    dot = 'bg-amber-300';
    status = 'OFFLINE';
    title = UNAVAILABLE_TEXT.offline;
  } else {
    dot = 'bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.8)]';
    status = account.phase === 'ok' ? 'STEAM LIVE' : 'STORE LIVE · PLAYTIME SAMPLE';
  }
  const warnings = account.phase === 'ok' ? account.warnings : [];

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center rounded-full border border-white/[0.08] bg-white/[0.02] p-[2px]" role="radiogroup" aria-label="데이터 출처">
        <button type="button" role="radio" aria-checked={source === 'steam'} className={seg(source === 'steam')} onClick={() => onChange('steam')}>
          {source === 'steam' && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}내 계정
        </button>
        <button type="button" role="radio" aria-checked={source === 'sample'} className={seg(source === 'sample')} onClick={() => onChange('sample')}>
          {source === 'sample' && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}샘플
        </button>
      </div>
      <span className="font-mono text-[9px] tracking-[0.14em] text-white/40" title={title || undefined}>
        {status}
      </span>
      {warnings.length > 0 && (
        <span
          className="cursor-help rounded-full border border-amber-200/25 px-1.5 py-[2px] font-mono text-[9px] tracking-[0.1em] text-amber-200/80"
          title={[...warnings.map((w) => WARNING_TEXT[w]), 'Steam → 프로필 편집 → 개인정보 설정에서 공개로 바꾸면 다음 동기화 때 채워집니다'].join('\n')}
        >
          ! 비공개 {warnings.length}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [source, setSourceState] = useState<Source>(readSavedSource);
  const setSource = (s: Source) => {
    setSourceState(s);
    saveSource(s);
  };
  const { library, catalog, account } = useLibrary(source);
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
          <SourceSwitch source={source} onChange={setSource} catalog={catalog} account={account} />
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
