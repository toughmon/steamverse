import type { CatalogResponse, StoreApp } from '@steamverse/shared';
import { cacheGet, cacheSet } from './lib/cache';
import { fetchAppDetails, storeQueue } from './steam/store';
import { fetchMostPlayed } from './steam/charts';
import { fetchTags } from './steam/steamspy';
import { fetchStoreTags } from './steam/storetags';

/** 2: 이미지 주소, 공식 상점 태그 */
const SCHEMA = 2;

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
    const [details, officialTags] = await Promise.all([
      fetchAppDetails(appid),
      // 태그는 없어도 되는 정보라 실패해도 전체를 실패로 보지 않는다
      fetchStoreTags(appid).catch(() => null),
    ]);
    // 공식 태그가 비었을 때만 SteamSpy로 보충
    const spyTags = officialTags?.length ? null : await fetchTags(appid).catch(() => null);
    const tags = officialTags?.length ? officialTags : (spyTags ?? officialTags);
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
      images: { header: details?.header_image, capsule: details?.capsule_image },
      platforms: details?.platforms ?? { windows: true, mac: false, linux: false },
      sources: [
        ...(details ? (['store'] as const) : []),
        ...(officialTags?.length ? (['storetags'] as const) : []),
        ...(spyTags?.length ? (['steamspy'] as const) : []),
      ],
      schema: SCHEMA,
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

/** 형식이 바뀌기 전에 저장된 항목은 다시 받는다 */
async function cached(appid: number): Promise<StoreApp | undefined> {
  const app = await cacheGet<StoreApp>('store', String(appid), TTL);
  return app?.schema === SCHEMA ? app : undefined;
}

/** 캐시에 있으면 바로, 없으면 받아 온다 (요청 간격 제한 때문에 오래 걸릴 수 있다) */
export async function getApp(appid: number): Promise<StoreApp | null> {
  const hit = await cached(appid);
  if (hit) return hit;
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
    const hit = await cached(appid);
    if (hit) {
      apps.push(hit);
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
  // 상점 요청 줄은 모든 이용자가 같이 쓴다. 지금 줄이 다 빠지기까지의 시간이 이 사람의 최대 대기 시간이다
  const etaSeconds = pending ? Math.ceil(storeQueue.etaMs / 1000) : 0;
  return { apps, status: { total: appids.length, ready: apps.length, pending, failed, etaSeconds } };
}

/**
 * 인기 게임 상점 정보 미리 채우기. 처음 오는 이용자가 기다리는 시간을 줄인다.
 * 이용자 요청이 우선이라, 상점 요청 줄이 비어 있을 때만 한 개씩 넣는다 (요청 간격 규칙 그대로 — STEAM_COMPLIANCE L2)
 */
export function startPrewarm(onError: (err: unknown) => void): void {
  const REFRESH_LIST = 24 * 3600 * 1000;
  let list: number[] = [];
  let listAt = 0;
  let busy = false;
  const tick = async () => {
    if (busy || storeQueue.size > 0 || inflight.size > 0) return;
    busy = true;
    try {
      if (Date.now() - listAt > REFRESH_LIST) {
        list = await fetchMostPlayed();
        listAt = Date.now();
      }
      for (const appid of list) {
        if (await cached(appid)) continue;
        const lastFail = failedAt.get(appid);
        if (lastFail && Date.now() - lastFail < RETRY_AFTER) continue;
        void getApp(appid);
        return;
      }
    } catch (err) {
      listAt = Date.now() - REFRESH_LIST + 10 * 60 * 1000; // 목록을 못 받았으면 10분 뒤 다시
      onError(err);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), 5000).unref();
}
