---
uid: 0ec6c8ab-ad6d-4631-9d4a-571f6a3f17c4
kind: element
title: 규약 위반 소지 개선 계획
domain: docs
---

# 규약 위반 소지 개선 계획

> 작성: 2026-11-18 · 기준 커밋 `31cd4ea` · 상태: **1~11 조치 완료 (2026-11-18)**, 12(P2 설계 메모)는 공개 서비스 단계에서
>
> [STEAM_COMPLIANCE.md](STEAM_COMPLIANCE.md) 9장 점검 결과 중 **앱 이름(T4)을 뺀** 나머지를 고치는 계획이다. 이름 변경은 따로 한다.

---

## 0. 우선순위 기준

| 등급 | 뜻 |
|---|---|
| **P0** | 혼자 로컬에서 쓰는 지금도 걸리거나, 고치는 데 비용이 거의 안 드는 것. 바로 한다 |
| **P1** | 다른 사람이 쓰거나 보기 전(웹 공개·앱 배포·스크린샷 홍보)에 반드시 끝낸다 |
| **P2** | 공개 서비스로 키울 때. 지금은 설계만 정해 둔다 |

## 1. 한눈에

| # | 항목 | 등급 | 규칙 | 크기 |
|---|---|---|---|---|
| 1 | API 키·SteamID가 로그에 남지 않게 | P0 | K2 | 작음 |
| 2 | 디스크 캐시에 남는 친구·플레이 기록 정리 | P0 | P3, P4, P9 | 작음 |
| 3 | 게임마다 Steam 상점 링크 | P0 | C5, T7 | 작음 |
| 4 | 비제휴·출처 고지 (정보 화면 + 바닥 한 줄) | P0 | T6, P8 | 작음 |
| 5 | SteamSpy 태그 출처 표시 | P0 | P8 | 작음 |
| 6 | Web API 하루 호출 수 집계·제한 | P1 | L1 | 중간 |
| 7 | 탐사 뷰 표지 변형 중단 (기본값) | P1 | C3, C4 | 작음 |
| 8 | 게임 이미지 끄기 (전체 + 게임별 차단 목록) | P1 | C7 | 중간 |
| 9 | 시연 모드 (친구 익명화 + 이미지 없음) | P1 | C2, P2 | 중간 |
| 10 | RDF 내보내기에서 친구 SteamID 빼기 | P1 | P2 | 작음 |
| 11 | 개인정보처리방침·내 데이터 지우기 | P1 | P5, P6 | 중간 |
| 12 | 공개 서비스용 설계 메모 | P2 | P2, P6, L5, M2 | 문서 |

권장 순서: **1 → 2 → 3 → 4 → 5** (P0, 반나절 안팎) → **7 → 10 → 8 → 9 → 6 → 11** (P1)

---

## 2. P0 — 바로 할 것

### 2.1 로그에서 키·SteamID 숨기기 (K2)

**문제**
- `apps/server/src/index.ts:9` Fastify 기본 로거가 들어오는 요청마다 URL을 남긴다 → `/api/library?user=<SteamID 또는 프로필 주소>`가 로그에 그대로 찍힌다
- `index.ts:59` `req.log.error(err)`가 예기치 않은 오류를 통째로 남긴다. Node `fetch`가 네트워크 오류(`TypeError: fetch failed`)를 낼 때 `cause`에 요청 정보가 딸려 올 수 있고, Web API 요청 URL에는 `?key=`가 들어 있다

**고칠 것**
- `lib/http.ts` `getJson()`: `fetch` 호출을 `try/catch`로 감싸서, 네트워크·타임아웃 오류를 **호스트만 담은 새 오류**(`UpstreamError(host, 0)` 또는 `NetworkError(host)`)로 바꿔 던진다. 원래 오류 객체는 밖으로 내보내지 않는다
- Fastify 로거 설정:
  - `serializers.req`에서 `url`의 쿼리 문자열을 지운다 (`/api/library?user=…` → `/api/library`)
  - `redact: ['req.query', 'err.cause']` 같은 안전망을 추가한다
- `webapi.ts`: 키를 쿼리에 붙이는 곳은 `call()` 한 곳뿐이다. 이 함수 밖으로 URL 문자열이 나가지 않는다는 주석을 남긴다

**확인**
- 키를 일부러 틀리게 넣고, 인터넷을 끈 상태로 `/api/library`를 불러 로그 전체에 `key=`와 SteamID가 없는지 `grep`
- `npm run typecheck`

### 2.2 디스크 캐시 정리 (P3, P4, P9)

**문제**
- `lib/cache.ts`는 TTL을 **읽을 때만** 본다. 파일은 지우지 않는다 → `apps/server/.cache/library/<steamid>.json`에 친구 60명의 이름·SteamID·플레이 시간이 기간 제한 없이 쌓인다
- 다른 계정을 한 번이라도 조회하면 그 계정의 기록도 남는다

**고칠 것**
- `cache.ts`에 `cachePurge(ns, maxAgeMs)` 추가: 오래된 파일을 지운다
- 서버 시작 시와 1시간마다: `library`는 **TTL의 2배(20분)가 지나면 삭제**. `store`·`meta`(게임 사실 정보)는 그대로 둔다
- `DELETE /api/library?user=` 추가: 그 계정의 라이브러리 캐시를 메모리와 디스크에서 즉시 지운다 (11번 "내 데이터 지우기"에서 씀)
- 캐시 파일 이름에 SteamID가 그대로 들어가는 점은 로컬 전용이라 지금은 둔다. 공개 서비스로 가면 DB로 옮기며 다시 본다 (12번)

**확인**
- 캐시 파일 시각을 과거로 바꾸고(`touch -t`) 서버를 재시작했을 때 지워지는지
- `DELETE` 호출 뒤 같은 계정 조회가 새로 받아 오는지

### 2.3 Steam 상점 링크 (C5, T7)

**문제**: 게임 이미지를 여러 화면에서 보여 주지만, 원래 출처인 상점으로 가는 길이 없다.

**고칠 것**
- `packages/shared`에 `steamStoreUrl(appid)` → `https://store.steampowered.com/app/<appid>/` 추가
- `components/NodeDetail.tsx` 게임 머리 부분(180행 근처)에 "Steam 상점에서 보기" 링크
  - `target="_blank" rel="noopener noreferrer"` — **`nofollow`는 넣지 않는다** (T7)
  - 링크 글자는 일반 텍스트. Steam 로고·아이콘을 쓰지 않는다 (T1)
- 탐사 뷰 도킹 패널도 `NodeDetail`을 쓰므로 자동으로 따라온다
- Electron으로 옮기면 이 링크는 기본 브라우저로 열리게 한다 (ELECTRON.md의 `setWindowOpenHandler`)

**확인**: 탐색기·탐사 도킹·차트에서 연 상세 패널 모두에 링크가 보이고, 새 탭으로 해당 게임 페이지가 열리는지

### 2.4 비제휴·출처 고지 (T6, P8)

**고칠 것**
- `apps/web/src/components/About.tsx`(새 파일): STEAM_COMPLIANCE.md §7 고지 문구 전문(한/영), 데이터 출처 목록(Steam Web API, Steam 상점, SteamSpy), "Steam 데이터는 있는 그대로 제공" 문장
- 상단 바 오른쪽에 작은 "정보" 버튼 → 위 내용을 패널로
- 화면 아래 한 줄은 화면을 가리므로 넣지 않는다. 대신 차트 리포트(`ChartView`) 맨 아래와 About 패널에 둔다
- 문구는 한 곳(`packages/shared/src/legal.ts`)에 상수로 두고 웹·Electron 정보 창이 같이 쓴다

**확인**: About 패널 문구가 STEAM_COMPLIANCE.md §7과 글자 그대로 같은지

### 2.5 SteamSpy 태그 출처 표시 (P8)

**문제**: 서버는 `StoreApp.sources`에 `'steamspy'`를 기록하지만, `data/useLibrary.ts`의 `mergeCatalog()`가 이 정보를 버린다. 추정치인 SteamSpy 태그가 공식 태그와 구별 없이 보인다.

**고칠 것**
- `GameRecord`에 `tagSource?: 'store' | 'steamspy'` 추가 (`packages/shared/src/types.ts`)
- `mergeCatalog()`에서 `a.sources`를 보고 채운다
- `NodeDetail` 태그 목록 옆에 `tagSource === 'steamspy'`일 때만 "SteamSpy 추정" 작은 표시

**확인**: 공식 태그가 없는 게임(서버 로그나 캐시의 `sources`로 찾음)에서 표시가 뜨는지

---

## 3. P1 — 공개 전에 끝낼 것

### 3.1 탐사 뷰 표지 변형 중단 (C3, C4)

**문제**: `views/VoyageView.tsx:203-208`이 게임 표지(`header`)를 불러와 `voyage/sprites.ts` `planetSprite()`에서 원으로 자르고, 색을 줄이고, 디더링한다. 퍼블리셔 그림을 **변형**하는 것이라 공정이용 주장에 가장 불리하다.

**결정**: 기본은 **표지 없는 행성**, 원본은 도킹 패널에서만 보여 준다.
- `planetSprite()`는 이미지가 없을 때 섹터 색 띠무늬 행성을 그리는 대체 경로가 이미 있다 → 이미지를 넘기지 않으면 된다
- 행성마다 다르게 보이도록 대체 무늬를 조금 늘린다: 태그·장르로 정한 무늬(띠·점·고리·크레이터), appid 시드로 정한 색 변화
- 도킹 패널(`NodeDetail`)은 원본 표지를 **바꾸지 않고** 보여 준다 → 게임을 알아보는 기능은 유지
- 로컬 개인 사용을 위해 설정에 "표지로 행성 그리기 (개인용)" 토글을 남기되, 기본값은 꺼짐. 공개 빌드에서는 토글 자체를 숨긴다 (`import.meta.env.VITE_PUBLIC_BUILD`)

**확인**
- 기본 상태에서 탐사 뷰가 `cdn.*.steamstatic.com`에 이미지 요청을 보내지 않는지 (DevTools 네트워크)
- 도킹 패널에는 표지가 보이는지

### 3.2 RDF 내보내기에서 친구 SteamID 빼기 (P2)

**문제**: `packages/shared/src/rdf.ts`의 `nodeTurtle()`가 노드 id로 IRI를 만든다. 친구 노드의 id에 SteamID가 들어가면, 상세 패널의 "Turtle 복사"로 친구 SteamID와 닉네임이 클립보드를 거쳐 밖으로 나간다.

**고칠 것**
- 친구(본인이 아닌 Player) IRI는 SteamID 대신 `svd:friend-<순번>`처럼 그래프 안에서만 의미 있는 id로 만든다
- 친구 노드의 `rdfs:label`(닉네임)은 내보내지 않는다. 시연 모드(3.4)가 아니어도 같다
- 본인 노드는 그대로 둔다 (본인 데이터)

**확인**: 친구 노드와, 친구와 연결된 게임 노드의 Turtle에 17자리 숫자와 친구 닉네임이 없는지

### 3.3 게임 이미지 끄기 (C7)

**문제**: 퍼블리셔가 이미지 사용을 문제 삼으면 그 게임만 빨리 끌 방법이 없다. 이미지는 `steamImage()` 하나를 거쳐 탐색기(Sigma 노드 이미지), 상세 패널, 차트 4종(`EmpireMap` SVG `<image>`, 툴팁 캡슐 등)에서 쓰인다.

**고칠 것**
- `steamImage()`가 `string | undefined`를 돌려주게 바꾸고, 쓰는 곳을 모두 "이미지 없음" 대체 표시(클래스 색 원, 제목 글자 카드)로 처리
- 끄는 조건 두 가지:
  - 전체 끄기: 사용자 설정 "게임 이미지 표시" (기본 켜짐, localStorage)
  - 게임별 차단: 서버 `GET /api/health`(또는 `/api/config`)가 `blockedImageAppids` 목록을 내려 준다. 목록은 저장소의 `apps/server/blocked-images.json`
- 탐색기: Sigma 노드 타입을 이미지 없을 때 `glow`로 바꾸는 분기가 이미 있다 (`ExplorerView.tsx:386`) → 같은 분기에 조건 추가

**확인**: 차단 목록에 appid 하나를 넣고, 모든 화면에서 그 게임 이미지 요청이 사라지는지 (네트워크 탭에서 appid로 검색)

### 3.4 시연 모드 (C2, P2)

README·홍보·발표용 스크린샷을 안전하게 찍기 위한 모드.

**고칠 것**
- 상단 데이터 출처 전환에 세 번째 값 `demo` 추가, 또는 About 패널의 토글
- 켜면:
  - 데이터는 샘플(`sampleLibrary`)만 쓴다. 실제 계정 데이터는 불러오지 않는다
  - 친구 이름은 "친구 A, 친구 B…"로, 플레이어 이름은 "플레이어"로
  - 게임 이미지 전체 끄기(3.3) 강제
  - 화면 구석에 "DEMO" 표시
- `docs/` 또는 README에 넣는 스크린샷은 이 모드로만 찍는다는 규칙을 STEAM_COMPLIANCE.md C2 옆에 덧붙인다

**확인**: 시연 모드에서 네트워크 탭에 `/api/library` 요청과 steamstatic 이미지 요청이 없는지, 화면에 실제 닉네임이 없는지

### 3.5 Web API 하루 호출 수 (L1)

**문제**: 한 번 동기화에 Web API를 대략 `1(본인) + 1(보유 게임) + 1(친구 목록) + 1(레벨) + 업적 최대 80 + 친구 요약 1 + 친구 보유 게임 최대 60` ≈ **최대 145회** 부른다. 혼자서는 한도(10만)에 멀지만, 공개하거나 `refresh=1`을 반복하면 셀 수 없다.

**고칠 것**
- `steam/webapi.ts` `call()`에서 호출할 때마다 카운터 증가. 날짜(UTC) 단위로 `cache/meta/webapi-usage-<날짜>.json`에 저장 (재시작해도 이어지게)
- `/api/health`에 `{ webapiCallsToday, limit: 100000 }` 추가 (키 값은 여전히 안 보냄)
- 80%에서 경고 로그, **95%에서 새 라이브러리 동기화를 거절**(`503 { error: 'quota' }`)하고 캐시만 준다. 웹은 상태 표시에 "오늘 호출 한도에 가까움"
- `refresh=1`은 같은 계정에 대해 1분에 한 번만 받아들인다

**확인**: 한도 상수를 작게(예: 200) 바꿔 두 번 동기화했을 때 거절되고 화면에 이유가 뜨는지

### 3.6 개인정보처리방침·내 데이터 지우기 (P5, P6)

**고칠 것**
- `docs/PRIVACY.md` 초안: 받는 정보(본인 공개 프로필·보유 게임·플레이 시간·업적 수, 친구의 닉네임·친구 맺은 날·겹치는 게임의 플레이 시간), 출처(Steam Web API), 저장 위치와 기간(로컬 캐시 20분 뒤 삭제), 제3자 제공 없음, 지우는 방법, 문의처
- 배포 형태에 따라 저장 위치 문장이 달라진다:
  - 데스크톱 앱: "모든 데이터는 이 컴퓨터의 `userData` 폴더에만 저장" — 서버로 보내지 않으므로 가장 단순
  - 웹 서비스: 서버 위치(국가)를 명시해야 한다 (API 약관)
- About 패널에 처리방침 보기 + **"내 데이터 지우기"** 버튼 → 2.2의 `DELETE /api/library` + 탐사 기록·설정 localStorage 삭제

**확인**: 버튼을 누른 뒤 캐시 폴더에 라이브러리 파일이 없고, 탐사율이 0으로 돌아가는지

---

## 4. P2 — 공개 서비스로 갈 때 (설계 메모)

지금은 만들지 않는다. 방향만 정해 둔다.

- **로그인**: ~~Steam OpenID만. 로그인한 본인 계정만 조회~~ → **완료 (2026-11-18)**: `auth.ts`, `PUBLIC_MODE=1`이면 본인만 조회, `?user=`·`STEAM_TEST_USER` 무시
- **친구 데이터**: 공개 프로필·공유 카드에는 집계 숫자만. 친구 본인이 처리 정지를 요청하면 그 SteamID를 수집 제외 목록에 넣는다 (개인정보 보호법 제20조)
- **저장**: 파일 캐시를 DB로 옮길 때 친구 데이터는 별도 테이블 + 짧은 보존 기간 + 계정 삭제 시 연쇄 삭제
- **호출량**: 키 하나의 하루 10만 회를 사용자들이 나눠 쓴다 → 3.5의 카운터를 사용자별 할당으로 확장
- **상업화**: 광고·후원을 붙이기 전에 STEAM_COMPLIANCE.md M2에 따라 전문가 검토

## 5. 이미 괜찮아서 고치지 않는 것

| 항목 | 이유 |
|---|---|
| 탐색기 게임 노드의 원형 표지, 차트의 표지 잘라 넣기 | 원본을 자르거나 줄여서 보여 줄 뿐 그림을 바꾸지 않는다. 게임을 알아보게 하는 썸네일 용도. 3.3의 끄기로 대응 가능 |
| 이미지를 Steam CDN에서 바로 불러오기 | 저장·재배포하지 않는다 (C1) |
| 친구 이름이 본인 화면(취향 지문, 친구 탐사선 인사)에 보임 | 요청한 본인 화면에서만 보인다 (P2 허용 범위). 시연 모드에서만 익명화 |
| 샘플 데이터의 실제 게임 이름·회사 | 사실 정보 (C6) |
| 직접 그린 로고, 코드로 만든 도트 그래픽 | 남의 IP를 쓰지 않음 (T1, C8) |

## 6. 끝나면

- [x] STEAM_COMPLIANCE.md 9장 점검 표의 상태를 갱신
- [x] PROGRESS.md 9장 할 일 목록에서 해당 항목 체크
- [ ] 커밋 (아직 안 함)

## 7. 조치 결과 (2026-11-18)

| # | 결과 | 확인한 방법 |
|---|---|---|
| 1 | `lib/http.ts` 오류를 호스트·상태만 담은 `UpstreamError`로 교체(네트워크 0, JSON 아님 -1). Fastify `serializers`로 요청 로그는 경로만, 오류는 이름·메시지·스택만 | 가짜 키로 `/api/library` 실패 → 로그에 키·SteamID 0건. 닿지 않는 주소·타임아웃 오류도 메시지에 URL 없음 |
| 2 | `cachePurge`·`cacheDelete` 추가. 라이브러리 캐시 20분 뒤 삭제(시작 시·매시간). `DELETE /api/library` | 과거 시각 파일이 서버 시작 직후 삭제됨. `DELETE` 200 |
| 3 | `steamStoreUrl()`, 상세 패널 머리에 링크 | `rel="noopener noreferrer"`, `nofollow` 없음 |
| 4 | `packages/shared/src/legal.ts`, `components/About.tsx`(상단 `i`), 차트 리포트 하단 | 화면에서 문구 확인 |
| 5 | `GameRecord.tagSource` → 상세 패널 "SteamSpy 추정" 배지 | 타입 검사 (실제 SteamSpy 태그 게임은 실계정 연결 후 확인) |
| 6 | 탐사 행성 기본은 표지 없음. 무늬 4종(띠·크레이터·소용돌이·대륙)과 행성별 색 변화. 표지 행성은 정보 패널의 개인용 토글, `VITE_PUBLIC_BUILD=1`이면 숨김 | 탐사 탭을 열어도 steamstatic 요청 0건, 화면 확인 |
| 7 | Turtle 내보내기에서 친구 IRI는 `svd:friend-<순번>`, 닉네임 생략 | 샘플 그래프의 친구·친구가 가진 게임·본인 노드 Turtle에 친구 SteamID·닉네임 0건 |
| 8 | `steamImage()`가 정책에 따라 `undefined`. `GameImage` 대체 카드, 탐색기는 빛나는 점, 영토 지도는 색 면. `GET /api/config` + `apps/server/blocked-images.json` | 이미지 끄기 상태에서 탐색기·상세·차트 steamstatic 요청 0건, `<img>` 0개, 콘솔 오류 없음 |
| 9 | 데이터 출처 `시연`: 샘플만, 이름 가림, 이미지 끔, DEMO 표시 | `/api/*` 요청 0건, 이미지 요청 0건, 친구 이름이 "친구 A~F" |
| 10 | `steam/quota.ts`: 날짜별 집계·저장, 80% 경고, 95% 거절, `/api/health`에 표시. 강제 새로고침 1분 제한 | 사용량 99,000으로 두고 `/api/library` → `503 quota` |
| 11 | 정보 패널의 개인정보 요약 + 내 데이터 지우기, [PRIVACY.md](PRIVACY.md) 초안 | 화면 확인 |

`npm run typecheck` 통과 (web·server).
