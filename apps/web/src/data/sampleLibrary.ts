/**
 * 프로토타입용 샘플 라이브러리.
 * 게임 정보(appid·개발사·장르·태그)는 실제 스토어 정보에 가깝게 적었고,
 * 플레이 시간·업적·친구는 가상의 값이다.
 * 회사 이름은 일부러 표기를 섞어 두었다 (예: "Valve" / "Valve Corporation") — 정규화 확인용.
 */
import type { AchievementUnlock, DeckCompat, FriendRecord, GameRecord, LibraryData } from '@steamverse/shared';

type Row = [
  appid: number,
  name: string,
  developers: string,
  publishers: string,
  franchise: string | null,
  genres: string,
  tags: string,
  year: number,
  hours: number,
  hours2w: number,
  achievements: [number, number] | null,
  deck: 'v' | 'p' | 'u' | '?',
];

const ROWS: Row[] = [
  [730, 'Counter-Strike 2', 'Valve', 'Valve', 'Counter-Strike', 'Action;Free to Play', 'FPS;Competitive;Tactical;Multiplayer', 2012, 1240, 6, null, 'p'],
  [570, 'Dota 2', 'Valve', 'Valve', null, 'Action;Strategy;Free to Play', 'MOBA;Competitive;Multiplayer;Strategy', 2013, 860, 0, null, 'p'],
  [440, 'Team Fortress 2', 'Valve', 'Valve', null, 'Action;Free to Play', 'Hero Shooter;FPS;Multiplayer;Funny', 2007, 310, 0, [312, 520], 'p'],
  [620, 'Portal 2', 'Valve', 'Valve', 'Portal', 'Action;Adventure', 'Puzzle;Co-op;First-Person;Story Rich', 2011, 34, 0, [51, 51], 'v'],
  [400, 'Portal', 'Valve Corporation', 'Valve', 'Portal', 'Action', 'Puzzle;First-Person;Classic', 2007, 6, 0, [15, 15], 'v'],
  [220, 'Half-Life 2', 'Valve', 'Valve', 'Half-Life', 'Action', 'FPS;Story Rich;Classic;Sci-fi', 2004, 22, 0, [25, 33], 'v'],
  [546560, 'Half-Life: Alyx', 'Valve', 'Valve', 'Half-Life', 'Action;Adventure', 'VR;FPS;Story Rich;Sci-fi', 2020, 0, 0, [0, 25], 'u'],
  [550, 'Left 4 Dead 2', 'Valve', 'Valve', 'Left 4 Dead', 'Action', 'Zombies;Co-op;FPS;Horror', 2009, 140, 0, [70, 101], 'v'],
  [4000, "Garry's Mod", 'Facepunch Studios', 'Valve', null, 'Indie;Simulation', 'Sandbox;Multiplayer;Funny;Physics', 2006, 95, 0, [12, 29], 'p'],
  [252490, 'Rust', 'Facepunch Studios', 'Facepunch Studios', null, 'Action;Adventure;Indie;Massively Multiplayer', 'Survival;Crafting;Open World;PvP;Multiplayer', 2018, 210, 4, [40, 92], 'u'],
  [292030, 'The Witcher 3: Wild Hunt', 'CD PROJEKT RED', 'CD PROJEKT RED', 'The Witcher', 'RPG', 'Open World;Story Rich;Fantasy;Action RPG', 2015, 185, 0, [62, 78], 'v'],
  [1091500, 'Cyberpunk 2077', 'CD PROJEKT RED', 'CD PROJEKT RED', null, 'RPG', 'Open World;Cyberpunk;Sci-fi;Action RPG;Story Rich', 2020, 96, 0, [33, 57], 'v'],
  [1245620, 'ELDEN RING', 'FromSoftware, Inc.', 'Bandai Namco Entertainment', null, 'Action;RPG', 'Souls-like;Open World;Difficult;Dark Fantasy', 2022, 248, 3, [42, 42], 'v'],
  [374320, 'DARK SOULS III', 'FromSoftware, Inc.', 'Bandai Namco Entertainment', 'Dark Souls', 'Action;RPG', 'Souls-like;Difficult;Dark Fantasy', 2016, 120, 0, [39, 43], 'v'],
  [570940, 'DARK SOULS: REMASTERED', 'FromSoftware', 'BANDAI NAMCO Entertainment', 'Dark Souls', 'Action;RPG', 'Souls-like;Difficult;Dark Fantasy;Classic', 2018, 18, 0, [12, 41], 'v'],
  [814380, 'Sekiro: Shadows Die Twice', 'FromSoftware', 'Activision', null, 'Action;Adventure', 'Souls-like;Difficult;Ninja;Stealth', 2019, 64, 0, [30, 34], 'v'],
  [1145360, 'Hades', 'Supergiant Games', 'Supergiant Games', 'Hades', 'Action;Indie;RPG', 'Roguelike;Action Roguelike;Mythology;Hack and Slash', 2020, 92, 0, [45, 49], 'v'],
  [1145350, 'Hades II', 'Supergiant Games', 'Supergiant Games', 'Hades', 'Action;Indie;RPG', 'Roguelike;Action Roguelike;Mythology', 2025, 38, 7, [21, 49], 'v'],
  [413150, 'Stardew Valley', 'ConcernedApe', 'ConcernedApe', null, 'Indie;RPG;Simulation', 'Farming Sim;Pixel Graphics;Cozy;Co-op', 2016, 156, 0, [31, 40], 'v'],
  [367520, 'Hollow Knight', 'Team Cherry', 'Team Cherry', 'Hollow Knight', 'Action;Adventure;Indie', 'Metroidvania;Difficult;2D;Atmospheric', 2017, 58, 0, [47, 63], 'v'],
  [504230, 'Celeste', 'Maddy Makes Games', 'Maddy Makes Games', null, 'Action;Adventure;Indie', 'Platformer;Difficult;Pixel Graphics;Story Rich', 2018, 21, 0, [25, 32], 'v'],
  [646570, 'Slay the Spire', 'Mega Crit', 'Humble Games', null, 'Indie;Strategy', 'Deckbuilding;Roguelike;Card Game;Turn-Based', 2019, 203, 0, [46, 46], 'v'],
  [588650, 'Dead Cells', 'Motion Twin', 'Motion Twin', null, 'Action;Indie', 'Roguelike;Metroidvania;Action Roguelike;Pixel Graphics', 2018, 47, 0, [28, 54], 'v'],
  [105600, 'Terraria', 'Re-Logic', 'Re-Logic', null, 'Action;Adventure;Indie;RPG', 'Sandbox;Survival;2D;Crafting;Co-op', 2011, 175, 0, [64, 115], 'v'],
  [1794680, 'Vampire Survivors', 'poncle', 'poncle', null, 'Action;Casual;Indie;RPG', 'Roguelike;Bullet Hell;Pixel Graphics', 2022, 41, 0, [180, 242], 'v'],
  [2379780, 'Balatro', 'LocalThunk', 'Playstack', null, 'Casual;Indie;Strategy', 'Deckbuilding;Roguelike;Card Game;Poker', 2024, 77, 5, [24, 30], 'v'],
  [553420, 'TUNIC', 'Andrew Shouldice', 'Finji', null, 'Action;Adventure;Indie', 'Souls-like;Exploration;Puzzle;Cute', 2022, 0, 0, [0, 41], 'v'],
  [753640, 'Outer Wilds', 'Mobius Digital', 'Annapurna Interactive', null, 'Action;Adventure', 'Exploration;Space;Mystery;Story Rich', 2020, 24, 0, [11, 12], 'v'],
  [1086940, "Baldur's Gate 3", 'Larian Studios', 'Larian Studios', "Baldur's Gate", 'Adventure;RPG;Strategy', 'CRPG;Turn-Based;Story Rich;Fantasy;Co-op', 2023, 212, 0, [38, 54], 'v'],
  [435150, 'Divinity: Original Sin 2', 'Larian Studios', 'Larian Studios', 'Divinity', 'Adventure;RPG;Strategy', 'CRPG;Turn-Based;Co-op;Fantasy', 2017, 1.5, 0, [1, 59], 'v'],
  [489830, 'The Elder Scrolls V: Skyrim Special Edition', 'Bethesda Game Studios', 'Bethesda Softworks', 'The Elder Scrolls', 'RPG', 'Open World;Fantasy;Moddable;Action RPG', 2016, 160, 0, [52, 75], 'v'],
  [377160, 'Fallout 4', 'Bethesda Game Studios', 'Bethesda Softworks', 'Fallout', 'RPG', 'Open World;Post-apocalyptic;Action RPG;Moddable', 2015, 88, 0, [29, 50], 'p'],
  [1716740, 'Starfield', 'Bethesda Game Studios', 'Bethesda Softworks', null, 'RPG', 'Open World;Space;Sci-fi;Action RPG', 2023, 1.2, 0, [1, 50], 'u'],
  [271590, 'Grand Theft Auto V', 'Rockstar North', 'Rockstar Games', 'Grand Theft Auto', 'Action;Adventure', 'Open World;Crime;Multiplayer;Driving', 2015, 130, 0, [44, 77], 'u'],
  [1174180, 'Red Dead Redemption 2', 'Rockstar Games', 'Rockstar Games', 'Red Dead', 'Action;Adventure', 'Open World;Western;Story Rich', 2019, 74, 0, [21, 51], 'p'],
  [578080, 'PUBG: BATTLEGROUNDS', 'PUBG Corporation', 'KRAFTON, Inc.', null, 'Action;Adventure;Free to Play;Massively Multiplayer', 'Battle Royale;FPS;Shooter;Multiplayer', 2017, 420, 0, [22, 37], 'u'],
  [1172470, 'Apex Legends', 'Respawn', 'Electronic Arts', null, 'Action;Adventure;Free to Play', 'Battle Royale;Hero Shooter;FPS;Multiplayer', 2020, 66, 0, [5, 12], 'u'],
  [1426210, 'It Takes Two', 'Hazelight', 'Electronic Arts', null, 'Action;Adventure', 'Co-op;Split Screen;Platformer;Story Rich', 2021, 14, 0, [8, 20], 'p'],
  [892970, 'Valheim', 'Iron Gate AB', 'Coffee Stain Publishing', null, 'Action;Adventure;Indie;RPG;Early Access', 'Survival;Open World;Co-op;Crafting;Viking', 2021, 112, 0, [9, 13], 'v'],
  [526870, 'Satisfactory', 'Coffee Stain Studios', 'Coffee Stain Publishing', null, 'Adventure;Indie;Simulation', 'Automation;Base Building;Open World;Co-op', 2024, 145, 9, [19, 43], 'p'],
  [548430, 'Deep Rock Galactic', 'Ghost Ship Games', 'Coffee Stain Publishing', null, 'Action', 'Co-op;FPS;Mining;Procedural Generation', 2020, 95, 0, [61, 107], 'v'],
  [289070, "Sid Meier's Civilization VI", 'Firaxis Games', '2K', 'Civilization', 'Strategy', 'Turn-Based Strategy;4X;Historical', 2016, 280, 0, [140, 320], 'p'],
  [8930, "Sid Meier's Civilization V", 'Firaxis Games', '2K', 'Civilization', 'Strategy', 'Turn-Based Strategy;4X;Historical;Classic', 2010, 190, 0, [120, 286], '?'],
  [294100, 'RimWorld', 'Ludeon Studios', 'Ludeon Studios', null, 'Indie;Simulation;Strategy', 'Colony Sim;Base Building;Survival;Sandbox', 2018, 330, 0, null, 'v'],
  [1158310, 'Crusader Kings III', 'Paradox Development Studio', 'Paradox Interactive', 'Crusader Kings', 'RPG;Simulation;Strategy', 'Grand Strategy;Medieval;Historical', 2020, 85, 0, [18, 133], 'p'],
  [281990, 'Stellaris', 'Paradox Development Studio', 'Paradox Interactive', null, 'Simulation;Strategy', 'Grand Strategy;4X;Space;Sci-fi', 2016, 140, 0, [35, 160], 'p'],
  [255710, 'Cities: Skylines', 'Colossal Order Ltd.', 'Paradox Interactive', 'Cities: Skylines', 'Simulation;Strategy', 'City Builder;Building;Sandbox', 2015, 60, 0, [41, 107], 'p'],
  [427520, 'Factorio', 'Wube Software LTD.', 'Wube Software LTD.', null, 'Casual;Indie;Simulation;Strategy', 'Automation;Base Building;Crafting;Sandbox', 2020, 410, 12, [33, 37], 'v'],
  [1593500, 'God of War', 'Santa Monica Studio', 'PlayStation Publishing LLC', 'God of War', 'Action;Adventure', 'Story Rich;Hack and Slash;Mythology', 2022, 32, 0, [27, 37], 'v'],
  [1817070, "Marvel's Spider-Man Remastered", 'Insomniac Games', 'PlayStation Publishing LLC', null, 'Action;Adventure', 'Open World;Superhero;Story Rich', 2022, 0, 0, [0, 51], 'v'],
  [2215430, "Ghost of Tsushima DIRECTOR'S CUT", 'Sucker Punch Productions', 'PlayStation Publishing LLC', null, 'Action;Adventure', 'Open World;Samurai;Stealth;Story Rich', 2024, 0.8, 0, [1, 77], 'v'],
  [2050650, 'Resident Evil 4', 'CAPCOM Co., Ltd.', 'CAPCOM Co., Ltd.', 'Resident Evil', 'Action;Adventure', 'Survival Horror;Horror;Third-Person Shooter', 2023, 28, 0, [24, 40], 'v'],
  [883710, 'Resident Evil 2', 'CAPCOM Co., Ltd.', 'CAPCOM Co., Ltd.', 'Resident Evil', 'Action;Adventure', 'Survival Horror;Horror;Zombies', 2019, 19, 0, [20, 46], 'v'],
  [582010, 'Monster Hunter: World', 'CAPCOM Co., Ltd.', 'CAPCOM Co., Ltd.', 'Monster Hunter', 'Action', 'Co-op;Action RPG;Hunting;Multiplayer', 2018, 320, 0, [70, 82], 'p'],
  [2246340, 'Monster Hunter Wilds', 'CAPCOM', 'CAPCOM', 'Monster Hunter', 'Action;Adventure;RPG', 'Co-op;Action RPG;Hunting;Open World', 2025, 58, 0, [31, 50], 'u'],
  [1627720, 'Lies of P', 'ROUND8 Studio', 'NEOWIZ', null, 'Action;Adventure;RPG', 'Souls-like;Difficult;Dark Fantasy;Story Rich', 2023, 46, 0, [28, 44], 'v'],
  [1868140, 'DAVE THE DIVER', 'MINTROCKET', 'MINTROCKET', null, 'Adventure;Casual;Indie;RPG;Simulation', 'Pixel Graphics;Management;Cozy;Exploration', 2023, 35, 0, [30, 43], 'v'],
  [1599340, 'Lost Ark', 'Smilegate RPG', 'Amazon Games', null, 'Action;Adventure;Free to Play;Massively Multiplayer;RPG', 'MMORPG;Action RPG;Fantasy', 2022, 260, 0, [64, 200], 'u'],
  [2358720, 'Black Myth: Wukong', 'Game Science', 'Game Science', null, 'Action;Adventure;RPG', 'Souls-like;Mythology;Action RPG', 2024, 52, 0, [40, 81], 'p'],
  [1687950, 'Persona 5 Royal', 'ATLUS', 'SEGA', 'Persona', 'RPG', 'JRPG;Turn-Based;Story Rich;Anime', 2022, 110, 0, [38, 54], 'v'],
  [2161700, 'Persona 3 Reload', 'ATLUS', 'SEGA', 'Persona', 'RPG', 'JRPG;Turn-Based;Anime;Story Rich', 2024, 0, 0, [0, 50], 'v'],
  [268910, 'Cuphead', 'Studio MDHR Entertainment Inc.', 'Studio MDHR Entertainment Inc.', null, 'Action;Indie', 'Difficult;Platformer;Bullet Hell;Hand-drawn', 2017, 18, 0, [15, 28], 'v'],
  [945360, 'Among Us', 'Innersloth', 'Innersloth', null, 'Casual', 'Multiplayer;Social Deduction;Party', 2018, 26, 0, [9, 31], 'v'],
  [1966720, 'Lethal Company', 'Zeekerss', 'Zeekerss', null, 'Action;Adventure;Indie;Early Access', 'Horror;Co-op;Funny;Multiplayer', 2023, 48, 0, null, 'v'],
  [2767030, 'Marvel Rivals', 'NetEase Games', 'NetEase Games', null, 'Action;Free to Play', 'Hero Shooter;Third-Person Shooter;Superhero;Multiplayer', 2024, 140, 15, [24, 56], 'u'],
  [238960, 'Path of Exile', 'Grinding Gear Games', 'Grinding Gear Games', 'Path of Exile', 'Action;Adventure;Free to Play;Massively Multiplayer;RPG', 'Action RPG;Hack and Slash;Loot', 2013, 380, 0, [70, 102], 'p'],
  [2694490, 'Path of Exile 2', 'Grinding Gear Games', 'Grinding Gear Games', 'Path of Exile', 'Action;Adventure;RPG', 'Action RPG;Hack and Slash;Loot', 2024, 96, 0, [25, 42], 'p'],
  [1659040, 'HITMAN World of Assassination', 'IO Interactive A/S', 'IO Interactive A/S', 'Hitman', 'Action;Adventure', 'Stealth;Assassin;Sandbox', 2023, 0.4, 0, [0, 200], 'p'],
  [990080, 'Hogwarts Legacy', 'Avalanche Software', 'Warner Bros. Games', 'Wizarding World', 'Action;Adventure;RPG', 'Open World;Magic;Fantasy', 2023, 0, 0, [0, 46], 'v'],
  [1326470, 'Sons Of The Forest', 'Endnight Games Ltd', 'Newnight', 'The Forest', 'Action;Adventure;Indie;Simulation', 'Survival;Horror;Co-op;Open World;Crafting', 2024, 33, 0, [12, 34], 'p'],
  [242760, 'The Forest', 'Endnight Games Ltd', 'Endnight Games Ltd', 'The Forest', 'Action;Adventure;Indie;Simulation', 'Survival;Horror;Co-op;Crafting', 2018, 41, 0, [20, 46], 'p'],
  [1290000, 'PowerWash Simulator', 'FuturLab', 'Square Enix', null, 'Casual;Indie;Simulation', 'Relaxing;Cleaning;Co-op', 2022, 0, 0, [0, 32], 'v'],
  [975370, 'Dwarf Fortress', 'Bay 12 Games', 'Kitfox Games', null, 'Simulation;Strategy', 'Colony Sim;Base Building;Sandbox;Pixel Graphics', 2022, 0, 0, null, 'p'],
  [1172620, 'Sea of Thieves', 'Rare Ltd', 'Xbox Game Studios', null, 'Action;Adventure', 'Pirates;Co-op;Open World;Multiplayer', 2020, 55, 0, [40, 220], 'u'],
  [1551360, 'Forza Horizon 5', 'Playground Games', 'Xbox Game Studios', 'Forza', 'Action;Adventure;Racing;Simulation;Sports', 'Racing;Open World;Driving', 2021, 70, 0, [61, 175], 'v'],
];

const DECK: Record<Row[11], DeckCompat> = { v: 'verified', p: 'playable', u: 'unsupported', '?': 'unknown' };
const SYNCED_AT = new Date('2026-11-17T09:00:00+09:00');

/** appid 기반의 결정적 의사난수 (0~1) */
function pseudo(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function lastPlayedFor(appid: number, hours: number, hours2w: number): string | undefined {
  if (hours <= 0) return undefined;
  const daysAgo = hours2w > 0 ? Math.floor(pseudo(appid) * 10) : 20 + Math.floor(pseudo(appid) * 1100);
  const d = new Date(SYNCED_AT.getTime() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** 시드 난수 (같은 appid면 늘 같은 값) */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_ACH_NAMES = ['첫걸음', '숙련자', '수집가', '탐험가', '불굴', '완벽주의자', '전설', '마라톤', '숨은 길', '한 번의 실수도 없이', '끝까지', '야행성'];

/**
 * 샘플 업적 기록 (가상): 출시 이후 ~ 마지막 플레이 사이에 해금 시각을 흩뿌리고,
 * 전 세계 달성률도 지어낸다 (대부분 흔하고, 몇 개만 희귀하게).
 */
function sampleLog(appid: number, year: number, unlocked: number, lastPlayed?: string): AchievementUnlock[] {
  if (unlocked <= 0) return [];
  const r = rng(appid);
  const start = Math.max(Date.UTC(year, 0, 1), Date.UTC(2014, 0, 1));
  const end = lastPlayed ? Date.parse(lastPlayed) : SYNCED_AT.getTime();
  if (end <= start) return [];
  // 몰아서 하는 시기 2~3번에 해금이 뭉치게
  const bursts = Array.from({ length: 2 + Math.floor(r() * 2) }, () => start + r() * (end - start));
  return Array.from({ length: unlocked }, (_, i) => {
    const center = bursts[i % bursts.length]!;
    const t = Math.min(end, Math.max(start, center + (r() - 0.5) * 40 * 86_400_000));
    // 대부분 흔하고, 1% 이하는 30개 중 1개꼴. 1% 아래는 소수 둘째 자리까지
    const raw = 0.05 + 99.95 * r() ** 1.35;
    const pct = raw < 1 ? Math.round(raw * 100) / 100 : Math.round(raw * 10) / 10;
    return { api: `SAMPLE_${i}`, name: `${SAMPLE_ACH_NAMES[i % SAMPLE_ACH_NAMES.length]} ${Math.floor(i / SAMPLE_ACH_NAMES.length) + 1}`, t: Math.floor(t / 1000), samplePct: pct };
  });
}

const games: GameRecord[] = ROWS.map(([appid, name, dev, pub, franchise, genres, tags, year, hours, hours2w, ach, deck]) => ({
  appid,
  name,
  developers: dev.split(';'),
  publishers: pub.split(';'),
  franchise: franchise ?? undefined,
  genres: genres.split(';'),
  tags: tags.split(';'),
  releaseYear: year,
  playtimeMinutes: Math.round(hours * 60),
  playtime2WeeksMinutes: Math.round(hours2w * 60),
  lastPlayed: lastPlayedFor(appid, hours, hours2w),
  achievements: ach ? { unlocked: ach[0], total: ach[1] } : undefined,
  achievementLog: ach ? sampleLog(appid, year, ach[0], lastPlayedFor(appid, hours, hours2w)) : undefined,
  deck: DECK[deck],
}));

const friend = (steamid: string, name: string, since: string, owned: [number, number][]): FriendRecord => ({
  steamid,
  name,
  since,
  owned: owned.map(([appid, h]) => ({ appid, playtimeMinutes: h * 60 })),
});

const friends: FriendRecord[] = [
  friend('76561190000000101', 'Nova', '2014-03-02', [[730, 2100], [570, 300], [440, 200], [578080, 900], [1172470, 400], [2767030, 220], [271590, 150]]),
  friend('76561190000000102', '곰돌이', '2016-08-19', [[413150, 300], [105600, 200], [1868140, 60], [945360, 80], [1966720, 70], [892970, 150], [526870, 90], [1290000, 30]]),
  friend('76561190000000103', 'Kestrel', '2018-01-07', [[1245620, 400], [374320, 220], [814380, 110], [1627720, 90], [2358720, 80], [367520, 120], [268910, 40]]),
  friend('76561190000000104', 'minjun_k', '2019-11-23', [[1599340, 1200], [238960, 600], [2694490, 300], [582010, 500], [2246340, 160], [1086940, 180]]),
  friend('76561190000000105', 'SoloLeveler', '2021-05-30', [[427520, 900], [294100, 600], [526870, 400], [281990, 300], [289070, 450], [975370, 120], [1158310, 200]]),
  friend('76561190000000106', 'pixelcat', '2023-02-14', [[1145360, 150], [1145350, 60], [646570, 300], [2379780, 200], [1794680, 90], [588650, 70], [504230, 40], [553420, 20]]),
];

export const sampleLibrary: LibraryData = {
  player: {
    steamid: '76561190000000001',
    name: '나 (샘플)',
    accountCreated: '2011-06-15',
    level: 87,
  },
  games,
  friends,
  syncedAt: SYNCED_AT.toISOString(),
};
