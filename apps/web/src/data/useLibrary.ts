import { useEffect, useState } from 'react';
import { registerSteamImages } from '@steamverse/shared';
import type { CatalogResponse, CatalogStatus, LibraryData, StoreApp } from '@steamverse/shared';
import { sampleLibrary } from './sampleLibrary';

/**
 * 라이브러리 데이터 출처.
 * - steam: 서버가 Steam Web API로 받은 내 플레이 기록(보유 게임·시간·업적·친구)
 * - sample: 프로토타입용 샘플
 * 어느 쪽이든 게임 정보(회사·장르·태그·출시년도·가격)는 상점 카탈로그로 덮어쓴다.
 */
export type Source = 'steam' | 'sample';

export type CatalogState =
  | { phase: 'connecting' }
  | { phase: 'offline' }
  | { phase: 'syncing'; status: CatalogStatus }
  | { phase: 'live'; status: CatalogStatus };

export type AccountWarning = 'games-private' | 'friends-private' | 'achievements-private';
export type AccountState =
  | { phase: 'sample' }
  | { phase: 'loading' }
  | { phase: 'ok'; warnings: AccountWarning[] }
  /** 계정을 못 불러 샘플을 대신 보여 주는 중 */
  | { phase: 'unavailable'; reason: 'no-key' | 'no-user' | 'not-found' | 'offline' | 'steam-failed' };

/** 게임당 태그 수. 너무 많으면 태그 노드가 폭증해 그래프·은하가 흐려진다 */
const TAGS_PER_GAME = 6;
const POLL_MS = 4000;
const OFFLINE_RETRY_MS = 15000;
/** 받는 중에는 이만큼 새로 쌓였을 때만 그래프를 다시 만든다 (화면이 계속 흔들리지 않게) */
const COMMIT_EVERY = 15;
const SOURCE_KEY = 'steamverse.source';

export function mergeCatalog(base: LibraryData, apps: StoreApp[]): LibraryData {
  const byId = new Map(apps.filter((a) => a.available).map((a) => [a.appid, a]));
  return {
    ...base,
    games: base.games.map((g) => {
      const a = byId.get(g.appid);
      if (!a) return g;
      if (a.images) registerSteamImages(g.appid, a.images);
      return {
        ...g,
        name: a.name || g.name,
        developers: a.developers.length ? a.developers : g.developers,
        publishers: a.publishers.length ? a.publishers : g.publishers,
        genres: a.genres.length ? a.genres : g.genres,
        tags: a.tags.length ? a.tags.slice(0, TAGS_PER_GAME) : g.tags,
        releaseYear: a.releaseYear ?? g.releaseYear,
        priceKrw: a.isFree ? 0 : (a.price?.initial ?? g.priceKrw),
        sale: a.price && a.price.discountPercent > 0 ? { priceKrw: a.price.final, discountPercent: a.price.discountPercent } : undefined,
      };
    }),
  };
}

export function readSavedSource(): Source {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'sample' ? 'sample' : 'steam';
  } catch {
    return 'steam';
  }
}

export function saveSource(source: Source) {
  try {
    localStorage.setItem(SOURCE_KEY, source);
  } catch {
    /* 저장 못 해도 동작에는 지장 없음 */
  }
}

async function loadAccount(): Promise<{ library: LibraryData; account: AccountState }> {
  try {
    const res = await fetch('/api/library');
    const body = (await res.json().catch(() => ({}))) as { library?: LibraryData; warnings?: AccountWarning[]; error?: string };
    if (res.ok && body.library) return { library: body.library, account: { phase: 'ok', warnings: body.warnings ?? [] } };
    const reason = (['no-key', 'no-user', 'not-found'] as const).find((r) => r === body.error) ?? 'steam-failed';
    return { library: sampleLibrary, account: { phase: 'unavailable', reason } };
  } catch {
    return { library: sampleLibrary, account: { phase: 'unavailable', reason: 'offline' } };
  }
}

export function useLibrary(source: Source): { library: LibraryData; catalog: CatalogState; account: AccountState } {
  const [library, setLibrary] = useState<LibraryData>(sampleLibrary);
  const [catalog, setCatalog] = useState<CatalogState>({ phase: 'connecting' });
  const [account, setAccount] = useState<AccountState>(source === 'steam' ? { phase: 'loading' } : { phase: 'sample' });

  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    let committed = -1;
    let base: LibraryData = sampleLibrary;
    setCatalog({ phase: 'connecting' });

    const poll = async () => {
      if (base.games.length === 0) {
        setLibrary(base);
        setCatalog({ phase: 'live', status: { total: 0, ready: 0, pending: 0, failed: 0 } });
        return;
      }
      try {
        const appids = base.games.map((g) => g.appid).join(',');
        const res = await fetch(`/api/catalog?appids=${appids}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as CatalogResponse;
        if (cancelled) return;
        const { status } = body;
        const done = status.pending === 0;
        if (status.ready !== committed && (done || committed < 0 || status.ready - committed >= COMMIT_EVERY)) {
          committed = status.ready;
          setLibrary(mergeCatalog(base, body.apps));
        }
        setCatalog({ phase: done ? 'live' : 'syncing', status });
        if (!done) timer = window.setTimeout(poll, POLL_MS);
      } catch {
        // 서버가 꺼져 있으면 지금 데이터 그대로 쓰고, 가끔 다시 붙어 본다
        if (cancelled) return;
        if (committed < 0) setLibrary(base);
        setCatalog({ phase: 'offline' });
        timer = window.setTimeout(poll, OFFLINE_RETRY_MS);
      }
    };

    void (async () => {
      if (source === 'steam') {
        setAccount({ phase: 'loading' });
        const r = await loadAccount();
        if (cancelled) return;
        base = r.library;
        setAccount(r.account);
      } else {
        setAccount({ phase: 'sample' });
      }
      await poll();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source]);

  return { library, catalog, account };
}
