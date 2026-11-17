import { useEffect, useState } from 'react';
import type { CatalogResponse, CatalogStatus, LibraryData, StoreApp } from '@steamverse/shared';
import { sampleLibrary } from './sampleLibrary';

/**
 * 라이브러리 데이터 출처.
 * 지금은 플레이 기록(보유 게임·시간·업적·친구)은 샘플이고,
 * 게임 정보(회사·장르·태그·출시년도·가격)만 서버를 거쳐 실제 상점 정보로 덮어쓴다.
 * API 키가 생기면 플레이 기록도 서버에서 받게 바꾼다.
 */
export type CatalogState =
  | { phase: 'connecting' }
  | { phase: 'offline' }
  | { phase: 'syncing'; status: CatalogStatus }
  | { phase: 'live'; status: CatalogStatus };

/** 게임당 태그 수. 너무 많으면 태그 노드가 폭증해 그래프·은하가 흐려진다 */
const TAGS_PER_GAME = 6;
const POLL_MS = 4000;
const OFFLINE_RETRY_MS = 15000;
/** 받는 중에는 이만큼 새로 쌓였을 때만 그래프를 다시 만든다 (화면이 계속 흔들리지 않게) */
const COMMIT_EVERY = 15;

export function mergeCatalog(base: LibraryData, apps: StoreApp[]): LibraryData {
  const byId = new Map(apps.filter((a) => a.available).map((a) => [a.appid, a]));
  return {
    ...base,
    games: base.games.map((g) => {
      const a = byId.get(g.appid);
      if (!a) return g;
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

export function useLibrary(): { library: LibraryData; catalog: CatalogState } {
  const [library, setLibrary] = useState<LibraryData>(sampleLibrary);
  const [catalog, setCatalog] = useState<CatalogState>({ phase: 'connecting' });

  useEffect(() => {
    const appids = sampleLibrary.games.map((g) => g.appid).join(',');
    let timer: number | undefined;
    let cancelled = false;
    let committed = -1;

    const poll = async () => {
      try {
        const res = await fetch(`/api/catalog?appids=${appids}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as CatalogResponse;
        if (cancelled) return;
        const { status } = body;
        const done = status.pending === 0;
        if (status.ready !== committed && (done || committed < 0 || status.ready - committed >= COMMIT_EVERY)) {
          committed = status.ready;
          setLibrary(mergeCatalog(sampleLibrary, body.apps));
        }
        setCatalog({ phase: done ? 'live' : 'syncing', status });
        if (!done) timer = window.setTimeout(poll, POLL_MS);
      } catch {
        // 서버가 꺼져 있으면 샘플 그대로 쓰고, 가끔 다시 붙어 본다
        if (cancelled) return;
        setCatalog({ phase: 'offline' });
        timer = window.setTimeout(poll, OFFLINE_RETRY_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return { library, catalog };
}
