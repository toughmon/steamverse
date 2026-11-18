import { cacheGet, cacheSet } from './lib/cache';
import { getJson } from './lib/http';
import { RateLimitedError, createThrottle } from './lib/throttle';

/**
 * 게임별 업적의 전 세계 달성률 (ISteamUserStats/GetGlobalAchievementPercentagesForApp, 키 불필요).
 * 개인정보가 아닌 게임 단위 통계라 모든 이용자가 캐시를 같이 쓴다. 희귀 업적 쇼케이스에 쓴다.
 */
export const globalAchQueue = createThrottle('globalach', 250);

/** 달성률은 천천히 바뀐다 */
const TTL = 7 * 24 * 3600 * 1000;
const RETRY_AFTER = 10 * 60 * 1000;

/** 업적 API 이름 → 달성률(%) */
export type Percentages = Record<string, number>;

const inflight = new Map<number, Promise<Percentages | null>>();
const failedAt = new Map<number, number>();

async function load(appid: number): Promise<Percentages | null> {
  try {
    const r = await globalAchQueue.schedule(async () => {
      try {
        return await getJson<{ achievementpercentages?: { achievements?: { name: string; percent: number | string }[] } }>(
          `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appid}`,
        );
      } catch (err) {
        if (err instanceof RateLimitedError) globalAchQueue.pause(60_000);
        throw err;
      }
    });
    const out: Percentages = {};
    for (const a of r.achievementpercentages?.achievements ?? []) {
      const p = Number(a.percent);
      if (Number.isFinite(p)) out[a.name] = Math.round(p * 100) / 100;
    }
    await cacheSet('globalach', String(appid), out);
    failedAt.delete(appid);
    return out;
  } catch {
    failedAt.set(appid, Date.now());
    return null;
  } finally {
    inflight.delete(appid);
  }
}

/** 캐시에 있는 것만 바로 주고, 없는 것은 뒤에서 받기 시작한다 (상점 카탈로그와 같은 방식) */
export async function getGlobalPercentages(appids: number[]) {
  const apps: Record<number, Percentages> = {};
  let pending = 0;
  let failed = 0;
  for (const appid of appids) {
    const hit = await cacheGet<Percentages>('globalach', String(appid), TTL);
    if (hit) {
      apps[appid] = hit;
      continue;
    }
    const lastFail = failedAt.get(appid);
    if (lastFail && Date.now() - lastFail < RETRY_AFTER && !inflight.has(appid)) {
      failed++;
      continue;
    }
    pending++;
    if (!inflight.has(appid)) inflight.set(appid, load(appid));
  }
  return { apps, status: { total: appids.length, ready: Object.keys(apps).length, pending, failed } };
}
