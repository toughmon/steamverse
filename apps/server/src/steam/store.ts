import { getJson } from '../lib/http';
import { RateLimitedError, createThrottle } from '../lib/throttle';

/**
 * Steam Store API (키 불필요). 비공식 문서 기준 약 200회/5분 제한이라 1.6초 간격으로 보낸다.
 * appdetails는 상세 정보를 한 번에 앱 하나씩만 준다.
 */
export const storeQueue = createThrottle('store', 1600);

export interface RawAppDetails {
  type: string;
  name: string;
  steam_appid: number;
  is_free: boolean;
  developers?: string[];
  publishers?: string[];
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  release_date?: { coming_soon: boolean; date: string };
  price_overview?: { currency: string; initial: number; final: number; discount_percent: number };
  metacritic?: { score: number };
  platforms?: { windows: boolean; mac: boolean; linux: boolean };
  header_image?: string;
  capsule_image?: string;
}

async function requestDetails(appid: number, cc: string): Promise<RawAppDetails | null> {
  return storeQueue.schedule(async () => {
    try {
      // 회사·장르·태그 이름을 그래프와 맞추려고 영어로 받는다
      const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&l=english`;
      const body = await getJson<Record<string, { success: boolean; data?: RawAppDetails }>>(url);
      const entry = body[String(appid)];
      return entry?.success && entry.data ? entry.data : null;
    } catch (err) {
      if (err instanceof RateLimitedError) storeQueue.pause(90_000);
      throw err;
    }
  });
}

/**
 * 한국 상점 기준(원화 가격)으로 받는다. 한국에서 따로 서비스하는 게임(로스트아크, 패스 오브 엑자일 등)은
 * 한국 상점에 없으므로 미국 상점에서 정보만 받고 가격은 버린다(달러는 비교할 수 없으니까).
 * 둘 다 없으면 null.
 */
export async function fetchAppDetails(appid: number): Promise<RawAppDetails | null> {
  const kr = await requestDetails(appid, 'kr');
  if (kr) return kr;
  const us = await requestDetails(appid, 'us');
  return us && { ...us, price_overview: undefined };
}
