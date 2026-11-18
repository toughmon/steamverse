import type { FriendRecord, GameRecord, LibraryData } from '@steamverse/shared';
import { cacheDelete, cacheGet, cachePurge, cacheSet } from './lib/cache';
import { assertQuota, assertUserQuota, countUserSync } from './steam/quota';
import { getAchievements, getFriends, getLevel, getOwnedGames, getPlayers, resolveVanity, type AchievementResult } from './steam/webapi';

/** 플레이 기록은 자주 바뀌니 짧게 */
const TTL = 10 * 60 * 1000;
/** 친구 정보가 담긴 캐시 파일은 이만큼 지나면 디스크에서 지운다 (STEAM_COMPLIANCE P4) */
export const LIBRARY_KEEP_MS = TTL * 2;
/** 같은 계정의 강제 새로고침은 이 간격에 한 번만 (Web API 호출량 보호 — L1) */
const REFRESH_COOLDOWN = 60 * 1000;
/** 친구가 아주 많으면 앞에서부터 이만큼만 (각자 GetOwnedGames를 한 번씩 부르므로) */
const MAX_FRIENDS = 60;
/** 업적은 게임마다 한 번씩 불러야 해서, 플레이 시간 순 상위만 */
const MAX_ACHIEVEMENT_GAMES = 80;

export type LibraryWarning = 'games-private' | 'friends-private' | 'achievements-private';

export interface LibraryResponse {
  library: LibraryData;
  warnings: LibraryWarning[];
}

export class ProfileNotFoundError extends Error {}

const isoDate = (unix?: number) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : undefined);

/** SteamID64 또는 프로필 주소의 /id/ 뒤 이름 */
export async function resolveSteamId(input: string): Promise<string> {
  const v = input.trim();
  if (/^\d{17}$/.test(v)) return v;
  const m = v.match(/steamcommunity\.com\/(?:profiles\/(\d{17})|id\/([^/?#]+))/);
  if (m?.[1]) return m[1];
  const id = await resolveVanity(m?.[2] ?? v);
  if (!id) throw new ProfileNotFoundError(v);
  return id;
}

async function build(steamid: string): Promise<LibraryResponse> {
  const warnings: LibraryWarning[] = [];
  const [[me], owned, friendList, level] = await Promise.all([getPlayers([steamid]), getOwnedGames(steamid), getFriends(steamid), getLevel(steamid)]);
  if (!me) throw new ProfileNotFoundError(steamid);
  if (owned === null) warnings.push('games-private');
  if (friendList === null) warnings.push('friends-private');

  const ownedGames = owned ?? [];
  // 업적: 플레이한 게임 중 통계가 공개된 것만
  const achTargets = ownedGames
    .filter((g) => g.has_community_visible_stats && g.playtime_forever > 0)
    .sort((a, b) => b.playtime_forever - a.playtime_forever)
    .slice(0, MAX_ACHIEVEMENT_GAMES);
  const achResults = await Promise.all(achTargets.map(async (g) => [g.appid, await getAchievements(steamid, g.appid).catch(() => null)] as const));
  if (achResults.some(([, r]) => r === 'private')) warnings.push('achievements-private');
  const achievements = new Map(achResults.filter((e): e is readonly [number, AchievementResult] => e[1] !== null && e[1] !== 'private'));

  const games: GameRecord[] = ownedGames.map((g) => ({
    appid: g.appid,
    name: g.name ?? `App ${g.appid}`,
    // 회사·장르·태그·출시년도·가격은 클라이언트가 상점 카탈로그로 채운다
    developers: [],
    publishers: [],
    genres: [],
    tags: [],
    releaseYear: 0,
    playtimeMinutes: g.playtime_forever,
    playtime2WeeksMinutes: g.playtime_2weeks ?? 0,
    lastPlayed: isoDate(g.rtime_last_played),
    achievements: achievements.has(g.appid) ? { unlocked: achievements.get(g.appid)!.unlocked, total: achievements.get(g.appid)!.total } : undefined,
    achievementLog: achievements.get(g.appid)?.log,
    deck: 'unknown',
  }));

  // 친구: 이름과, 내 라이브러리와 겹치는 게임의 플레이 시간
  const myAppids = new Set(games.map((g) => g.appid));
  const friendIds = (friendList ?? []).sort((a, b) => a.friend_since - b.friend_since).slice(0, MAX_FRIENDS);
  const friendPlayers = new Map((await getPlayers(friendIds.map((f) => f.steamid))).map((p) => [p.steamid, p]));
  const friends: FriendRecord[] = await Promise.all(
    friendIds.map(async (f) => {
      const theirs = (await getOwnedGames(f.steamid).catch(() => null)) ?? [];
      return {
        steamid: f.steamid,
        name: friendPlayers.get(f.steamid)?.personaname ?? f.steamid,
        since: isoDate(f.friend_since) ?? '',
        owned: theirs.filter((g) => myAppids.has(g.appid)).map((g) => ({ appid: g.appid, playtimeMinutes: g.playtime_forever })),
      };
    }),
  );

  return {
    library: {
      player: { steamid, name: me.personaname, accountCreated: isoDate(me.timecreated) ?? '', level },
      games,
      friends,
      syncedAt: new Date().toISOString(),
    },
    warnings,
  };
}

const inflight = new Map<string, Promise<LibraryResponse>>();

const lastRefresh = new Map<string, number>();

export async function getLibrary(steamid: string, refresh = false): Promise<LibraryResponse> {
  if (refresh) {
    const last = lastRefresh.get(steamid) ?? 0;
    if (Date.now() - last < REFRESH_COOLDOWN) refresh = false;
    else lastRefresh.set(steamid, Date.now());
  }
  if (!refresh) {
    const cached = await cacheGet<LibraryResponse>('library', steamid, TTL);
    if (cached) return cached;
  }
  let p = inflight.get(steamid);
  if (!p) {
    // 한도에 가까우면 새로 받지 않는다. 지난 캐시가 남아 있으면 그거라도 준다
    try {
      await assertQuota();
      assertUserQuota(steamid);
    } catch (err) {
      const stale = await cacheGet<LibraryResponse>('library', steamid, LIBRARY_KEEP_MS);
      if (stale) return stale;
      throw err;
    }
    countUserSync(steamid);
    p = build(steamid)
      .then(async (r) => {
        await cacheSet('library', steamid, r);
        return r;
      })
      .finally(() => inflight.delete(steamid));
    inflight.set(steamid, p);
  }
  return p;
}

/** 이 계정의 라이브러리(친구 정보 포함) 캐시를 즉시 지운다 */
export async function deleteLibrary(steamid: string): Promise<void> {
  lastRefresh.delete(steamid);
  await cacheDelete('library', steamid);
}

/** 오래된 라이브러리 캐시 파일 정리 */
export function purgeLibraries(): Promise<number> {
  return cachePurge('library', LIBRARY_KEEP_MS);
}
