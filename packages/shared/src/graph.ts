/**
 * 라이브러리 데이터 → 온톨로지 그래프(ABox) 변환.
 *
 * 1) 원본 관계: owns, developedBy, publishedBy, partOfFranchise, hasGenre, hasTag, friendOf
 * 2) 추론 관계: similarTo(태그 코사인 유사도), favoriteDeveloper(플레이 시간 상위 개발사)
 * 3) 파생 분류: 게임별 플레이 상태, 취향 군집(Louvain 커뮤니티 탐지)
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { classifyPlaytime, type ClassId, type PlayStatus, type RelationId } from './ontology';
import type { DeckCompat, LibraryData } from './types';

export interface GameInfo {
  appid: number;
  status: PlayStatus;
  hours2w: number;
  releaseYear: number;
  lastPlayed?: string;
  achievements?: { unlocked: number; total: number };
  deck: DeckCompat;
  genres: string[];
  tags: string[];
  priceKrw?: number;
  sale?: { priceKrw: number; discountPercent: number };
}

export interface OrgInfo {
  /** 정규화 전 원래 이름들 (병합 근거) */
  aliases: string[];
  developed: number;
  published: number;
}

export interface PlayerInfo {
  steamid: string;
  isMe: boolean;
  since?: string;
  sharedGames: number;
}

export interface OntNode {
  id: string;
  cls: ClassId;
  label: string;
  /** 관련 플레이 시간 합 (시간) — 노드 크기 기준 */
  hours: number;
  /** 연결된 (내) 게임 수 */
  gameCount: number;
  game?: GameInfo;
  org?: OrgInfo;
  player?: PlayerInfo;
  /** 게임 노드의 취향 군집 id */
  cluster?: number;
}

export interface OntEdge {
  id: string;
  source: string;
  target: string;
  rel: RelationId;
  /** owns: 플레이 시간(시간), similarTo: 유사도 */
  weight?: number;
}

export interface TasteCluster {
  id: number;
  name: string;
  topTags: string[];
  gameIds: string[];
  hours: number;
}

export interface LibraryStats {
  totalGames: number;
  totalHours: number;
  recentHours: number;
  byStatus: Record<PlayStatus, number>;
  organizations: number;
  mergedOrganizations: number;
  friends: number;
}

export interface OntologyGraph {
  meId: string;
  nodes: OntNode[];
  edges: OntEdge[];
  nodeById: Map<string, OntNode>;
  /** 노드 id → 연결된 엣지 (방향 무관) */
  adjacency: Map<string, OntEdge[]>;
  clusters: TasteCluster[];
  stats: LibraryStats;
}

// ─── 엔티티 정규화 ──────────────────────────────────────────────

const LEGAL_SUFFIXES = new Set([
  'inc', 'ltd', 'llc', 'co', 'corp', 'corporation', 'gmbh', 'ab', 'as', 'sa', 'srl', 'limited', 'kk',
]);

/** "CAPCOM Co., Ltd." → "capcom", "Valve Corporation" → "valve" */
export function normalizeOrgName(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/\ba\/s\b/g, ' ')
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(' ');
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export type SteamImageKind = 'header' | 'capsule' | 'library' | 'hero';

export function steamImage(appid: number, kind: SteamImageKind = 'header'): string {
  const file = {
    header: 'header.jpg',
    capsule: 'capsule_231x87.jpg',
    library: 'library_600x900.jpg',
    hero: 'library_hero.jpg',
  }[kind];
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/${file}`;
}

// ─── 유사도 ─────────────────────────────────────────────────────

/** 장르는 너무 넓은 범주라 태그보다 가중치를 낮게 둔다. */
const GENRE_WEIGHT = 0.35;
const SIMILAR_THRESHOLD = 0.5;
const SIMILAR_TOP_K = 3;
const CLUSTER_EDGE_THRESHOLD = 0.3;

type Vector = Map<string, number>;

function featureVector(tags: string[], genres: string[]): Vector {
  const v: Vector = new Map();
  for (const t of tags) v.set(`t:${t}`, 1);
  for (const g of genres) v.set(`g:${g}`, GENRE_WEIGHT);
  return v;
}

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y !== undefined) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** 결정적 결과를 위한 시드 난수 (Louvain용) */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 빌더 ───────────────────────────────────────────────────────

export function buildOntologyGraph(lib: LibraryData): OntologyGraph {
  const nodeById = new Map<string, OntNode>();
  const edges: OntEdge[] = [];
  const edgeIds = new Set<string>();

  const addNode = (node: OntNode): OntNode => {
    const existing = nodeById.get(node.id);
    if (existing) return existing;
    nodeById.set(node.id, node);
    return node;
  };
  const addEdge = (source: string, target: string, rel: RelationId, weight?: number) => {
    const id = `${rel}:${source}->${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, source, target, rel, weight });
  };
  const touch = (node: OntNode, hours: number) => {
    node.hours += hours;
    node.gameCount += 1;
  };

  // 플레이어(나)
  const meId = `player:${lib.player.steamid}`;
  addNode({
    id: meId,
    cls: 'Player',
    label: lib.player.name,
    hours: 0,
    gameCount: 0,
    player: { steamid: lib.player.steamid, isMe: true, sharedGames: lib.games.length },
  });

  // 회사 정규화: 정규화 키 → 원래 이름 빈도
  const orgVariants = new Map<string, Map<string, number>>();
  for (const g of lib.games) {
    for (const name of [...g.developers, ...g.publishers]) {
      const key = normalizeOrgName(name);
      const variants = orgVariants.get(key) ?? new Map<string, number>();
      variants.set(name, (variants.get(name) ?? 0) + 1);
      orgVariants.set(key, variants);
    }
  }
  const orgNode = (rawName: string): OntNode => {
    const key = normalizeOrgName(rawName);
    const id = `org:${slug(key)}`;
    const existing = nodeById.get(id);
    if (existing) return existing;
    // 표시 이름은 가장 짧은 표기(법인 접미사가 없는 쪽), 같으면 더 자주 쓰인 표기
    const variants = [...(orgVariants.get(key) ?? new Map([[rawName, 1]]))].sort(
      (a, b) => a[0].length - b[0].length || b[1] - a[1],
    );
    return addNode({
      id,
      cls: 'Organization',
      label: variants[0]![0],
      hours: 0,
      gameCount: 0,
      org: { aliases: variants.map(([n]) => n), developed: 0, published: 0 },
    });
  };

  // 게임과 원본 관계
  const vectors = new Map<string, Vector>();
  const devHours = new Map<string, number>();
  for (const g of lib.games) {
    const hours = g.playtimeMinutes / 60;
    const gameId = `game:${g.appid}`;
    const game = addNode({
      id: gameId,
      cls: 'Game',
      label: g.name,
      hours,
      gameCount: 1,
      game: {
        appid: g.appid,
        status: classifyPlaytime(g.playtimeMinutes),
        hours2w: g.playtime2WeeksMinutes / 60,
        releaseYear: g.releaseYear,
        lastPlayed: g.lastPlayed,
        achievements: g.achievements,
        deck: g.deck,
        genres: g.genres,
        tags: g.tags,
        priceKrw: g.priceKrw,
        sale: g.sale,
      },
    });
    addEdge(meId, game.id, 'owns', hours);
    vectors.set(gameId, featureVector(g.tags, g.genres));

    for (const name of g.developers) {
      const org = orgNode(name);
      org.org!.developed += 1;
      touch(org, hours);
      devHours.set(org.id, (devHours.get(org.id) ?? 0) + hours);
      addEdge(gameId, org.id, 'developedBy');
    }
    for (const name of g.publishers) {
      const org = orgNode(name);
      org.org!.published += 1;
      // 같은 회사가 개발+배급이면 시간·게임 수를 두 번 세지 않는다
      if (!g.developers.some((d) => normalizeOrgName(d) === normalizeOrgName(name))) touch(org, hours);
      addEdge(gameId, org.id, 'publishedBy');
    }
    if (g.franchise) {
      const f = addNode({ id: `franchise:${slug(g.franchise)}`, cls: 'Franchise', label: g.franchise, hours: 0, gameCount: 0 });
      touch(f, hours);
      addEdge(gameId, f.id, 'partOfFranchise');
    }
    for (const genre of g.genres) {
      const n = addNode({ id: `genre:${slug(genre)}`, cls: 'Genre', label: genre, hours: 0, gameCount: 0 });
      touch(n, hours);
      addEdge(gameId, n.id, 'hasGenre');
    }
    for (const tag of g.tags) {
      const n = addNode({ id: `tag:${slug(tag)}`, cls: 'Tag', label: tag, hours: 0, gameCount: 0 });
      touch(n, hours);
      addEdge(gameId, n.id, 'hasTag');
    }
  }

  // 친구
  for (const f of lib.friends) {
    const friendId = `player:${f.steamid}`;
    const friend = addNode({
      id: friendId,
      cls: 'Player',
      label: f.name,
      hours: 0,
      gameCount: 0,
      player: { steamid: f.steamid, isMe: false, since: f.since, sharedGames: f.owned.length },
    });
    addEdge(meId, friendId, 'friendOf');
    for (const o of f.owned) {
      const gameId = `game:${o.appid}`;
      if (!nodeById.has(gameId)) continue;
      touch(friend, o.playtimeMinutes / 60);
      addEdge(friendId, gameId, 'owns', o.playtimeMinutes / 60);
    }
  }

  // 추론: similarTo
  const gameIds = [...vectors.keys()];
  const pairScores: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < gameIds.length; i++) {
    for (let j = i + 1; j < gameIds.length; j++) {
      const a = gameIds[i]!;
      const b = gameIds[j]!;
      const score = cosine(vectors.get(a)!, vectors.get(b)!);
      if (score >= CLUSTER_EDGE_THRESHOLD) pairScores.push({ a, b, score });
    }
  }
  const topByGame = new Map<string, { other: string; score: number }[]>();
  for (const { a, b, score } of pairScores) {
    if (score < SIMILAR_THRESHOLD) continue;
    topByGame.set(a, [...(topByGame.get(a) ?? []), { other: b, score }]);
    topByGame.set(b, [...(topByGame.get(b) ?? []), { other: a, score }]);
  }
  for (const [gameId, list] of topByGame) {
    list.sort((x, y) => y.score - x.score);
    for (const { other, score } of list.slice(0, SIMILAR_TOP_K)) {
      const [s, t] = gameId < other ? [gameId, other] : [other, gameId];
      addEdge(s, t, 'similarTo', Math.round(score * 100) / 100);
    }
  }

  // 추론: favoriteDeveloper (상위 3)
  [...devHours.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([orgId, hours]) => addEdge(meId, orgId, 'favoriteDeveloper', Math.round(hours)));

  // 파생: 취향 군집 (유사도 그래프에 Louvain)
  const simGraph = new Graph({ type: 'undirected' });
  for (const id of gameIds) simGraph.addNode(id);
  for (const { a, b, score } of pairScores) simGraph.addEdge(a, b, { weight: score });
  const communities = louvain(simGraph, { getEdgeWeight: 'weight', rng: mulberry32(42) });

  const members = new Map<number, string[]>();
  for (const [id, c] of Object.entries(communities)) members.set(c, [...(members.get(c) ?? []), id]);

  const OTHER = -1;
  const groups = new Map<number, string[]>();
  for (const [c, ids] of members) {
    const key = ids.length >= 3 ? c : OTHER; // 너무 작은 군집은 "기타"로 묶는다
    groups.set(key, [...(groups.get(key) ?? []), ...ids]);
  }

  const clusters: TasteCluster[] = [...groups.entries()]
    .map(([key, ids]) => {
      const tagScore = new Map<string, number>();
      let hours = 0;
      for (const id of ids) {
        const n = nodeById.get(id)!;
        hours += n.hours;
        for (const t of n.game!.tags) tagScore.set(t, (tagScore.get(t) ?? 0) + 1 + Math.log1p(n.hours));
      }
      const topTags = [...tagScore.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 3);
      return {
        id: key,
        name: key === OTHER ? '기타 취향' : topTags.slice(0, 2).join(' · '),
        topTags,
        gameIds: ids,
        hours,
      };
    })
    .sort((a, b) => (a.id === OTHER ? 1 : b.id === OTHER ? -1 : b.hours - a.hours))
    .map((c, i) => ({ ...c, id: i }));
  for (const c of clusters) for (const id of c.gameIds) nodeById.get(id)!.cluster = c.id;

  // 인접 리스트
  const adjacency = new Map<string, OntEdge[]>();
  for (const e of edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e]);
    adjacency.set(e.target, [...(adjacency.get(e.target) ?? []), e]);
  }

  // 통계
  const gameNodes = [...nodeById.values()].filter((n) => n.cls === 'Game');
  const byStatus: Record<PlayStatus, number> = { backlog: 0, tried: 0, played: 0, favorite: 0 };
  for (const n of gameNodes) byStatus[n.game!.status] += 1;
  const orgNodes = [...nodeById.values()].filter((n) => n.cls === 'Organization');

  return {
    meId,
    nodes: [...nodeById.values()],
    edges,
    nodeById,
    adjacency,
    clusters,
    stats: {
      totalGames: gameNodes.length,
      totalHours: gameNodes.reduce((s, n) => s + n.hours, 0),
      recentHours: gameNodes.reduce((s, n) => s + n.game!.hours2w, 0),
      byStatus,
      organizations: orgNodes.length,
      mergedOrganizations: orgNodes.filter((n) => n.org!.aliases.length > 1).length,
      friends: lib.friends.length,
    },
  };
}

/** 엣지의 반대편 노드 id */
export function otherEnd(edge: OntEdge, nodeId: string): string {
  return edge.source === nodeId ? edge.target : edge.source;
}
