/**
 * 부하 테스트용 가상 라이브러리 (주소에 ?stress=50000).
 * 샘플 게임을 '원형'으로 삼아 태그 몇 개를 바꿔 끼운 가상의 게임을 원하는 수만큼 만든다.
 * 이름·회사는 단어를 조합해 지어내고, appid는 실제 Steam 게임과 겹치지 않는 영역(9억 대)을 쓴다.
 * 이미지는 그리지 않는다: 가상 appid라 받을 이미지도 없고, Steam CDN에 수만 건을 요청하면 안 된다 (STEAM_COMPLIANCE).
 */
import type { DeckCompat, FriendRecord, GameRecord, LibraryData } from '@steamverse/shared';
import { sampleLibrary } from './sampleLibrary';

export const STRESS_MIN = 100;
export const STRESS_MAX = 200_000;
const APPID_BASE = 900_000_000;

/** 주소의 ?stress=N 을 읽는다. 없거나 숫자가 아니면 0 (부하 테스트 아님) */
export function readStressCount(): number {
  try {
    const raw = new URLSearchParams(window.location.search).get('stress');
    if (raw === null) return 0;
    const n = Math.round(Number(raw || 50_000));
    return Number.isFinite(n) && n > 0 ? Math.min(STRESS_MAX, Math.max(STRESS_MIN, n)) : 0;
  } catch {
    return 0;
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EXTRA_TAGS = [
  'Atmospheric', 'Female Protagonist', 'Singleplayer', 'Third Person', 'Top-Down', 'Isometric', 'Anime', 'Retro', 'Minimalist', 'Physics',
  'Tower Defense', 'Rhythm', 'Visual Novel', 'Dating Sim', 'Racing', 'Sports', 'Fighting', 'Beat \'em up', 'Twin Stick Shooter', 'Shoot \'Em Up',
  'Point & Click', 'Hidden Object', 'Walking Simulator', 'Psychological Horror', 'Lovecraftian', 'Steampunk', 'Medieval', 'Mechs', 'Dragons', 'Pirates',
  'Underwater', 'Post-apocalyptic', 'Dystopian', 'Time Travel', 'Time Manipulation', 'Choices Matter', 'Multiple Endings', 'Narration', 'Great Soundtrack', 'Colorful',
  'Hand-drawn', 'Voxel', 'Low Poly', 'Cartoony', 'Realistic', 'Gore', 'Comedy', 'Family Friendly', 'Party Game', 'Local Co-Op',
  'Online Co-Op', 'PvE', 'MMO', 'Trading', 'Economy', 'Management', 'Tactical RPG', 'Real-Time Strategy', 'Wargame', 'Naval',
  'Flight', 'Space Sim', 'Trains', 'Fishing', 'Cooking', 'Idle', 'Clicker', 'Match 3', 'Word Game', 'Trivia',
];

const WORDS_A = [
  'Crimson', 'Hollow', 'Neon', 'Silent', 'Iron', 'Lost', 'Ancient', 'Broken', 'Frozen', 'Wild', 'Shattered', 'Eternal', 'Last', 'Dark', 'Golden',
  'Hidden', 'Sunken', 'Burning', 'Electric', 'Quiet', 'Starlit', 'Feral', 'Rusty', 'Pale', 'Velvet', 'Cosmic', 'Tiny', 'Endless', 'Forgotten', 'Savage',
];
const WORDS_B = [
  'Frontier', 'Abyss', 'Kingdom', 'Signal', 'Harbor', 'Echo', 'Dynasty', 'Orchard', 'Protocol', 'Spire', 'Legion', 'Drifter', 'Garden', 'Circuit', 'Oath',
  'Tides', 'Engine', 'Lantern', 'Colony', 'Requiem', 'Outpost', 'Skies', 'Crown', 'Hunter', 'Workshop', 'Voyage', 'Ruins', 'Bloom', 'Station', 'Saga',
];
const SUFFIX = ['', '', '', '', ' II', ' III', ': Remastered', ': Origins', ' Online', ' Tactics', ' Deluxe', ': Rebirth', ' Zero', ' Arena', ' Story'];
const STUDIO_A = ['Pixel', 'Moon', 'Red', 'Blue', 'North', 'Paper', 'Quantum', 'Little', 'Brave', 'Copper', 'Glass', 'Lucky', 'Bright', 'Night', 'Owl'];
const STUDIO_B = ['Forge', 'Works', 'Studio', 'Games', 'Interactive', 'Labs', 'Bits', 'House', 'Collective', 'Foundry'];

/** 작은 회사가 대부분이고 몇몇 큰 회사가 많은 게임을 내는 모양 (멱법칙) */
function zipf(r: () => number, n: number, s = 1.15): number {
  return Math.min(n - 1, Math.floor(Math.pow(r(), s * 2.2) * n));
}

const DECKS: DeckCompat[] = ['verified', 'verified', 'playable', 'playable', 'unsupported', 'unknown'];

export function makeStressLibrary(count: number): LibraryData {
  const r = rng(20261125);
  const base = sampleLibrary.games;
  const tagPool = [...new Set([...base.flatMap((g) => g.tags), ...EXTRA_TAGS])];
  const studios = Math.max(20, Math.round(count / 8));
  const publishers = Math.max(10, Math.round(count / 30));
  const studioName = (i: number) => `${STUDIO_A[i % STUDIO_A.length]} ${STUDIO_B[Math.floor(i / STUDIO_A.length) % STUDIO_B.length]}${i >= STUDIO_A.length * STUDIO_B.length ? ` ${Math.floor(i / (STUDIO_A.length * STUDIO_B.length)) + 1}` : ''}`;
  const usedNames = new Map<string, number>();

  const games: GameRecord[] = Array.from({ length: count }, (_, i) => {
    const proto = base[Math.floor(r() * base.length)]!;
    // 원형의 태그 2~3개는 남기고, 나머지는 풀에서 바꿔 끼운다 → 원형별로 느슨한 무리가 생긴다
    const keep = [...proto.tags].sort(() => r() - 0.5).slice(0, 2 + Math.floor(r() * 2));
    const tags = new Set(keep);
    const extra = 1 + Math.floor(r() * 3);
    while (tags.size < keep.length + extra) tags.add(tagPool[Math.floor(r() * tagPool.length)]!);

    let name = `${WORDS_A[Math.floor(r() * WORDS_A.length)]} ${WORDS_B[Math.floor(r() * WORDS_B.length)]}${SUFFIX[Math.floor(r() * SUFFIX.length)]}`;
    const seen = usedNames.get(name) ?? 0;
    usedNames.set(name, seen + 1);
    if (seen) name = `${name} #${seen + 1}`;

    // 플레이 시간: 절반 가까이는 안 켰고, 나머지는 긴 꼬리
    const p = r();
    const hours = p < 0.42 ? 0 : p < 0.62 ? r() * 2 : Math.exp(r() * 6.2) * 0.8;
    const recent = r() < 0.02 ? r() * 20 : 0;
    const dev = studioName(zipf(r, studios));
    const pub = r() < 0.45 ? dev : `${studioName(studios + zipf(r, publishers))} Publishing`;
    const total = r() < 0.75 ? 10 + Math.floor(r() * 90) : 0;
    const year = 2003 + Math.floor(Math.pow(r(), 0.6) * 24);

    return {
      appid: APPID_BASE + i,
      name,
      developers: [dev],
      publishers: [pub],
      genres: proto.genres,
      tags: [...tags],
      releaseYear: Math.min(2026, year),
      playtimeMinutes: Math.round(hours * 60),
      playtime2WeeksMinutes: Math.round(recent * 60),
      achievements: total ? { unlocked: hours ? Math.floor(total * Math.min(1, hours / 80) * r()) : 0, total } : undefined,
      deck: DECKS[Math.floor(r() * DECKS.length)],
    };
  });

  const friends: FriendRecord[] = Array.from({ length: 12 }, (_, i) => ({
    steamid: `stress-friend-${i + 1}`,
    name: `친구 ${String.fromCharCode(65 + i)}`,
    since: `${2012 + (i % 12)}-0${1 + (i % 9)}-15`,
    owned: Array.from({ length: Math.min(count, 400) }, () => ({
      appid: APPID_BASE + Math.floor(r() * count),
      playtimeMinutes: Math.round(r() * 200 * 60),
    })).filter((o, j, arr) => arr.findIndex((x) => x.appid === o.appid) === j),
  }));

  return {
    player: { steamid: 'stress', name: `부하 테스트 ${count.toLocaleString('ko-KR')}`, accountCreated: '2010-01-01', level: 0 },
    games,
    friends,
    syncedAt: sampleLibrary.syncedAt,
  };
}
