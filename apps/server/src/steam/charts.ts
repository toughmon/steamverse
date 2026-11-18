import { getJson } from '../lib/http';
import { storeTagsQueue } from './storetags';

/**
 * 지금 많이 플레이되는 게임 상위 100개 (Steam 공식 차트, 키 불필요).
 * 상점 정보를 미리 채워 두는 데 쓴다 — 게임 사실 정보라 개인정보와 무관하다.
 */
export async function fetchMostPlayed(): Promise<number[]> {
  const r = await storeTagsQueue.schedule(() =>
    getJson<{ response?: { ranks?: { appid: number }[] } }>('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/'),
  );
  return (r.response?.ranks ?? []).map((x) => x.appid).filter((n) => Number.isInteger(n) && n > 0);
}
