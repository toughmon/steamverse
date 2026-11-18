---
uid: e061a8a3-d345-438a-aa14-b559f1615144
kind: element
title: Steamverse 작업 현황
domain: docs
---

# Steamverse 작업 현황

> 기준: 2026-11-18, 커밋 `843beb6` (main)
>
> 배포는 [DEPLOY.md](DEPLOY.md) · 기획은 [PLAN.md](PLAN.md), 데스크톱 앱 전환 계획은 [ELECTRON.md](ELECTRON.md), Steam 약관·저작권 규약은 [STEAM_COMPLIANCE.md](STEAM_COMPLIANCE.md)

---

## 1. 요약

- **동작하는 프로토타입**: 실제 Steam 계정이나 샘플·시연 데이터로 6개 화면(그래프 탐색기·탐사·차트·시그널·성단·업적)이 동작한다
- **데이터**: 플레이 기록은 Steam Web API로, 게임 정보(회사·장르·태그·가격·이미지)는 키 없이 쓰는 상점 API로 받아 합친다. 업적은 해금 시각과 전 세계 달성률까지 받는다
- **온톨로지**: 클래스 6개와 관계 9개(추론 2개 포함)를 `packages/shared`에서 정의한다. 회사명 정규화, 유사 게임 추론, 취향 군집이 들어 있다. 사용자에게 필요 없어 온톨로지 탭과 노드별 Turtle 패널은 뺐다(`843beb6`)
- **공개 준비**: Steam 로그인(OpenID)·공개 모드, Steam 규약 조치, 배포 구성(Docker)까지 있다. 실제 배포는 아직
- **아직 없음**: DB, 동기화 워커, 스냅샷·위시리스트·뉴스 등 PLAN 3단계 이후 기능 대부분
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
| 11-18 | `7db8254` | Steam 규약 조치, Steam 로그인 |
| 11-18 | `d8691db` | 규약·개인정보·현황·Electron 문서 |
| 11-18 | `bb315c2` · `f90a54a` | 공개 웹 배포 준비, 배포 문서 (PR #1) |
| 11-18 | `4abb034` | 04 시그널 탭 (PR #2) |
| 11-18 | `d29b523` | 05 성단 탭 (PR #3) |
| 11-18 | `aac3c21` | 문서 그래프 메타데이터(frontmatter) (PR #4) |
| 11-18 | `39ad8e6` | 06 업적 탭, 오늘 뭐 하지 룰렛 (PR #5) |
| 11-18 | `843beb6` | 온톨로지 탭·노드 Turtle 패널 제거 |

## 3. 구조

```
apps/web/          React 18 + Vite 8 + Tailwind 4 프론트엔드 (:5173, /api 를 서버로 프록시)
apps/server/       Fastify 5 API 서버 (:8787, tsx로 실행). 빌드된 웹이 있으면 같은 주소로 서빙
packages/shared/   온톨로지 정의 · 그래프 빌더 · 고지 문구 · RDF 직렬화 · 공용 타입 (web·server 공용)
docs/              PLAN(기획), PROGRESS(이 문서), DEPLOY(배포), STEAM_COMPLIANCE·COMPLIANCE_PLAN(규약),
                   PRIVACY(개인정보처리방침 초안), ELECTRON(데스크톱 전환 계획), docs.md(문서 그래프 도메인)
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
| `GET /api/health` | - | 서버 상태, 키·테스트 사용자 유무(값은 내보내지 않음), 공개 모드, Web API 사용량, 큐 일시정지 시간 |
| `GET /api/config` | - | 이미지 차단 게임 목록(`blocked-images.json`), 공개 모드, 운영자 연락처·서버 위치 |
| `GET /api/catalog?appids=1,2,…` | 아니오 | 최대 500개. 캐시에 있는 것만 바로 주고, 없는 것은 뒤에서 받기 시작. 응답의 `status.pending`이 0이 될 때까지 클라이언트가 다시 물어봄 |
| `GET /api/catalog/:appid` | 아니오 | 한 게임. 없으면 받을 때까지 기다림 |
| `GET /api/achievements/global?appids=…` | 아니오 | 업적의 전 세계 달성률 (7일 캐시). 카탈로그처럼 `status.pending`으로 진행 알림 |
| `GET /api/library?user=&refresh=1` | 예 | 보유 게임·플레이 시간·업적(해금 시각 포함)·친구. 로그인한 본인이 우선. 개발 중에는 `user` 또는 `.env`의 `STEAM_TEST_USER`(SteamID64, 프로필 주소, `/id/` 이름), 공개 모드에서는 본인만 |
| `DELETE /api/library` | - | 이 계정의 서버 캐시(친구 정보 포함) 지우기 — "내 데이터 지우기" |
| `GET /api/auth/steam/login` | - | Steam 로그인 페이지로 이동 (OpenID 2.0, state 쿠키 10분) |
| `GET` 로그인 콜백 (`CALLBACK_PATH`) | - | Steam 응답 확인 → 서명된 세션 쿠키(30일) → 첫 화면. 실패하면 `/?login=<이유>` |
| `POST /api/auth/logout` | - | 세션 종료 + 그 계정의 라이브러리 캐시 삭제 |
| `GET /api/auth/me` | - | 로그인한 사람의 SteamID·이름·아바타. 아니면 401 |

오류 코드: `login`(401), `no-key`(503), `quota`(503, 하루 Web API 한도), `user-quota`(429, 이용자별 하루 동기화 한도), `not-found`(404), `steam-failed`(502)

화면이 아닌 응답에는 보안 헤더(`nosniff`, `x-frame-options: DENY`, HTTPS면 HSTS)를, 웹 화면에는 CSP를 붙인다.

### 4.2 데이터 출처

| 출처 | 파일 | 요청 간격 | 받는 것 |
|---|---|---|---|
| Steam Store `appdetails` | `steam/store.ts` | 1.6초 (429 시 90초 정지) | 회사·장르·카테고리·출시년도·가격·메타크리틱·플랫폼·이미지. 한국 상점 우선, 없으면 미국 상점(가격은 버림) |
| 공식 상점 태그 `IStoreBrowseService/GetItems` + `IStoreService/GetTagList` | `steam/storetags.ts` | 0.3초 (429 시 60초) | 투표 가중치 순 유저 태그. 태그 이름 목록은 7일 캐시 |
| SteamSpy (비공식) | `steam/steamspy.ts` | 1.1초 (429 시 60초) | 공식 태그가 비었을 때만 보충 |
| Steam Web API | `steam/webapi.ts` | 0.12초 (429 시 30초) | `GetPlayerSummaries`, `GetOwnedGames`, `GetFriendList`, `GetSteamLevel`, `GetPlayerAchievements`, `ResolveVanityURL` |
| 업적 전 세계 달성률 | `globalAchievements.ts` | — | 게임 단위 공개 통계 (키 불필요) |
| 최다 플레이 차트 | `steam/charts.ts` | — | 인기 게임 100개 카탈로그 미리 채우기 (목록 24시간마다 갱신) |

- 일반 태그(Singleplayer, Indie, Action 등 19개)는 취향 계산을 흐려서 뺀다. 게임당 최대 12개 저장, 화면에는 6개
- 영어(`l=english`)로 받아 회사·태그 이름을 그래프에서 맞춘다

### 4.3 라이브러리 조립 (`library.ts`)

- 업적: 플레이한 게임 중 통계 공개된 것, 플레이 시간 순 **상위 80개**만 (게임마다 호출 1번). 해금 개수와 해금 기록(`achievementLog`, 해금 시각)
- 친구: 친구 맺은 순 **앞 60명**. 각자 `GetOwnedGames`를 불러 **내 라이브러리와 겹치는 게임**만 남김
- 비공개 설정 감지 → 경고로 돌려줌: `games-private`, `friends-private`, `achievements-private`
- 회사·장르·태그·출시년도·가격은 비워 두고 클라이언트가 카탈로그로 채움
- Deck 호환은 아직 `unknown` 고정

### 4.4 공통 기반 (`lib/`)

- `throttle.ts`: 호스트별 작업 줄. 최소 간격 보장, 429 받으면 `pause()`, 실패해도 줄이 끊기지 않음
- `http.ts`: 15초 타임아웃, 429 또는 본문 `null`(Store API의 한도 초과 응답)을 `RateLimitedError`로
- `cache.ts`: 메모리 + 파일(`apps/server/.cache/<ns>/<key>.json`) 캐시
  - 카탈로그 7일 (형식 버전 `SCHEMA = 2`가 바뀌면 다시 받음), 실패한 앱은 10분 뒤 재시도, 태그를 못 받은 항목은 캐시하지 않음
  - 라이브러리 10분, `refresh=1`로 무시 가능(같은 계정은 1분에 한 번까지). 디스크의 라이브러리 캐시는 20분 지나면 삭제
  - 같은 요청이 동시에 오면 하나로 합침(inflight 맵)
  - `CACHE_DIR`로 위치 변경 (배포에서는 영구 디스크)

### 4.5 로그인·호출량 (`auth.ts`, `steam/quota.ts`)

- Steam OpenID 2.0 로그인. 세션은 `SESSION_SECRET`으로 서명한 쿠키(30일), DB 없음
- `PUBLIC_MODE=1`이면 로그인한 본인 계정만 조회 (`?user=`·`STEAM_TEST_USER` 무시)
- Web API 하루 호출 수를 세어 한도(100,000)의 80%에서 경고, 95%에서 멈춤. 기록은 3일 보관
- 이용자별 하루 새 동기화 횟수 제한 (`USER_DAILY_SYNCS`, 기본 10)
- 로그에서 API 키·SteamID를 가림
- 환경 변수 전체는 [DEPLOY.md](DEPLOY.md) §2, `.env.example`

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

### 5.3 RDF (`rdf.ts`) — 화면에서는 쓰지 않음

- `vocabularyTurtle()`: 온톨로지(TBox) Turtle
- `nodeTurtle(graph, id)`: 한 노드 중심 Turtle (나가는 트리플 + 들어오는 트리플 최대 12개). 친구 IRI는 `svd:friend-<순번>`, 닉네임 생략
- 외부 라이브러리 없는 최소 구현
- 온톨로지 탭과 노드 상세의 Turtle 패널을 `843beb6`에서 뺐다. 함수는 남아 있지만 지금은 web·server 어디서도 부르지 않는다

### 5.4 고지 문구 (`legal.ts`)

- 비제휴 고지(`LEGAL_NOTICE`)와 데이터 출처 목록(`DATA_SOURCES`)의 단일 원천. 정보 패널과 차트·시그널·업적 화면 하단이 여기서 가져간다 (STEAM_COMPLIANCE §7)

## 6. 프론트엔드 (`apps/web`)

### 6.1 공통

- **상단 바**: 로고, 데이터 출처 전환(내 계정 / 샘플 / 시연, 브라우저에 기억), 상태 표시, 탭 6개, KPI(보유·총 시간·백로그 비율·최근 2주·친구), **오늘 뭐 하지** 버튼, 정보 버튼, 플레이어 이름·레벨, 로그인·로그아웃
- **데이터 출처**:
  - 내 계정: 로그인한 본인(공개 모드) 또는 `STEAM_TEST_USER`(개발). 로그인이 필요하면 Valve 제공 "Sign in through Steam" 버튼(`Session.tsx`)
  - 샘플: `data/sampleLibrary.ts`. 게임 정보는 상점 카탈로그로 덮어씀
  - 시연: 스크린샷·발표용. 샘플만 쓰고 플레이어·친구 이름을 가리며(`anonymize`) 게임 이미지를 끔. 상점에 묻지 않음
- **오늘 뭐 하지** (`Roulette.tsx`): 잠든 게임(백로그·찍먹) 룰렛. 많이 한 게임과 닮았거나 친구가 가진 게임일수록 잘 뽑힘. 닮은 게임에 쓴 평균 시간을 예상 플레이 시간으로 보여 줌. "이건 패스"로 다시 돌리기, 뽑힌 게임은 탐색기에서 열기
- **정보 패널** (`About.tsx`): 비제휴 고지, 데이터 출처, 개인정보 처리 요약·운영자 연락처, 이미지 설정, 내 데이터 지우기(서버 캐시 + 브라우저 저장소)
- **설정** (`lib/settings.ts`): 게임 이미지 표시(끄면 모든 화면이 대체 카드·점), 탐사 행성을 표지로 그리기(개인용, 기본 꺼짐). 공개 빌드(`VITE_PUBLIC_BUILD=1`)에서는 표지 행성 옵션을 숨김
- **게임 이미지** (`GameImage.tsx`): 이미지를 껐거나 권리자 요청으로 차단된 게임은 appid로 정한 고정 색의 대체 카드. 원본은 잘라서 보여 주기만 함
- **상태 표시**: `STEAM LIVE`, `STORE SYNC n/m`(상점 정보 받는 중), `LOADING`, `OFFLINE`, `SAMPLE · 계정 연결 안 됨`(이유는 툴팁), 비공개 경고 배지
- **데이터 흐름** (`data/useLibrary.ts`):
  1. 내 계정이면 `/api/library`, 실패하면 샘플로 대체하고 이유 표시
  2. 보유 게임 appid로 `/api/catalog`를 4초마다 조회, 상점 정보로 게임 정보를 덮어씀
  3. 받는 중에는 15개 쌓일 때마다만 그래프를 다시 만듦 (화면 흔들림 방지)
  4. 서버가 꺼져 있으면 15초마다 다시 시도
- 탐색기 외 화면과 룰렛은 지연 로딩
- 샘플 데이터: `data/sampleLibrary.ts`, `data/samplePrices.ts`
- 브라우저 저장소(localStorage): 데이터 출처 선택, 설정, 탐사 기록(방문 행성·완료 퀘스트, 계정별)

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
- 상세 패널(`NodeDetail`): 관계를 방향별 이름으로, 가격·할인, 시간당 가격("본전"), 업적, 병합된 회사 표기, Steam 상점 링크, 보유한 플레이어. Turtle 패널은 `843beb6`에서 뺐다

### 6.3 02 탐사 (`VoyageView.tsx`, `views/voyage/`)

위에서 내려다보는 2D 도트 우주를 탐사선으로 날아다니는 화면. 3D 우주 뷰를 대체했다.

- **세계** (`world.ts`): 섹터 = 취향 군집, 행성 = 게임(반지름 = 플레이 시간). 섹터 안은 해바라기 씨 배열, 섹터끼리는 나선 배치. 난수 없이 같은 데이터면 같은 배치
- **그래픽** (`sprites.ts`): 외부 그림 없이 코드로. 행성은 코드로 만든 무늬에 베이어 디더링 음영(표지 옵션을 켜면 표지를 원으로 잘라 색 수를 줄여 씀), 성운은 값 노이즈, 탐사선은 문자열 도트 그림. 저해상도 버퍼에 그려 3배로 키움(보간 없음). 글자는 원래 해상도로
- **조작**: WASD 비행, Shift 부스트, 클릭 자동 비행, E 도킹(행성 정보), 1–9 섹터 워프, M 미니맵, Esc 정지
- **백로그 안개**: 한 번도 안 한 게임은 안개 + 물음표. 가까이 가면 안개가 걷힘
- **탐사율**: 처음 가까이 간 행성을 기록, 100% 달성 알림. 계정별로 브라우저(localStorage)에 저장
- **퀘스트 비콘** (`quests.ts`): 백로그·찍먹 게임 중 많이 한 게임(10시간 이상)과 닮았거나 친구가 가진 게임을 추천. 이유 문구 표시, 건너뛰기 가능
- **친구 탐사선** (`friends.ts`): 최대 12척. 친구와 같이 가진 게임 주위를 돌다가 다른 공유 게임으로 옮겨 감(많이 한 게임일수록 자주). 가까이 가면 인사 알림
- **미니맵** (`minimap.ts`): 섹터 성운은 한 번만 그리고 매 프레임 행성(방문 여부로 밝기)·탐사선·시야·목적지·친구·퀘스트를 덧그림. 섹터(장르) 이름표, 클릭하면 그 지점으로 비행
- **왼쪽 패널**: 워프 맵(섹터별 방문 수), 현재 퀘스트 카드, 친구 목록. **오른쪽 위**: 탐사율 게이지·남은 안개 수·좌표·속도
- 행성 표지 그리기는 설정에서 켜는 개인용 옵션(기본 꺼짐, 공개 빌드에는 없음). 꺼져 있으면 원본 표지는 도킹 패널에서만 보여 줌
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

### 6.5 04 시그널 (`SignalView.tsx`, `views/signal/`)

관계를 따라 흐르는 네 장의 차트. 집계는 `signal/data.ts`.

| 이름 | 파일 | 내용 |
|---|---|---|
| 취향 코드 | `TasteChord.tsx` | 많이 한 태그 8개가 같은 게임 안에서 얼마나 얽혀 있는지. 리본 두께 = 두 태그를 모두 가진 게임의 플레이 시간 합 |
| 시간의 궤도 | `GenreSunburst.tsx` | 안쪽부터 장르 → 개발사 → 게임 선버스트. 각도 = 플레이 시간. 장르 7개까지 색, 나머지는 '기타'(회색). 게임을 누르면 탐색기로 |
| 시대의 군집 | `EraSwarm.tsx` | 출시 연도 축 비스웜 (점 크기 = 플레이 시간). 2시간 이상은 채운 점, 백로그·찍먹은 빈 점. 시간이 가장 몰린 5년 구간 강조 |
| 잠든 게임의 흐름 | `SleepFlow.tsx` | 유통사 → 장르 → 플레이 상태 생키. 띠 두께 = 게임 수. 잠든 비율이 가장 높은 회사(게임 3개 이상) 표시 |

### 6.6 05 성단 (`ConstellationView.tsx`)

- 게임 = 카트리지, 무리 = 서로 녹아 붙는 빛무리(메타볼), 추천(유사 게임) = 실선 위를 지나가는 빛 알갱이. d3-force, 화면 전체
- **묶음 기준**: 취향 성단 · 장르 · 출시 시대 · 플레이 상태. 무리의 기준점은 화면 가운데를 둘러싼 타원 위
- **크기 기준**: 플레이 시간 · 최근 2주 · 업적
- **연결 기준**: 연결할 최소 유사도 슬라이더
- 검색(게임 찾기), 확대·이동, 선택 패널, 선택한 무리에 집중
- 기준을 바꿔도 시뮬레이션은 그대로 두고 힘만 갈아 끼워 위치가 이어진다

### 6.7 06 업적 (`AchievementsView.tsx`, `views/achievements/`)

- **업적 활동 캘린더** (`AchievementCalendar.tsx`): 업적 해금 시각으로 날짜별 잔디를 칠한다(이 컴퓨터 시간대 기준). 연도 선택, 연도별 막대, 연속·최다일 통계. 그 해 분포로 5단계 구간을 나눔. 플레이 시간 기록이 없는 과거도 업적으로 복원된다
- **희귀 업적 쇼케이스** (`RareShowcase.tsx`): 내가 깬 업적을 전 세계 달성률 낮은 순으로. 등급(전설·희귀·드묾·보통)은 색이 아니라 글자로 구분. 달성률은 `/api/achievements/global`에서 받고, 샘플·시연은 지어낸 달성률을 써서 서버에 묻지 않음

## 7. 기획(PLAN.md)과 다른 점

| 기획 | 현재 | 비고 |
|---|---|---|
| Steam OpenID 로그인 + 세션 | OpenID 로그인 + 서명 쿠키 세션 (DB 없음). 개발 중에는 `STEAM_TEST_USER`도 | |
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
| 1. MVP (M1·M2) | 대부분 | 그래프 탐색기·차트·시그널·성단·라이브러리 KPI·Steam 로그인·배포 구성 있음. DB·워커·실제 배포 없음. 트리맵은 보로노이로 대체 |
| 2. 업적·시간 (M3·M8) | 일부 | 업적 해금 시각 캘린더·희귀 업적(전 세계 달성률) 있음. 스냅샷·플레이 시간 추이 없음 |
| 3. 사람·돈·세상 (M4~M7) | 일부 | 친구 공유 게임·지문 비교·친구 탐사선·가격·잠든 게임 금액 있음. 위시리스트·동시접속·뉴스·배지 없음 |
| 4. 온톨로지 심화 | 일부 | 추론 2개, 회사명 정규화, 병합된 표기 표시. Turtle 화면은 사용자에게 필요 없어 제거. SPARQL·병합 UI·JSON-LD 없음 |
| 5. 공유·확장 | 일부 | 유사 게임 추천(퀘스트·빙산·룰렛), 시연 모드. 페르소나 카드 없음 |

## 9. 알려진 문제·할 일

- [x] `README.md` 갱신: 실계정 연결·`.env` 설정, 화면 6개, 문서 목록
- [x] 온톨로지 탭·노드 Turtle 패널 제거 (사용자에게 필요 없음)
- [ ] `packages/shared/src/rdf.ts`를 아무도 쓰지 않음 → 내보내기 기능을 다시 만들지 않으면 삭제 검토
- [ ] 게임이 많은 계정에서 탐사·성단 화면 성능 확인 (지금은 샘플과 게임 4개 계정으로만 확인)
- [ ] 프랜차이즈 데이터 출처 없음 (샘플에만 있음)
- [ ] Deck 호환 정보 없음 (`unknown` 고정)
- [ ] 친구 60명·업적 80게임 상한: 큰 계정은 첫 로딩이 느리고 일부가 빠짐
- [ ] 첫 상점 동기화가 게임 수 × 약 1.6초 이상 걸림 (게임 300개면 8분 이상)
- [ ] 탐사 기록(방문 행성·완료 퀘스트)·데이터 출처 선택이 브라우저 localStorage에만 있음 — 다른 기기로 이어지지 않음
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
