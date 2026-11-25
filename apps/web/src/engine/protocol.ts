/**
 * 그래프 엔진(Worker) ↔ 화면 사이에 오가는 데이터.
 *
 * 큰 그래프에서 화면을 굳게 만드는 것은 그리기(WebGL)가 아니라 그 앞의 JS 객체 처리다:
 * 엣지 수십만 개를 객체로 복제하고, 하나씩 색인하고, 마우스를 올릴 때마다 전부 다시 훑는 일.
 * 그래서 엔진이 그래프를 소유하고, 화면에는 그릴 숫자만 typed array로 복사 없이(transfer) 넘긴다.
 */
import { RELATIONS, type LibraryData, type LibraryStats, type OntNode, type PlayerRecord, type RelationId, type TasteCluster } from '@steamverse/shared';
import type { ViewEdge, ViewQuery } from '../views/explorer/visible';

export type EngineSource = { kind: 'stress'; count: number } | { kind: 'library'; library: LibraryData };

/** 관계 ↔ 번호 (typed array에 담기 위해) */
export type EdgeRel = RelationId | 'sharesGames';
export const REL_LIST: EdgeRel[] = [...(Object.keys(RELATIONS) as RelationId[]), 'sharesGames'];
export const REL_INDEX = new Map(REL_LIST.map((r, i) => [r, i]));

/** 보이는 노드가 이보다 많으면 대용량 렌더러로 그린다 */
export const LARGE_VIEW = 3000;
/** 실제 라이브러리도 게임이 이보다 많으면 그래프를 엔진(Worker)에서 만든다 */
export const ENGINE_LIBRARY = 3000;

/**
 * 그래프 전체. 노드는 객체로(상세 패널·검색이 쓴다), 엣지는 배열로 넘긴다.
 * 노드 번호 = nodes 배열의 순서.
 */
export interface GraphPayload {
  meId: string;
  player: PlayerRecord;
  nodes: OntNode[];
  clusters: TasteCluster[];
  stats: LibraryStats;
  edgeSrc: Uint32Array;
  edgeDst: Uint32Array;
  edgeRel: Uint8Array;
  /** 가중치가 없으면 NaN */
  edgeW: Float32Array;
  /** CSR: 노드 i에 닿은 엣지 번호 = incEdges[incOffsets[i] .. incOffsets[i+1]) */
  incOffsets: Uint32Array;
  incEdges: Uint32Array;
  buildMs: number;
}

/** 작은 결과는 지금까지처럼 객체로 (화면이 자기 방식대로 배치·그리기) */
export interface SmallView {
  kind: 'small';
  nodeIds: string[];
  edges: ViewEdge[];
}

/** 큰 결과는 배치가 끝난 숫자 배열로. 노드 번호 i는 이 보기 안의 순서 */
export interface LargeView {
  kind: 'large';
  /** 보기 번호 → 그래프 전체 노드 번호 */
  nodeIdx: Uint32Array;
  x: Float32Array;
  y: Float32Array;
  size: Float32Array;
  colorIdx: Uint8Array;
  palette: string[];
  /** 기본 화면에 그릴 엣지 (보기 번호). 수천 개가 걸린 허브의 부채꼴 선은 빼고, 강조할 때만 그린다 */
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  edgeRel: Uint8Array;
  /** 이 보기에 있는 관계 (범례·강조용) */
  relations: EdgeRel[];
  /** 보기 안의 전체 엣지 수 (기본 화면에서 뺀 허브 선 포함) */
  edgeCount: number;
  layoutMs: number;
  viewMs: number;
}

export type ViewResult = SmallView | LargeView;

export interface EngineApi {
  init(source: EngineSource): Promise<GraphPayload>;
  view(query: ViewQuery): Promise<ViewResult>;
}
