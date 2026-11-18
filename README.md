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
| 그래프 탐색기 | Sigma.js(WebGL) 2D 그래프. 게임 아트 노드, 노드 유형·플레이 상태 필터, 호버 이웃 강조, 선택 노드 중심 보기 |
| 탐사 | Canvas 2D 도트 탐사 게임. 취향 군집(Louvain)을 섹터로, 게임을 행성(크기 = 플레이 시간)으로. 탐사선으로 날아다니며 행성에 도킹해 게임 정보를 본다 |
| 차트 | 롱테일·취향 지문·개발사 영토(보로노이)·백로그 빙산 |

## 구조

```
apps/web/            React + Vite + Tailwind 프론트엔드
packages/shared/     온톨로지 정의(단일 원천)·그래프 빌더·RDF 직렬화 — 백엔드와 공유 예정
  src/ontology.ts    클래스·관계·플레이 상태 정의 (색·라벨·schema.org 매핑 포함)
  src/graph.ts       라이브러리 → 온톨로지 그래프, 회사명 정규화, 추론(similarTo, favoriteDeveloper), 취향 군집
  src/rdf.ts         Turtle 직렬화
```
