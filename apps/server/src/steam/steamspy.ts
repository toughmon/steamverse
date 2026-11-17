import { getJson } from '../lib/http';
import { RateLimitedError, createThrottle } from '../lib/throttle';

/**
 * SteamSpy (비공식, 키 불필요). 공식 API에 없는 유저 태그를 여기서 받는다.
 * 권장 한도가 초당 1회라 1.1초 간격.
 */
export const steamspyQueue = createThrottle('steamspy', 1100);

/** 취향과 무관해서 유사도·은하 계산을 흐리는 일반 태그 */
const GENERIC_TAGS = new Set([
  'Singleplayer',
  'Great Soundtrack',
  'Steam Achievements',
  'Controller',
  'Full controller support',
  'Atmospheric',
  'Classic',
  'Masterpiece',
  'Addictive',
  'Beautiful',
  'Free to Play',
  'Early Access',
  'Indie',
  'Action',
  'Adventure',
  'Casual',
  'Simulation',
  'Strategy',
  'RPG',
]);

export const MAX_TAGS = 12;

/** 투표 수 순 태그. 정보가 없으면 빈 배열 */
export function fetchTags(appid: number): Promise<string[]> {
  return steamspyQueue.schedule(async () => {
    try {
      const body = await getJson<{ tags?: Record<string, number> | unknown[] }>(
        `https://steamspy.com/api.php?request=appdetails&appid=${appid}`,
      );
      // 태그가 없으면 빈 배열([])로 온다
      if (!body.tags || Array.isArray(body.tags)) return [];
      return Object.entries(body.tags)
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t)
        .filter((t) => !GENERIC_TAGS.has(t))
        .slice(0, MAX_TAGS);
    } catch (err) {
      if (err instanceof RateLimitedError) steamspyQueue.pause(60_000);
      throw err;
    }
  });
}
