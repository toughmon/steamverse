import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { buildOntologyGraph, setImagePolicy } from '@steamverse/shared';
import { About } from './components/About';
import { SignInThroughSteam, useSession } from './components/Session';
import { useSettings } from './lib/settings';
import { readSavedSource, saveSource, useLibrary, type AccountState, type AccountWarning, type CatalogState, type Source } from './data/useLibrary';
import { ExplorerView } from './views/ExplorerView';
import { readStressCount } from './data/stressLibrary';
import { useGraphEngine, type EngineState } from './engine/client';
import { ENGINE_LIBRARY, type EngineSource } from './engine/protocol';
import { formatNumber, percent } from './lib/format';

// 탐사·차트 뷰는 탭을 열 때 불러온다
const VoyageView = lazy(() => import('./views/VoyageView').then((m) => ({ default: m.VoyageView })));
const ChartView = lazy(() => import('./views/ChartView').then((m) => ({ default: m.ChartView })));
const SignalView = lazy(() => import('./views/SignalView').then((m) => ({ default: m.SignalView })));
const AchievementsView = lazy(() => import('./views/AchievementsView').then((m) => ({ default: m.AchievementsView })));
const Roulette = lazy(() => import('./components/Roulette').then((m) => ({ default: m.Roulette })));
const ConstellationView = lazy(() => import('./views/ConstellationView').then((m) => ({ default: m.ConstellationView })));

/** 주소에 ?stress=N 이 있으면 가상 라이브러리 N개로 탐색기만 띄우는 부하 테스트 모드 */
const STRESS = readStressCount();
const STRESS_SOURCE: EngineSource | null = STRESS ? { kind: 'stress', count: STRESS } : null;

type View = 'explorer' | 'voyage' | 'charts' | 'signal' | 'constellation' | 'achievements';

const TABS: { id: View; index: string; label: string }[] = [
  { id: 'explorer', index: '01', label: '그래프 탐색기' },
  { id: 'voyage', index: '02', label: '탐사' },
  { id: 'charts', index: '03', label: '차트' },
  { id: 'signal', index: '04', label: '시그널' },
  { id: 'constellation', index: '05', label: '성단' },
  { id: 'achievements', index: '06', label: '업적' },
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
/** 상태 표시줄에 바로 보이는 짧은 이유 (자세한 설명은 툴팁) */
const UNAVAILABLE_SHORT: Record<Extract<AccountState, { phase: 'unavailable' }>['reason'], string> = {
  login: '로그인 필요',
  'no-key': '서버에 Steam API 키 없음',
  'no-user': '계정 없음',
  'not-found': '계정을 찾지 못함',
  quota: '오늘 호출 한도 근접',
  'user-quota': '오늘 동기화 횟수 소진',
  offline: '서버 연결 안 됨',
  'steam-failed': 'Steam 응답 실패',
};

/** 남은 시간: 1분 미만은 초, 그 이상은 분 (많은 이용자가 줄을 같이 쓰므로 최대 예상치) */
function formatEta(seconds: number): string {
  return seconds < 60 ? `약 ${seconds}초` : `최대 약 ${Math.ceil(seconds / 60)}분`;
}

const UNAVAILABLE_TEXT: Record<Extract<AccountState, { phase: 'unavailable' }>['reason'], string> = {
  login: 'Steam으로 로그인하면 내 라이브러리를 불러옵니다',
  'no-key': '서버의 .env에 STEAM_API_KEY가 없어 게임 목록을 받을 수 없습니다. 로그인은 되어 있습니다',
  'no-user': '.env에 STEAM_TEST_USER가 없습니다',
  'not-found': 'Steam 계정을 찾지 못했습니다',
  quota: '오늘 Steam Web API 호출 한도에 가까워 새로 받지 않았습니다',
  'user-quota': '이 계정은 오늘 새로 동기화할 수 있는 횟수를 다 썼습니다. 내일 다시 받아 옵니다',
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
    `flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[10.5px] transition ${active ? 'bg-white/[0.09] text-white' : 'text-white/40 hover:text-white/70'}`;

  let dot = 'bg-white/30';
  let status = '';
  let title = '';
  if (account.phase === 'demo') {
    dot = 'bg-violet-300';
    status = 'DEMO · 샘플 데이터 · 이름 가림 · 이미지 끔';
    title = '스크린샷·발표용 시연 모드입니다. 서버에 아무것도 묻지 않습니다';
  } else if (account.phase === 'unavailable' && account.reason === 'login') {
    dot = 'bg-amber-300';
    status = 'SAMPLE · 로그인 필요';
    title = UNAVAILABLE_TEXT.login;
  } else if (account.phase === 'unavailable') {
    dot = 'bg-amber-300';
    status = `SAMPLE · ${UNAVAILABLE_SHORT[account.reason]}`;
    title = UNAVAILABLE_TEXT[account.reason];
  } else if (account.phase === 'loading' || catalog.phase === 'connecting') {
    dot = 'bg-sky-300 animate-pulse';
    status = 'LOADING';
  } else if (catalog.phase === 'syncing') {
    dot = 'bg-sky-300 animate-pulse';
    const eta = catalog.status.etaSeconds ?? 0;
    status = `STORE SYNC ${catalog.status.ready}/${catalog.status.total}${eta > 0 ? ` · ${formatEta(eta)}` : ''}`;
    title = 'Steam 상점 정보를 받는 중입니다. 많이 한 게임부터 채워지며, 한 번 받은 정보는 모든 이용자가 같이 씁니다';
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
        <button
          type="button"
          role="radio"
          aria-checked={source === 'demo'}
          className={seg(source === 'demo')}
          onClick={() => onChange('demo')}
          title="스크린샷·발표용: 샘플 데이터, 이름 가림, 게임 이미지 끔"
        >
          {source === 'demo' && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}시연
        </button>
      </div>
      <span className="hidden max-w-[220px] truncate font-mono text-[9px] tracking-[0.14em] text-white/40 min-[1700px]:inline" title={title || status}>
        {status}
      </span>
      {source === 'steam' && account.phase === 'unavailable' && account.reason === 'login' && <SignInThroughSteam />}
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

/** 부하 테스트 모드 표시: 데이터 출처 전환 대신 보인다 */
function StressBadge({ count, state }: { count: number; state: EngineState }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="whitespace-nowrap rounded-full border border-amber-200/30 bg-amber-300/10 px-2.5 py-[3px] font-mono text-[10px] tracking-[0.14em] text-amber-100/90">
        STRESS · {count.toLocaleString('ko-KR')}
      </span>
      <span className="hidden whitespace-nowrap font-mono text-[9px] tracking-[0.14em] text-white/40 min-[1800px]:inline">
        {state.phase === 'ready'
          ? `가상 데이터 · 그래프 ${(state.buildMs / 1000).toFixed(1)}초 · 전체 ${(state.totalMs / 1000).toFixed(1)}초`
          : state.phase === 'error'
            ? '오류'
            : '그래프 엔진 준비 중…'}
      </span>
      <a href={window.location.pathname} className="whitespace-nowrap text-[10.5px] text-white/40 underline-offset-2 hover:text-white hover:underline">
        끝내기
      </a>
    </div>
  );
}

export default function App() {
  const [source, setSourceState] = useState<Source>(readSavedSource);
  const setSource = (s: Source) => {
    setSourceState(s);
    saveSource(s);
  };
  // 부하 테스트 중에는 서버에 아무것도 묻지 않는 시연 데이터를 바탕에 깔아 둔다
  const { library, catalog, account } = useLibrary(STRESS ? 'demo' : source);
  // 큰 그래프(부하 테스트 또는 게임이 아주 많은 라이브러리)는 그래프 엔진(Worker)이 만들고 소유한다
  const bigLibrary = !STRESS && library.games.length > ENGINE_LIBRARY;
  const librarySource = useMemo<EngineSource | null>(() => (bigLibrary ? { kind: 'library', library } : null), [bigLibrary, library]);
  const engineState = useGraphEngine(STRESS_SOURCE ?? librarySource);
  const engineMode = !!STRESS || bigLibrary;
  const [settings, updateSettings] = useSettings();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [blocked, setBlocked] = useState<number[]>([]);
  const [operator, setOperator] = useState<{ contactEmail: string | null; serverRegion: string | null }>({ contactEmail: null, serverRegion: null });
  const demo = source === 'demo';
  const { me, loginError, dismissLoginError, logout } = useSession(demo);

  // 권리자 요청으로 이미지를 끈 게임 목록 (STEAM_COMPLIANCE C7). 서버가 없으면 빈 목록
  useEffect(() => {
    if (demo) return;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { blockedImageAppids?: number[]; contactEmail?: string | null; serverRegion?: string | null } | null) => {
        if (!b) return;
        if (b.blockedImageAppids) setBlocked(b.blockedImageAppids);
        setOperator({ contactEmail: b.contactEmail ?? null, serverRegion: b.serverRegion ?? null });
      })
      .catch(() => undefined);
  }, [demo]);

  // 이미지 정책은 렌더 전에 정한다. 바뀌면 아래 main을 다시 그려 모든 화면이 새 정책을 따르게 한다
  // 부하 테스트의 게임은 가상 appid라 받을 이미지가 없다. Steam CDN에 수만 건을 요청하지도 않는다
  const imagesOn = settings.images && !demo && !STRESS;
  setImagePolicy({ enabled: imagesOn, blocked });
  const imageKey = `${imagesOn}:${blocked.join(',')}`;

  const libraryGraph = useMemo(() => buildOntologyGraph(engineMode ? { ...library, games: [], friends: [] } : library), [engineMode, library]);
  const graph = engineState.phase === 'ready' ? engineState.graph : libraryGraph;
  const player = engineState.phase === 'ready' ? engineState.player : library.player;
  const [rawView, setView] = useState<View>('explorer');
  // 부하 테스트는 탐색기만: 다른 탭은 수만 개를 그리도록 만들어져 있지 않다
  const view = STRESS ? 'explorer' : rawView;
  const [rawSelectedId, setSelectedId] = useState<string | null>(null);
  // 데이터가 갱신되며 선택한 노드가 사라졌을 수 있다
  const selectedId = rawSelectedId && graph.nodeById.has(rawSelectedId) ? rawSelectedId : null;
  const { stats } = graph;

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-6 border-b border-white/[0.06] bg-[#05060c]/95 px-5 backdrop-blur">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="text-[13px] font-semibold tracking-[0.22em] text-white">STEAMVERSE</span>
          {STRESS ? <StressBadge count={STRESS} state={engineState} /> : <SourceSwitch source={source} onChange={setSource} catalog={catalog} account={account} />}
        </div>

        <nav className="flex items-center rounded-full border border-white/[0.07] bg-white/[0.025] p-1">
          {TABS.map((t) => {
            const active = view === t.id;
            const off = !!STRESS && t.id !== 'explorer';
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                disabled={off}
                title={off ? '부하 테스트 중에는 탐색기만 열 수 있습니다' : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-[7px] text-[12.5px] transition ${
                  active
                    ? 'bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                    : off
                      ? 'cursor-not-allowed text-white/20'
                      : 'text-white/45 hover:text-white/80'
                }`}
              >
                <span className={`font-mono text-[9.5px] ${active ? 'text-sky-200/80' : 'text-white/25'}`}>{t.index}</span>
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-6">
          <Kpi label="Library" value={formatNumber(stats.totalGames)} unit="개" />
          <Kpi label="Playtime" value={formatNumber(stats.totalHours)} unit="시간" />
          <Kpi label="Backlog" value={formatNumber(stats.byStatus.backlog)} unit="개" sub={percent(stats.byStatus.backlog, stats.totalGames)} />
          {/* 좁은 화면에서는 덜 중요한 지표를 숨겨 헤더가 두 줄로 꺾이지 않게 */}
          <div className="hidden min-[1600px]:block">
            <Kpi label="Last 2 weeks" value={formatNumber(stats.recentHours)} unit="시간" />
          </div>
          <div className="hidden min-[1600px]:block">
            <Kpi label="Friends" value={formatNumber(stats.friends)} unit="명" />
          </div>
          <button
            onClick={() => setRouletteOpen(true)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.1] px-2.5 py-1 text-[11.5px] text-white/65 transition hover:border-white/30 hover:text-white"
            title="오늘 뭐 하지? 잠든 게임 중 하나를 골라 드려요"
          >
            <span aria-hidden>🎲</span>
            <span className="hidden min-[1500px]:inline">오늘 뭐 하지</span>
          </button>
          <button
            onClick={() => setAboutOpen(true)}
            className="grid size-7 place-items-center rounded-full border border-white/[0.1] font-mono text-[11px] text-white/50 transition hover:border-white/30 hover:text-white"
            aria-label="정보 · 데이터 · 설정"
            title="정보 · 데이터 · 설정"
          >
            i
          </button>
          <div className="flex items-center gap-3 border-l border-white/[0.08] pl-6">
            <div className="rounded-full bg-gradient-to-br from-[#ff8fb1] via-[#b69cff] to-[#7aa2ff] p-[1.5px]">
              <div className="grid size-8 place-items-center rounded-full bg-[#0a0c16] text-[12px] font-semibold text-white">나</div>
            </div>
            <div className="leading-tight">
              <div className="max-w-[120px] truncate whitespace-nowrap text-[12.5px] font-medium text-white">{player.name}</div>
              <div className="font-mono text-[10px] tracking-wider text-white/40">
                LV {player.level}
                {me && source === 'steam' && !STRESS && (
                  <button onClick={logout} className="ml-2 text-white/35 underline-offset-2 hover:text-white hover:underline">
                    로그아웃
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* 상점 정보 받는 중: 헤더 아래 얇은 진행 막대 */}
        {catalog.phase === 'syncing' && catalog.status.total > 0 && (
          <div className="absolute inset-x-0 -bottom-px h-[2px] bg-white/[0.04]" aria-hidden>
            <div
              className="h-full bg-gradient-to-r from-sky-300/70 to-violet-300/70 transition-[width] duration-700"
              style={{ width: `${Math.round((catalog.status.ready / catalog.status.total) * 100)}%` }}
            />
          </div>
        )}
      </header>

      {loginError && (
        <div className="fixed top-[72px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-200/25 bg-[#1a1408]/95 px-4 py-2 text-[12px] text-amber-100/90">
          {loginError}
          <button onClick={dismissLoginError} className="text-amber-100/50 hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>
      )}
      {rouletteOpen && (
        <Suspense fallback={null}>
          <Roulette
            graph={graph}
            onClose={() => setRouletteOpen(false)}
            onOpen={(id) => {
              setRouletteOpen(false);
              setSelectedId(id);
              setView('explorer');
            }}
          />
        </Suspense>
      )}
      {aboutOpen && <About onClose={() => setAboutOpen(false)} settings={settings} onSettings={updateSettings} demo={demo} operator={operator} />}

      <main key={imageKey} className="relative min-h-0 flex-1">
        {demo && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-violet-300/30 bg-violet-500/15 px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-violet-200/90">
            DEMO
          </div>
        )}
        {engineMode && engineState.phase !== 'ready' ? (
          <div className="grid h-full place-items-center bg-[#04050a] text-center">
            {engineState.phase === 'error' ? (
              <p className="text-[13px] text-amber-200/80">그래프를 만들지 못했습니다: {engineState.message}</p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-sky-300/80" />
                <p className="text-[13px] text-white/60">
                  {STRESS ? `가상 게임 ${STRESS.toLocaleString('ko-KR')}개로` : `게임 ${library.games.length.toLocaleString('ko-KR')}개로`} 그래프를 만드는 중…
                </p>
                <p className="font-mono text-[10px] tracking-[0.14em] text-white/30">화면 밖(Worker)에서 계산합니다</p>
              </div>
            )}
          </div>
        ) : (
          view === 'explorer' && (
            <ExplorerView graph={graph} selectedId={selectedId} onSelect={setSelectedId} engine={engineState.phase === 'ready' ? engineState.engine : null} />
          )
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
        {view === 'signal' && (
          <Suspense fallback={<div className="h-full bg-[#04050a]" />}>
            <SignalView
              graph={graph}
              onOpenInExplorer={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
        {view === 'constellation' && (
          <Suspense fallback={<div className="h-full bg-[#04050a]" />}>
            <ConstellationView
              graph={graph}
              onOpen={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
        {view === 'achievements' && (
          <Suspense fallback={<div className="h-full bg-[#04050a]" />}>
            <AchievementsView
              graph={graph}
              onOpenInExplorer={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
        {view === 'voyage' && (
          <Suspense fallback={<div className="h-full bg-[#04050b]" />}>
            <VoyageView
              graph={graph}
              playerId={source === 'steam' ? library.player.steamid : source}
              coverArt={settings.voyageCoverArt && imagesOn}
              onOpenInExplorer={(id) => {
                setSelectedId(id);
                setView('explorer');
              }}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}
