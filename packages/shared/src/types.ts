/**
 * 동기화 워커가 Steam API 응답을 정리해 만드는 라이브러리 데이터 형태.
 * 프로토타입에서는 샘플 데이터가 이 형태를 채운다.
 */

export type DeckCompat = 'verified' | 'playable' | 'unsupported' | 'unknown';

export interface GameRecord {
  appid: number;
  name: string;
  /** 스토어가 주는 회사 이름 그대로. 정규화는 그래프 빌더가 한다. */
  developers: string[];
  publishers: string[];
  franchise?: string;
  genres: string[];
  tags: string[];
  releaseYear: number;
  /** GetOwnedGames.playtime_forever (분) */
  playtimeMinutes: number;
  /** GetOwnedGames.playtime_2weeks (분) */
  playtime2WeeksMinutes: number;
  /** GetOwnedGames.rtime_last_played (ISO 날짜) */
  lastPlayed?: string;
  achievements?: { unlocked: number; total: number };
  deck: DeckCompat;
  /** 정가(원). 0 = 무료. 없으면 모름 */
  priceKrw?: number;
  /** 지금 할인 중일 때만 */
  sale?: { priceKrw: number; discountPercent: number };
}

export interface FriendRecord {
  steamid: string;
  name: string;
  /** GetFriendList.friend_since (ISO 날짜) */
  since: string;
  /** 친구가 보유한 게임 중 내 라이브러리와 겹치는 것 */
  owned: { appid: number; playtimeMinutes: number }[];
}

export interface PlayerRecord {
  steamid: string;
  name: string;
  /** GetPlayerSummaries.timecreated (ISO 날짜) */
  accountCreated: string;
  level: number;
}

export interface LibraryData {
  player: PlayerRecord;
  games: GameRecord[];
  friends: FriendRecord[];
  syncedAt: string;
}

/**
 * 상점 카탈로그 한 건. 키 없이 받는 공개 정보만 담는다.
 * - Store API(appdetails): 회사·장르·카테고리·출시일·가격·메타크리틱
 * - SteamSpy(비공식): 유저 태그
 */
export interface StoreApp {
  appid: number;
  /** false = 상점에서 내려갔거나 지역 제한 등으로 정보를 못 받음 */
  available: boolean;
  name: string;
  developers: string[];
  publishers: string[];
  genres: string[];
  categories: string[];
  /** 투표 수 순 유저 태그 (취향과 무관한 일반 태그는 뺌) */
  tags: string[];
  releaseYear?: number;
  isFree: boolean;
  /** 원 단위 (Store API의 1/100 단위를 환산) */
  price?: { currency: string; initial: number; final: number; discountPercent: number };
  metacritic?: number;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  sources: ('store' | 'steamspy')[];
  fetchedAt: string;
}

export interface CatalogStatus {
  total: number;
  ready: number;
  pending: number;
  failed: number;
}

export interface CatalogResponse {
  apps: StoreApp[];
  status: CatalogStatus;
}
