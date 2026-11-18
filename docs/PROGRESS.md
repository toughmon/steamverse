---
uid: e061a8a3-d345-438a-aa14-b559f1615144
kind: element
title: Steamverse 작업 현황
domain: docs
---

# Steamverse 작업 현황

> 기준: 2026-11-18, 커밋 `31cd4ea` (main)
>
> 배포는 [DEPLOY.md](DEPLOY.md) · 기획은 [PLAN.md](PLAN.md), 데스크톱 앱 전환 계획은 [ELECTRON.md](ELECTRON.md), Steam 약관·저작권 규약은 [STEAM_COMPLIANCE.md](STEAM_COMPLIANCE.md)

---

## 1. 요약

- **동작하는 프로토타입**: 실제 Steam 계정(`.env`의 키·사용자)이나 샘플 데이터로 4개 화면(그래프 탐색기·탐사·차트·온톨로지)이 동작한다
- **데이터**: 플레이 기록은 Steam Web API로, 게임 정보(회사·장르·태그·가격·이미지)는 키 없이 쓰는 상점 API로 받아 합친다
- **온톨로지**: 클래스 6개와 관계 9개(추론 2개 포함)를 `packages/shared`에서 정의한다. 회사명 정규화, 유사 게임 추론, 취향 군집, Turtle 내보내기가 들어 있다
- **아직 없음**: 로그인, DB, 동기화 워커, 업적 상세·스냅샷·위시리스트 등 PLAN 2단계 이후 기능
- `npm run typecheck` 통과 (web, server 모두)

## 2. 커밋 이력

| 날짜 | 커밋 | 내용 |
|---|---|---|
| 11-17 | `5035ab8` | 첫 커밋. 모노레포, 상점 API 서버, 샘플 데이터, 그래프 탐색기·3D 우주 뷰·차트·온톨로지 화면 |
| 11-17 | `f26578b` | 실제 Steam 계정 연결(Web API), 공식 상점 태그, 탐색기 선 스타일 차분하게 |
| 11-18 | `5686ff7` | 3D 우주 뷰(three.js)를 없애고 2D 도트 "탐사" 뷰로 교체 |
| 11-18 | `4aebf63` | 탐사 조작 안내를 화면 아래로 |
| 11-18 | `7858f97` | 백로그 안개, 탐사율 |
| 11-18 | `31cd4ea` | 퀘스트 비콘, 친구 탐사선 |

## 3. 구조

```
apps/web/          React 18 + Vite 8 + Tailwind 4 프론트엔드 (:5173, /api 를 서버로 프록시)
apps/server/       Fastify 5 API 서버 (:8787, tsx로 실행)
packages/shared/   온톨로지 정의 · 그래프 빌더 · RDF 직렬화 · 공용 타입 (web·server 공용)
docs/              PLAN.md(기획), ELECTRON.md(데스크톱 전환 계획), PROGRESS.md(이 문서)
```

실행:

```bash
cp .env.example .env   # STEAM_API_KEY, STEAM_TEST_USER 채우기 (없어도 샘플·상점 정보로 동작)
npm install
npm run dev            # web + api 동시 실행 (concurrently)
```

## 4. 백엔드 (`apps/server`)

### 4.1 API

| 경로 | 키 필요 | 동작 |
|---|---|---|
| `GET /api/health` | - | 서버 상태, 키·테스트 사용자 유무(값은 내보내지 않음), 큐 일시정지 시간 |
| `GET /api/catalog?appids=1,2,…` | 아니오 | 최대 500개. 캐시에 있는 것만 바로 주고, 없는 것은 뒤에서 받기 시작. 응답의 `status.pending`이 0이 될 때까지 클라이언트가 다시 물어봄 |
| `GET /api/catalog/:appid` | 아니오 | 한 게임. 없으면 받을 때까지 기다림 |
| `GET /api/library?user=&refresh=1` | 예 | 보유 게임·플레이 시간·업적·친구. `user`를 안 주면 `.env`의 `STEAM_TEST_USER`. SteamID64, 프로필 주소, `/id/` 이름 모두 됨 |

오류 코드: `no-key`(503), `no-user`(400), `not-found`(404), `steam-failed`(502)

### 4.2 데이터 출처

| 출처 | 파일 | 요청 간격 | 받는 것 |
|---|---|---|---|
| Steam Store `appdetails` | `steam/store.ts` | 1.6초 (429 시 90초 정지) | 회사·장르·카테고리·출시년도·가격·메타크리틱·플랫폼·이미지. 한국 상점 우선, 없으면 미국 상점(가격은 버림) |
| 공식 상점 태그 `IStoreBrowseService/GetItems` + `IStoreService/GetTagList` | `steam/storetags.ts` | 0.3초 (429 시 60초) | 투표 가중치 순 유저 태그. 태그 이름 목록은 7일 캐시 |
| SteamSpy (비공식) | `steam/steamspy.ts` | 1.1초 (429 시 60초) | 공식 태그가 비었을 때만 보충 |
| Steam Web API | `steam/webapi.ts` | 0.12초 (429 시 30초) | `GetPlayerSummaries`, `GetOwnedGames`, `GetFriendList`, `GetSteamLevel`, `GetPlayerAchievements`, `ResolveVanityURL` |

- 일반 태그(Singleplayer, Indie, Action 등 19개)는 취향 계산을 흐려서 뺀다. 게임당 최대 12개 저장, 화면에는 6개
- 영어(`l=english`)로 받아 회사·태그 이름을 그래프에서 맞춘다

### 4.3 라이브러리 조립 (`library.ts`)

- 업적: 플레이한 게임 중 통계 공개된 것, 플레이 시간 순 **상위 80개**만 (게임마다 호출 1번)
- 친구: 친구 맺은 순 **앞 60명**. 각자 `GetOwnedGames`를 불러 **내 라이브러리와 겹치는 게임**만 남김
- 비공개 설정 감지 → 경고로 돌려줌: `games-private`, `friends-private`, `achievements-private`
- 회사·장르·태그·출시년도·가격은 비워 두고 클라이언트가 카탈로그로 채움
- Deck 호환은 아직 `unknown` 고정

### 4.4 공통 기반 (`lib/`)

- `throttle.ts`: 호스트별 작업 줄. 최소 간격 보장, 429 받으면 `pause()`, 실패해도 줄이 끊기지 않음
- `http.ts`: 15초 타임아웃, 429 또는 본문 `null`(Store API의 한도 초과 응답)을 `RateLimitedError`로
- `cache.ts`: 메모리 + 파일(`apps/server/.cache/<ns>/<key>.json`) 캐시
  - 카탈로그 7일 (형식 버전 `SCHEMA = 2`가 바뀌면 다시 받음), 실패한 앱은 10분 뒤 재시도, 태그를 못 받은 항목은 캐시하지 않음
  - 라이브러리 10분, `refresh=1`로 무시 가능
  - 같은 요청이 동시에 오면 하나로 합침(inflight 맵)

## 5. 공유 패키지 (`packages/shared`)

### 5.1 온톨로지 (`ontology.ts`) — 단일 원천

클래스(색·한/영 라벨·schema.org 매핑 포함):

| 클래스 | schema.org |
|---|---|
| Player | `schema:Person` |
| Game | `schema:VideoGame` |
| Organization | (개발사·퍼블리셔 공용, 역할은 관계로 구분) |
| Franchise | |
| Genre | |
| Tag | |

관계:

| 관계 | 방향 | 종류 |
|---|---|---|
| `owns` | Player → Game | 원본 |
| `developedBy` / `publishedBy` | Game → Organization | 원본 |
| `partOfFranchise` | Game → Franchise | 원본 (샘플에만 있음, 실데이터 출처 미정) |
| `hasGenre` / `hasTag` | Game → Genre / Tag | 원본 |
| `friendOf` | Player ↔ Player | 원본, 대칭 |
| `similarTo` | Game ↔ Game | **추론**: 태그·장르 벡터 코사인 유사도 ≥ 0.5, 게임당 상위 3개, 장르 가중치 0.35 |
| `favoriteDeveloper` | Player → Organization | **추론**: 개발 게임 플레이 시간 합 상위 3개 회사 |

플레이 상태: 백로그(0분) · 찍먹(2시간 미만) · 플레이(2시간 이상) · 인생작(100시간 이상)

### 5.2 그래프 빌더 (`graph.ts`)

- `buildOntologyGraph(library)` → 노드·엣지·인접 리스트·취향 군집·통계
- 회사명 정규화: 법인 접미사 제거(`CAPCOM Co., Ltd.` → `capcom`). 표시 이름은 가장 짧은 표기. 같은 회사가 개발+배급이면 시간·게임 수를 한 번만 센다
- 취향 군집: 유사도 그래프(가중치 ≥ 0.3)에 Louvain, 시드 고정(결정적). 3개 미만 군집은 "기타"
- 이미지: 상점이 준 실제 주소를 `registerSteamImages()`로 등록(최근 게임은 해시 경로라 규칙으로 만들면 깨짐)

### 5.3 RDF (`rdf.ts`)

- `vocabularyTurtle()`: 온톨로지(TBox) Turtle
- `nodeTurtle(graph, id)`: 한 노드 중심 Turtle (나가는 트리플 + 들어오는 트리플 최대 12개)
- 외부 라이브러리 없는 최소 구현. 정식 내보내기는 `n3`/`jsonld`로 바꿀 예정

## 6. 프론트엔드 (`apps/web`)

### 6.1 공통

- **상단 바**: 로고, 데이터 출처 전환(내 계정 / 샘플, 브라우저에 기억), 상태 표시, 탭 4개, KPI(보유·총 시간·백로그 비율·최근 2주·친구), 플레이어 이름·레벨
- **상태 표시**: `STEAM LIVE`, `STORE SYNC n/m`(상점 정보 받는 중), `LOADING`, `OFFLINE`, `SAMPLE · 계정 연결 안 됨`(이유는 툴팁), 비공개 경고 배지
- **데이터 흐름** (`data/useLibrary.ts`):
  1. 내 계정이면 `/api/library`, 실패하면 샘플로 대체하고 이유 표시
  2. 보유 게임 appid로 `/api/catalog`를 4초마다 조회, 상점 정보로 게임 정보를 덮어씀
  3. 받는 중에는 15개 쌓일 때마다만 그래프를 다시 만듦 (화면 흔들림 방지)
  4. 서버가 꺼져 있으면 15초마다 다시 시도
- 탐사·차트 뷰는 지연 로딩
- 샘플 데이터: `data/sampleLibrary.ts`, `data/samplePrices.ts`

### 6.2 01 그래프 탐색기 (`ExplorerView.tsx`, `lib/sigmaStyle.ts`)

- Sigma.js v3(WebGL) + graphology, ForceAtlas2(linLog) 배치
- 게임 노드는 표지 이미지 + 플레이 상태 색 테두리, 나머지는 클래스 색 점 + 빛번짐
- 필터: 노드 클래스별, 플레이 상태별
- **투영 보기**: 게임을 숨기면 회사·장르·태그끼리 "같은 게임을 공유하는 만큼" 직접 잇는다 (노드당 상위 5개, 최소 2개 공유, 고립 노드는 가장 강한 연결 하나 유지)
- 포커스 모드: 선택 노드 중심 n단계만
- 호버 시 이웃만 남기고 나머지 숨김. 선은 평소엔 거의 투명하게, 긴 선일수록 가늘고 곧게
- 노드 드래그, `/` 키 검색(`SearchBox`)
- 숨겨진 필터의 노드를 고르면 필터를 자동으로 켬
- `owns`(나 → 모든 게임)는 그래프를 한 점으로 모아서 탐색기에서 생략
- 상세 패널(`NodeDetail`): 관계를 방향별 이름으로, 가격·할인, 시간당 가격("본전"), 업적, 노드 Turtle

### 6.3 02 탐사 (`VoyageView.tsx`, `views/voyage/`)

위에서 내려다보는 2D 도트 우주를 탐사선으로 날아다니는 화면. 3D 우주 뷰를 대체했다.

- **세계** (`world.ts`): 섹터 = 취향 군집, 행성 = 게임(반지름 = 플레이 시간). 섹터 안은 해바라기 씨 배열, 섹터끼리는 나선 배치. 난수 없이 같은 데이터면 같은 배치
- **그래픽** (`sprites.ts`): 외부 그림 없이 코드로. 행성은 게임 표지를 원으로 잘라 색 수 줄이고 베이어 디더링 음영, 성운은 값 노이즈, 탐사선은 문자열 도트 그림. 저해상도 버퍼에 그려 3배로 키움(보간 없음). 글자는 원래 해상도로
- **조작**: WASD 비행, Shift 부스트, 클릭 자동 비행, E 도킹(행성 정보), 1–9 섹터 워프, M 미니맵, Esc 정지
- **백로그 안개**: 한 번도 안 한 게임은 안개 + 물음표. 가까이 가면 안개가 걷힘
- **탐사율**: 처음 가까이 간 행성을 기록, 100% 달성 알림. 계정별로 브라우저(localStorage)에 저장
- **퀘스트 비콘** (`quests.ts`): 백로그·찍먹 게임 중 많이 한 게임(10시간 이상)과 닮았거나 친구가 가진 게임을 추천. 이유 문구 표시, 건너뛰기 가능
- **친구 탐사선** (`friends.ts`): 최대 12척. 친구와 같이 가진 게임 주위를 돌다가 다른 공유 게임으로 옮겨 감(많이 한 게임일수록 자주). 가까이 가면 인사 알림
- **미니맵** (`minimap.ts`): 성운·행성은 한 번만 그리고 매 프레임 탐사선·시야·목적지·친구·퀘스트만 덧그림
- 도킹한 행성에서 그래프 탐색기로 바로 이동

### 6.4 03 차트 — 취향 리포트 (`ChartView.tsx`, `views/charts/`)

D3(계산) + React SVG. 위에서 아래로 읽는 4장. 게임을 누르면 탐색기로 이동.

| # | 이름 | 파일 | 내용 |
|---|---|---|---|
| 01 | 시간의 산맥 | `LongTail.tsx` | 게임별 플레이 시간 롱테일 |
| 02 | 취향 지문 | `Fingerprint.tsx` | 태그 12축 레이더. 나와 친구 비교. 게임마다 log(1+시간)만큼 더해 한 게임이 독식하지 않게 |
| 03 | 개발사 제국 지도 | `EmpireMap.tsx` | 유통사 → 개발사 → 게임 보로노이 트리맵 (면적 = 시간, 2시간 이상 게임만) |
| 04 | 백로그 빙산 | `Iceberg.tsx` | 조각 = 유료 게임, 높이 = 정가. 수면 위는 2시간 이상 한 게임, 아래는 백로그·찍먹. "OO원어치가 잠들어 있어요". 상점 가격이 없으면 샘플 가격으로 추정. 잠든 게임 중 좋아한 게임과 가장 닮은 것 추천 |

색은 dataviz 검증기를 통과한 시리즈 색(`kit.tsx`)

### 6.5 04 온톨로지 (`OntologyView.tsx`)

- 클래스·관계 스키마 다이어그램 (같은 두 클래스 사이 여러 관계는 휘어서 겹치지 않게, 자기 관계는 고리)
- 엔티티 정규화 결과, Turtle 어휘

## 7. 기획(PLAN.md)과 다른 점

| 기획 | 현재 | 비고 |
|---|---|---|
| Steam OpenID 로그인 + 세션 | `.env`의 `STEAM_TEST_USER` 하나 | 혼자 쓰는 프로토타입 단계 |
| PostgreSQL + Drizzle | 파일 캐시 | |
| pg-boss 동기화 워커 | 요청 시 바로 받기 + 클라이언트 폴링 | |
| ECharts | D3 + React SVG | |
| 3D 우주 뷰 (react-force-graph-3d) | 2D 도트 탐사 뷰 | `5686ff7`에서 교체 |
| TanStack Query + Zustand | React 상태 + 직접 만든 폴링 훅 | |
| shadcn/ui, Motion | Tailwind만 | |

## 8. PLAN 로드맵 대비 진척

| 단계 | 상태 | 메모 |
|---|---|---|
| 0. API 탐색 | 일부 | 상점·태그·SteamSpy·Web API 6개 엔드포인트 실사용, 요청 간격 정함. "API 가용성 표"는 아직 |
| 1. MVP (M1·M2) | 대부분 | 그래프 탐색기·차트·라이브러리 KPI 있음. 로그인·DB·워커·배포 없음. 트리맵은 보로노이로 대체 |
| 2. 업적·시간 (M3·M8) | 시작 전 | 업적은 개수(해금/전체)만. 해금 시각·스냅샷·캘린더 없음 |
| 3. 사람·돈·세상 (M4~M7) | 일부 | 친구 공유 게임·지문 비교·가격·잠든 게임 금액 있음. 위시리스트·동시접속·뉴스·배지 없음 |
| 4. 온톨로지 심화 | 일부 | 추론 2개, 회사명 정규화, 노드별 Turtle. SPARQL·병합 UI·JSON-LD 없음 |
| 5. 공유·확장 | 일부 | 유사 게임 추천(퀘스트·빙산). 페르소나 카드 없음 |

## 9. 알려진 문제·할 일

- [ ] `README.md`가 오래됨: "샘플 데이터로 동작, Steam API 연동 전"이라고 적혀 있음 → 실계정 연결·`.env` 설정 방법으로 갱신
- [ ] 프랜차이즈 데이터 출처 없음 (샘플에만 있음)
- [ ] Deck 호환 정보 없음 (`unknown` 고정)
- [ ] 친구 60명·업적 80게임 상한: 큰 계정은 첫 로딩이 느리고 일부가 빠짐
- [ ] 첫 상점 동기화가 게임 수 × 약 1.6초 이상 걸림 (게임 300개면 8분 이상)
- [ ] 탐사 기록·데이터 출처 선택이 브라우저 localStorage에만 있음
- [x] `npm audit` high 5건 — 확인 결과 Vite 안의 picomatch 하나, 운영 서버와 무관·수정판 없음 → [DEPLOY.md](DEPLOY.md) §6
- [ ] esbuild·fsevents install 스크립트 미승인 (`npm install-scripts approve esbuild`)
- [ ] Electron 데스크톱 앱 전환 → [ELECTRON.md](ELECTRON.md)
- [x] 규약 위반 소지 개선 1~11 (로그 마스킹, 캐시 정리, 상점 링크, 고지, SteamSpy 표시, 호출량 제한, 탐사 표지 기본 끔, 이미지 끄기·차단, 시연 모드, RDF 친구 익명화, 내 데이터 지우기) → [COMPLIANCE_PLAN.md](COMPLIANCE_PLAN.md)
- [x] Steam 로그인(OpenID) + 공개 모드(본인 계정만 조회) — `apps/server/src/auth.ts`, `apps/web/src/components/Session.tsx`
- [x] 배포 구성: 서버가 웹+API를 한 주소로, 보안 헤더, Dockerfile, `CACHE_DIR`·`TRUST_PROXY` → [DEPLOY.md](DEPLOY.md)
- [x] 상점 동기화: 많이 한 게임부터, 남은 시간·진행 막대, 인기 게임 100개 미리 채우기
- [x] 이용자별 하루 동기화 횟수 제한
- [x] 04 시그널 탭: 취향 코드(코드 다이어그램)·시간의 궤도(선버스트)·시대의 군집(비스웜)·잠든 게임의 흐름(생키)
- [x] 05 성단 탭: 카트리지 성단 (d3-force, 화면 전체) — 빛무리(메타볼)·빛 알갱이 연결, 묶음·크기 기준 전환, 연결 유사도 슬라이더, 검색, 확대·이동, 선택 패널, 성단 집중
- [x] 06 업적 탭: 업적 활동 캘린더(해금 시각 잔디, 연도별 막대, 연속·최다일)·희귀 업적 쇼케이스(전 세계 달성률, 전설·희귀·드묾·보통)
- [x] 헤더 '오늘 뭐 하지': 잠든 게임 룰렛 (좋아한 게임과 닮은 정도·친구 보유로 가중, 이건 패스)
- [ ] API 키를 서비스 전용 계정 키로 교체 (DEPLOY.md §4)
- [ ] 호스팅 결정·실제 배포
- [ ] 제품명 변경 (STEAM_COMPLIANCE T4)
- [ ] [PRIVACY.md](PRIVACY.md) 초안을 배포 형태에 맞게 완성
