# Steamverse

Steam 라이브러리를 지식 그래프로 묶어 여러 시각화로 탐색하는 웹앱. 기획은 [docs/PLAN.md](docs/PLAN.md), 지금 구현된 것은 [docs/PROGRESS.md](docs/PROGRESS.md).

## 실행

```bash
cp .env.example .env   # STEAM_API_KEY, STEAM_TEST_USER 채우기 (비워 두면 샘플 데이터로 동작)
npm install
npm run dev            # 웹 http://localhost:5173 + API :8787
```

- 상단의 데이터 출처 전환으로 **내 계정 / 샘플 / 시연**을 고른다. 시연은 이름을 가리고 이미지를 끈 샘플이다
- 내 계정: 개발 중에는 `.env`의 `STEAM_TEST_USER`, 공개 모드(`PUBLIC_MODE=1`)에서는 Steam 로그인한 본인 계정
- 게임 정보(회사·장르·태그·가격·이미지)는 키 없이 Steam 상점에서 받아 서버에 캐시한다
- 배포는 [docs/DEPLOY.md](docs/DEPLOY.md)

## 화면

| # | 화면 | 내용 |
|---|---|---|
| 01 | 그래프 탐색기 | Sigma.js(WebGL) 그래프. 게임 표지 노드, 노드 유형·플레이 상태 필터, 투영 보기, 호버 이웃 강조, 포커스 모드, 검색, 노드 상세 |
| 02 | 탐사 | Canvas 2D 도트 우주. 취향 군집 = 섹터, 게임 = 행성. 탐사선 비행·도킹, 미니맵, 백로그 안개·탐사율, 퀘스트 비콘, 친구 탐사선 |
| 03 | 차트 | 시간의 산맥(롱테일)·취향 지문(레이더)·개발사 제국 지도(보로노이)·백로그 빙산 |
| 04 | 시그널 | 취향 코드(코드 다이어그램)·시간의 궤도(선버스트)·시대의 군집(비스웜)·잠든 게임의 흐름(생키) |
| 05 | 성단 | 게임 카트리지 성단(d3-force). 묶음·크기·연결 기준 전환, 검색, 확대·이동, 집중 |
| 06 | 업적 | 업적 활동 캘린더, 희귀 업적 쇼케이스(전 세계 달성률) |

헤더에는 KPI, **오늘 뭐 하지**(잠든 게임 룰렛), 정보 패널(고지·데이터 출처·이미지 설정·내 데이터 지우기), Steam 로그인이 있다.

## 구조

```
apps/web/            React 18 + Vite + Tailwind 4 프론트엔드
apps/server/         Fastify 5 API 서버. Steam Web API·상점 API 호출, 캐시, 로그인, 빌드된 웹 서빙
packages/shared/     온톨로지 정의(단일 원천)·그래프 빌더·공용 타입·고지 문구 (web·server 공용)
  src/ontology.ts    클래스·관계·플레이 상태 정의 (색·라벨·schema.org 매핑 포함)
  src/graph.ts       라이브러리 → 그래프, 회사명 정규화, 추론(similarTo, favoriteDeveloper), 취향 군집
  src/legal.ts       비제휴·출처 고지 문구
  src/rdf.ts         Turtle 직렬화 (화면에서는 쓰지 않음)
docs/                기획·현황·배포·규약 문서
```

## 문서

| 문서 | 내용 |
|---|---|
| [PLAN.md](docs/PLAN.md) | 기획서 |
| [PROGRESS.md](docs/PROGRESS.md) | 구현 현황 (화면·API·데이터 흐름·남은 일) |
| [DEPLOY.md](docs/DEPLOY.md) | 배포 방법·환경 변수 |
| [STEAM_COMPLIANCE.md](docs/STEAM_COMPLIANCE.md) | Steam 약관·저작권 규약 |
| [COMPLIANCE_PLAN.md](docs/COMPLIANCE_PLAN.md) | 규약 조치 계획과 결과 |
| [PRIVACY.md](docs/PRIVACY.md) | 개인정보처리방침 초안 |
| [ELECTRON.md](docs/ELECTRON.md) | 데스크톱 앱 전환 계획 |
