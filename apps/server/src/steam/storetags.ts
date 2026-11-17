import { cacheGet, cacheSet } from '../lib/cache';
import { getJson } from '../lib/http';
import { RateLimitedError, createThrottle } from '../lib/throttle';
import { GENERIC_TAGS, MAX_TAGS } from './steamspy';

/**
 * Steam 공식 상점 API의 유저 태그 (키 불필요).
 * SteamSpy는 최근 게임 데이터가 비어 있어서 이쪽을 먼저 쓴다.
 * - IStoreBrowseService/GetItems: 앱별 태그 id와 투표 가중치
 * - IStoreService/GetTagList: 태그 id → 이름
 */
export const storeTagsQueue = createThrottle('storetags', 300);

const TAGLIST_TTL = 7 * 24 * 3600 * 1000;
let tagNames: Promise<Map<number, string>> | null = null;

function loadTagNames(): Promise<Map<number, string>> {
  tagNames ??= (async () => {
    const cached = await cacheGet<[number, string][]>('meta', 'taglist', TAGLIST_TTL);
    if (cached) return new Map(cached);
    const r = await storeTagsQueue.schedule(() =>
      getJson<{ response: { tags: { tagid: number; name: string }[] } }>('https://api.steampowered.com/IStoreService/GetTagList/v1/?language=english'),
    );
    const entries = r.response.tags.map((t) => [t.tagid, t.name] as [number, string]);
    await cacheSet('meta', 'taglist', entries);
    return new Map(entries);
  })().catch((err) => {
    tagNames = null;
    throw err;
  });
  return tagNames;
}

/** 투표 가중치 순 태그. 정보가 없으면 빈 배열 */
export async function fetchStoreTags(appid: number): Promise<string[]> {
  const names = await loadTagNames();
  const input = JSON.stringify({
    ids: [{ appid }],
    context: { language: 'english', country_code: 'KR' },
    data_request: { include_tag_count: 20 },
  });
  const r = await storeTagsQueue.schedule(async () => {
    try {
      return await getJson<{ response: { store_items?: { tags?: { tagid: number; weight: number }[] }[] } }>(
        `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(input)}`,
      );
    } catch (err) {
      if (err instanceof RateLimitedError) storeTagsQueue.pause(60_000);
      throw err;
    }
  });
  const tags = r.response.store_items?.[0]?.tags ?? [];
  return tags
    .sort((a, b) => b.weight - a.weight)
    .map((t) => names.get(t.tagid))
    .filter((t): t is string => !!t && !GENERIC_TAGS.has(t))
    .slice(0, MAX_TAGS);
}
