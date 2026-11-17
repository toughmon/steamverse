/**
 * Steamverse 온톨로지 정의 — 단일 원천(single source of truth).
 *
 * 여기 정의된 클래스·관계·상태가 그래프 스타일, 범례·필터 UI, RDF 어휘(Turtle),
 * API 타입의 기준이 된다. 새 클래스나 관계를 추가할 때는 이 파일만 고치면 된다.
 */

export type ClassId = 'Player' | 'Game' | 'Organization' | 'Franchise' | 'Genre' | 'Tag';

export type RelationId =
  | 'owns'
  | 'developedBy'
  | 'publishedBy'
  | 'partOfFranchise'
  | 'hasGenre'
  | 'hasTag'
  | 'friendOf'
  | 'similarTo'
  | 'favoriteDeveloper';

export type PlayStatus = 'backlog' | 'tried' | 'played' | 'favorite';

export interface Label {
  ko: string;
  en: string;
}

export interface ClassDef {
  id: ClassId;
  label: Label;
  description: string;
  /** 그래프·범례·배지에서 공통으로 쓰는 클래스 색 */
  color: string;
  /** schema.org 매핑 (RDF 내보내기 시 owl:equivalentClass) */
  schemaOrg?: string;
}

export interface RelationDef {
  id: RelationId;
  label: Label;
  description: string;
  domain: ClassId;
  range: ClassId;
  color: string;
  /** true면 원본 데이터가 아니라 규칙으로 계산한 관계 */
  inferred: boolean;
  symmetric?: boolean;
  schemaOrg?: string;
}

export interface PlayStatusDef {
  id: PlayStatus;
  label: Label;
  color: string;
  rule: string;
}

export const ONTOLOGY_NS = 'https://steamverse.example/ontology#';
export const DATA_NS = 'https://steamverse.example/id/';

export const CLASSES: Record<ClassId, ClassDef> = {
  Player: {
    id: 'Player',
    label: { ko: '플레이어', en: 'Player' },
    description: '스팀 계정. 나와 친구 모두 이 클래스의 인스턴스다.',
    color: '#f29fc0',
    schemaOrg: 'schema:Person',
  },
  Game: {
    id: 'Game',
    label: { ko: '게임', en: 'Game' },
    description: '스팀 앱(appid). 플레이 시간·상태·출시 연도를 가진다.',
    color: '#8ab4ff',
    schemaOrg: 'schema:VideoGame',
  },
  Organization: {
    id: 'Organization',
    label: { ko: '회사', en: 'Organization' },
    description: '개발사·퍼블리셔. 역할은 관계(developedBy / publishedBy)로 구분한다.',
    color: '#e6c07b',
    schemaOrg: 'schema:Organization',
  },
  Franchise: {
    id: 'Franchise',
    label: { ko: '프랜차이즈', en: 'Franchise' },
    description: '같은 세계관·시리즈로 묶인 게임 집합.',
    color: '#b69cff',
    schemaOrg: 'schema:CreativeWorkSeries',
  },
  Genre: {
    id: 'Genre',
    label: { ko: '장르', en: 'Genre' },
    description: '스토어가 지정한 공식 장르.',
    color: '#6fd6b4',
  },
  Tag: {
    id: 'Tag',
    label: { ko: '태그', en: 'Tag' },
    description: '유저가 붙인 태그. 취향 유사도 계산의 기반.',
    color: '#8b93a7',
  },
};

export const RELATIONS: Record<RelationId, RelationDef> = {
  owns: {
    id: 'owns',
    label: { ko: '보유', en: 'owns' },
    description: '플레이어가 게임을 보유한다. 플레이 시간을 속성으로 가진다.',
    domain: 'Player',
    range: 'Game',
    color: 'rgba(242,159,192,0.28)',
    inferred: false,
  },
  developedBy: {
    id: 'developedBy',
    label: { ko: '개발', en: 'developed by' },
    description: '게임을 개발한 회사.',
    domain: 'Game',
    range: 'Organization',
    color: 'rgba(230,192,123,0.45)',
    inferred: false,
    schemaOrg: 'schema:author',
  },
  publishedBy: {
    id: 'publishedBy',
    label: { ko: '배급', en: 'published by' },
    description: '게임을 배급한 회사.',
    domain: 'Game',
    range: 'Organization',
    color: 'rgba(240,164,120,0.3)',
    inferred: false,
    schemaOrg: 'schema:publisher',
  },
  partOfFranchise: {
    id: 'partOfFranchise',
    label: { ko: '시리즈', en: 'part of franchise' },
    description: '게임이 속한 프랜차이즈.',
    domain: 'Game',
    range: 'Franchise',
    color: 'rgba(182,156,255,0.5)',
    inferred: false,
    schemaOrg: 'schema:isPartOf',
  },
  hasGenre: {
    id: 'hasGenre',
    label: { ko: '장르', en: 'has genre' },
    description: '게임의 공식 장르.',
    domain: 'Game',
    range: 'Genre',
    color: 'rgba(111,214,180,0.25)',
    inferred: false,
    schemaOrg: 'schema:genre',
  },
  hasTag: {
    id: 'hasTag',
    label: { ko: '태그', en: 'has tag' },
    description: '게임에 붙은 유저 태그.',
    domain: 'Game',
    range: 'Tag',
    color: 'rgba(139,147,167,0.18)',
    inferred: false,
    schemaOrg: 'schema:keywords',
  },
  friendOf: {
    id: 'friendOf',
    label: { ko: '친구', en: 'friend of' },
    description: '스팀 친구 관계. 대칭 관계다.',
    domain: 'Player',
    range: 'Player',
    color: 'rgba(242,159,192,0.6)',
    inferred: false,
    symmetric: true,
    schemaOrg: 'schema:knows',
  },
  similarTo: {
    id: 'similarTo',
    label: { ko: '비슷함', en: 'similar to' },
    description: '태그·장르 벡터의 코사인 유사도가 임계값 이상인 게임 쌍. (추론)',
    domain: 'Game',
    range: 'Game',
    color: 'rgba(138,180,255,0.42)',
    inferred: true,
    symmetric: true,
  },
  favoriteDeveloper: {
    id: 'favoriteDeveloper',
    label: { ko: '선호 개발사', en: 'favorite developer' },
    description: '개발한 게임의 플레이 시간 합이 상위 3위 안에 드는 회사. (추론)',
    domain: 'Player',
    range: 'Organization',
    color: 'rgba(230,192,123,0.75)',
    inferred: true,
  },
};

/** 상세 패널에서 관계를 읽는 방향별 이름 (주어 쪽에서 / 목적어 쪽에서) */
export const RELATION_READING: Record<RelationId, { out: string; in: string }> = {
  owns: { out: '보유 게임', in: '보유한 플레이어' },
  developedBy: { out: '개발사', in: '개발한 게임' },
  publishedBy: { out: '퍼블리셔', in: '배급한 게임' },
  partOfFranchise: { out: '시리즈', in: '시리즈 게임' },
  hasGenre: { out: '장르', in: '이 장르의 게임' },
  hasTag: { out: '태그', in: '이 태그의 게임' },
  friendOf: { out: '친구', in: '친구' },
  similarTo: { out: '비슷한 게임', in: '비슷한 게임' },
  favoriteDeveloper: { out: '선호 개발사', in: '이 회사를 선호하는 플레이어' },
};

export const FAVORITE_HOURS = 100;
export const TRIED_HOURS = 2;

export const PLAY_STATUS: Record<PlayStatus, PlayStatusDef> = {
  backlog: {
    id: 'backlog',
    label: { ko: '백로그', en: 'Backlog' },
    color: '#3b4357',
    rule: '플레이 0분',
  },
  tried: {
    id: 'tried',
    label: { ko: '찍먹', en: 'Tried' },
    color: '#7dd3e8',
    rule: `0분 초과 ~ ${TRIED_HOURS}시간 미만`,
  },
  played: {
    id: 'played',
    label: { ko: '플레이', en: 'Played' },
    color: '#8ab4ff',
    rule: `${TRIED_HOURS}시간 이상`,
  },
  favorite: {
    id: 'favorite',
    label: { ko: '인생작', en: 'Favorite' },
    color: '#ff7a90',
    rule: `${FAVORITE_HOURS}시간 이상`,
  },
};

export function classifyPlaytime(minutes: number): PlayStatus {
  if (minutes <= 0) return 'backlog';
  const hours = minutes / 60;
  if (hours < TRIED_HOURS) return 'tried';
  if (hours >= FAVORITE_HOURS) return 'favorite';
  return 'played';
}

export const CLASS_ORDER: ClassId[] = ['Game', 'Organization', 'Franchise', 'Genre', 'Tag', 'Player'];
export const RELATION_ORDER: RelationId[] = [
  'owns',
  'developedBy',
  'publishedBy',
  'partOfFranchise',
  'hasGenre',
  'hasTag',
  'friendOf',
  'similarTo',
  'favoriteDeveloper',
];
