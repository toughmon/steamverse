import { env } from '../env';
import { UpstreamError, getJson } from '../lib/http';
import { RateLimitedError, createThrottle } from '../lib/throttle';
import { countCall } from './quota';

/**
 * Steam Web API (키 필요). 공식 한도는 하루 10만 회라 넉넉하지만,
 * 친구·업적을 한꺼번에 부를 때 몰리지 않게 짧은 간격을 둔다.
 */
export const webapiQueue = createThrottle('webapi', 120);

const BASE = 'https://api.steampowered.com';

export class MissingKeyError extends Error {
  constructor() {
    super('STEAM_API_KEY가 .env에 없다');
  }
}

/**
 * 키를 쿼리에 붙이는 곳은 여기 한 곳뿐이다. 키가 든 URL 문자열은 이 함수 밖으로 내보내지 않는다.
 * (getJson은 오류에 호스트·상태만 담는다 — STEAM_COMPLIANCE K2)
 */
function call<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
  if (!env.steamApiKey) return Promise.reject(new MissingKeyError());
  const qs = new URLSearchParams({ key: env.steamApiKey, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  return webapiQueue.schedule(async () => {
    await countCall((used) => console.warn(`[webapi] 오늘 호출 ${used}회 — 하루 한도의 80%를 넘었다`));
    try {
      return await getJson<T>(`${BASE}/${path}/?${qs}`);
    } catch (err) {
      if (err instanceof RateLimitedError) webapiQueue.pause(30_000);
      throw err;
    }
  });
}

export interface RawPlayer {
  steamid: string;
  personaname: string;
  /** 1 = 비공개, 3 = 공개 */
  communityvisibilitystate: number;
  avatarfull?: string;
  timecreated?: number;
}

export interface RawOwnedGame {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
  has_community_visible_stats?: boolean;
}

export async function resolveVanity(name: string): Promise<string | null> {
  const r = await call<{ response: { success: number; steamid?: string } }>('ISteamUser/ResolveVanityURL/v1', { vanityurl: name });
  return r.response.success === 1 ? r.response.steamid! : null;
}

export async function getPlayers(steamids: string[]): Promise<RawPlayer[]> {
  const out: RawPlayer[] = [];
  // 한 번에 최대 100명
  for (let i = 0; i < steamids.length; i += 100) {
    const r = await call<{ response: { players: RawPlayer[] } }>('ISteamUser/GetPlayerSummaries/v2', { steamids: steamids.slice(i, i + 100).join(',') });
    out.push(...r.response.players);
  }
  return out;
}

/** 게임 세부 정보가 비공개면 null */
export async function getOwnedGames(steamid: string): Promise<RawOwnedGame[] | null> {
  const r = await call<{ response: { game_count?: number; games?: RawOwnedGame[] } }>('IPlayerService/GetOwnedGames/v1', {
    steamid,
    include_appinfo: true,
    include_played_free_games: true,
  });
  return r.response.game_count === undefined ? null : (r.response.games ?? []);
}

/** 친구 목록이 비공개면 null */
export async function getFriends(steamid: string): Promise<{ steamid: string; friend_since: number }[] | null> {
  try {
    const r = await call<{ friendslist: { friends: { steamid: string; friend_since: number }[] } }>('ISteamUser/GetFriendList/v1', { steamid });
    return r.friendslist.friends;
  } catch (err) {
    // 비공개 프로필은 401을 준다
    if (err instanceof UpstreamError && err.status === 401) return null;
    throw err;
  }
}

export async function getLevel(steamid: string): Promise<number> {
  const r = await call<{ response: { player_level?: number } }>('IPlayerService/GetSteamLevel/v1', { steamid });
  return r.response.player_level ?? 0;
}

export interface AchievementResult {
  unlocked: number;
  total: number;
  /** 해금한 업적: API 이름, 표시 이름(한국어 우선), 해금 시각(unix 초) */
  log: { api: string; name?: string; t: number }[];
}

/** 업적이 없는 게임이면 null, 게임 세부 정보가 비공개라 못 보면 'private' */
export async function getAchievements(steamid: string, appid: number): Promise<AchievementResult | null | 'private'> {
  try {
    const r = await call<{ playerstats: { success: boolean; achievements?: { apiname: string; achieved: number; unlocktime?: number; name?: string }[] } }>(
      'ISteamUserStats/GetPlayerAchievements/v1',
      // l: 표시 이름을 한국어로 (없으면 기본 언어)
      { steamid, appid, l: 'koreana' },
    );
    const list = r.playerstats.achievements;
    if (!r.playerstats.success || !list?.length) return null;
    const done = list.filter((a) => a.achieved);
    return {
      unlocked: done.length,
      total: list.length,
      // 해금 시각이 0인 업적(아주 오래전 해금 등)은 캘린더에 둘 수 없어 뺀다
      log: done.filter((a) => (a.unlocktime ?? 0) > 0).map((a) => ({ api: a.apiname, name: a.name || undefined, t: a.unlocktime! })),
    };
  } catch (err) {
    // 업적이 없는 게임은 400을 준다
    if (err instanceof UpstreamError && err.status === 403) return 'private';
    if (err instanceof UpstreamError && err.status === 400) return null;
    throw err;
  }
}
