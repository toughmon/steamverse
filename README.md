# Steamverse

Steam 라이브러리를 온톨로지(지식 그래프)로 탐색하는 웹앱. 기획은 [docs/PLAN.md](docs/PLAN.md).

## 프로토타입 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

현재는 **샘플 데이터**(`apps/web/src/data/sampleLibrary.ts`)로 동작한다. Steam API 연동 전.

| 화면 | 내용 |
|---|---|
| 그래프 탐색기 | Sigma.js(WebGL) 2D 그래프. 게임 아트 노드, 노드 유형·플레이 상태 필터, 호버 이웃 강조, 선택 노드 중심 보기, 노드별 RDF(Turtle) |
| 우주 뷰 | three.js 3D. 태그 유사도로 묶은 취향 군집(Louvain)을 은하로, 게임을 별로 표현 |
| 온톨로지 | 클래스·관계 스키마 다이어그램, 엔티티 정규화 결과, Turtle 어휘 |

## 구조

```
apps/web/            React + Vite + Tailwind 프론트엔드
packages/shared/     온톨로지 정의(단일 원천)·그래프 빌더·RDF 직렬화 — 백엔드와 공유 예정
  src/ontology.ts    클래스·관계·플레이 상태 정의 (색·라벨·schema.org 매핑 포함)
  src/graph.ts       라이브러리 → 온톨로지 그래프, 회사명 정규화, 추론(similarTo, favoriteDeveloper), 취향 군집
  src/rdf.ts         Turtle 직렬화
```
