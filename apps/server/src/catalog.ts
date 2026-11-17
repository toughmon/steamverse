import type { CatalogResponse, StoreApp } from '@steamverse/shared';
import { cacheGet, cacheSet } from './lib/cache';
import { fetchAppDetails } from './steam/store';
import { fetchTags } from './steam/steamspy';

/** 상점 정보는 자주 안 바뀐다. 가격은 할인 때문에 바뀌지만 일주일이면 충분 */
const TTL = 7 * 24 * 3600 * 1000;
/** 실패한 앱은 이만큼 지나야 다시 시도 */
const RETRY_AFTER = 10 * 60 * 1000;

const inflight = new Map<number, Promise<StoreApp | null>>();
const failedAt = new Map<number, number>();

function parseYear(date?: string): number | undefined {
  const m = date?.match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : undefined;
}

async function load(appid: number): Promise<StoreApp | null> {
  try {
    const [details, tags] = await Promise.all([
      fetchAppDetails(appid),
      // 태그는 없어도 되는 정보라 실패해도 전체를 실패로 보지 않는다
      fetchTags(appid).catch(() => null),
    ]);
    const app: StoreApp = {
      appid,
      available: details !== null,
      name: details?.name ?? '',
      developers: details?.developers ?? [],
      publishers: details?.publishers ?? [],
      genres: details?.genres?.map((g) => g.description) ?? [],
      categories: details?.categories?.map((c) => c.description) ?? [],
      tags: tags ?? [],
      releaseYear: parseYear(details?.release_date?.date),
      isFree: details?.is_free ?? false,
      price: details?.price_overview && {
        currency: details.price_overview.currency,
        // Store API 금액은 1/100 단위
        initial: Math.round(details.price_overview.initial / 100),
        final: Math.round(details.price_overview.final / 100),
        discountPercent: details.price_overview.discount_percent,
      },
      metacritic: details?.metacritic?.score,
      platforms: details?.platforms ?? { windows: true, mac: false, linux: false },
      sources: [...(details ? (['store'] as const) : []), ...(tags ? (['steamspy'] as const) : [])],
      fetchedAt: new Date().toISOString(),
    };
    // 태그를 못 받았으면 캐시하지 않고 다음에 다시 채운다
    if (tags !== null) await cacheSet('store', String(appid), app);
    failedAt.delete(appid);
    return app;
  } catch {
    failedAt.set(appid, Date.now());
    return null;
  } finally {
    inflight.delete(appid);
  }
}

/** 캐시에 있으면 바로, 없으면 받아 온다 (요청 간격 제한 때문에 오래 걸릴 수 있다) */
export async function getApp(appid: number): Promise<StoreApp | null> {
  const cached = await cacheGet<StoreApp>('store', String(appid), TTL);
  if (cached) return cached;
  let p = inflight.get(appid);
  if (!p) {
    p = load(appid);
    inflight.set(appid, p);
  }
  return p;
}

/**
 * 여러 앱을 한 번에. 캐시에 있는 것만 바로 돌려주고, 없는 것은 뒤에서 받기 시작한다.
 * 클라이언트는 status.pending 이 0이 될 때까지 다시 물어보면 된다.
 */
export async function getCatalog(appids: number[]): Promise<CatalogResponse> {
  const apps: StoreApp[] = [];
  let pending = 0;
  let failed = 0;
  for (const appid of appids) {
    const cached = await cacheGet<StoreApp>('store', String(appid), TTL);
    if (cached) {
      apps.push(cached);
      continue;
    }
    const lastFail = failedAt.get(appid);
    if (lastFail && Date.now() - lastFail < RETRY_AFTER && !inflight.has(appid)) {
      failed++;
      continue;
    }
    pending++;
    if (!inflight.has(appid)) void getApp(appid);
  }
  return { apps, status: { total: appids.length, ready: apps.length, pending, failed } };
}
