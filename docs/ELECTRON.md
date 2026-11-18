---
uid: 314496ec-6427-4afd-a0e6-75e383e01fd2
kind: element
title: Electron 데스크톱 앱 전환 계획
domain: docs
---

# Electron 데스크톱 앱 전환 계획

> 상태: **보류 — 선택 사항** (2026-11-18 작성). 배포는 공개 웹 서비스로 가기로 했다. Electron은 하지 않을 수도 있다.
>
> 하게 되면: 로그인은 서버의 Steam OpenID(`/api/auth/steam/*`)를 그대로 쓰되, Steam 로그인 페이지는 앱 창이 아니라 기본 브라우저로 연다
>
> 목표: 지금의 웹앱(`apps/web`)과 API 서버(`apps/server`)를 그대로 살려 macOS 데스크톱 앱(`.dmg`)으로 감싼다

---

## 1. 지금 구조에서 출발점

| 항목 | 현재 | 관련 파일 |
|---|---|---|
| 웹 → API 호출 | 상대 경로 `fetch('/api/...')` | `apps/web/src/data/useLibrary.ts` |
| 개발 중 API 연결 | Vite가 `/api` 를 `127.0.0.1:8787` 로 프록시 | `apps/web/vite.config.ts` |
| 서버 시작 | 파일 끝에서 최상위 `await app.listen()` 바로 실행 | `apps/server/src/index.ts` |
| 설정 | 저장소 루트 `.env` 읽음 (`STEAM_API_KEY`, `STEAM_TEST_USER`, `PORT`, `HOST`) | `apps/server/src/env.ts` |
| 캐시 | `apps/server/.cache` | `apps/server/src/env.ts` (`cacheDir`) |
| 서버 실행기 | `tsx` (TS를 바로 실행) | `apps/server/package.json` |

웹이 상대 경로로만 API를 부르기 때문에, **화면과 API를 같은 출처(origin)에서 내보내면 웹 코드는 고칠 게 거의 없다.**

## 2. 구조

Electron 메인 프로세스 안에서 Fastify 서버를 띄우고, 창은 그 서버 주소를 연다.

```
Electron 메인 프로세스
 ├─ Fastify 서버 시작 (127.0.0.1, 빈 포트 자동 선택)
 │    ├─ /api/*  → 지금 라우트 그대로
 │    └─ /*      → apps/web/dist 정적 파일 (배포판에서만, SPA 폴백 index.html)
 └─ BrowserWindow
      ├─ 개발: http://localhost:5173 (Vite, HMR 유지 — Vite 프록시가 /api 를 서버로 넘김)
      └─ 배포: http://127.0.0.1:<포트>
```

- 같은 출처라 CORS 설정 불필요
- Steam API 키는 지금처럼 Node 쪽에만 있고 렌더러로 넘어가지 않는다
- 대안: 서버를 `utilityProcess` 로 따로 띄우기. API가 가벼워서 지금은 필요 없음. 메인 프로세스가 버벅이면 그때 분리

## 3. 작업 순서

### 3.1 서버를 import 가능한 함수로 분리

- `apps/server/src/server.ts` 에 `export async function startServer(opts)` 를 만든다
  - `opts`: `{ port, host, staticDir?, dataDir, steamApiKey?, testUser? }`
  - 반환: `{ app, url }` (port 0 이면 실제 할당된 포트를 담은 url)
- 라우트 등록 코드는 그대로 옮긴다
- `staticDir` 가 있으면 `@fastify/static` 으로 서빙하고, `/api` 가 아닌 404는 `index.html` 로 돌린다
- `apps/server/src/index.ts` 는 `env` 를 읽어 `startServer()` 를 부르는 얇은 진입점으로 남긴다 → `npm run dev:api` 동작 유지
- 실패 시 `process.exit(1)` 대신 예외를 던지게 (Electron 쪽에서 오류 창 표시)

### 3.2 경로·설정을 주입식으로 (중요)

패키징하면 앱 번들 안은 **읽기 전용**이고, 저장소 루트도 없다.

- `env.ts` 의 `ROOT`, `cacheDir` 를 모듈 상수로 두지 말고 `startServer()` 인자로 받는다
- Electron에서는 `app.getPath('userData')` 아래를 쓴다
  - 예: `~/Library/Application Support/Steamverse/cache/`
  - 예: `~/Library/Application Support/Steamverse/settings.json`
- `.env` 는 배포판에 넣지 않는다. API 키·Steam 사용자는 앱 안에서 입력받아 `userData` 에 저장
  - 키 저장은 `safeStorage.encryptString()` (macOS 키체인 기반)으로 암호화
  - 설정 화면은 렌더러, 저장은 메인 프로세스 → preload 로 좁은 IPC 몇 개만 노출 (`getSettings`, `saveSettings`)
  - 키 값은 렌더러로 돌려주지 않고 "있음/없음" 만 (지금 `/api/health` 원칙과 동일)
  - 저장 후 서버 설정을 갱신하거나 서버 재시작
- 개발 모드에서는 지금처럼 루트 `.env` 를 계속 읽어도 됨

### 3.3 `apps/desktop` 워크스페이스 추가

```
apps/desktop/
  package.json        # electron, electron-builder, esbuild
  src/main.ts         # 서버 시작 → BrowserWindow
  src/preload.ts      # contextBridge 로 설정 IPC만 노출
  electron-builder.yml
```

`main.ts` 할 일:
- `app.whenReady()` → `startServer({ port: 0, host: '127.0.0.1', staticDir, dataDir })`
- `BrowserWindow` 보안 옵션: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- 최소 크기 1280px 폭 (기획서의 데스크톱 기준과 맞춤)
- 외부 링크(Steam 상점 등)는 `setWindowOpenHandler` 에서 `shell.openExternal` 로 기본 브라우저에 넘김
- `will-navigate` 로 앱 주소 밖 이동 차단
- 단일 인스턴스: `app.requestSingleInstanceLock()`
- 종료 시 `app.close()` 로 서버 정리
- 개발/배포 구분: `app.isPackaged` 또는 `VITE_DEV_SERVER_URL` 환경변수

### 3.4 빌드

- 서버는 지금 `tsx` 로 실행 → 배포판에선 esbuild 로 `main.ts` + 서버 코드 + `@steamverse/shared` 를 CJS/ESM 번들 하나로 묶는다 (`platform: 'node'`, `external: ['electron']`)
- 순서: `npm run build -w @steamverse/web` → esbuild 로 main/preload 번들 → `electron-builder --mac`
- `web/dist` 는 `extraResources` 또는 `files` 로 포함하고, 런타임엔 `process.resourcesPath` 기준으로 찾는다
- 패키징 도구: **electron-builder** (설정이 단순). Forge 로 바꿀 이유가 생기면 그때

### 3.5 스크립트

루트 `package.json` 에 추가:

| 스크립트 | 동작 |
|---|---|
| `dev:desktop` | Vite 실행 → 준비되면 Electron이 `localhost:5173` 을 연다 (서버는 Electron 안에서) |
| `build:desktop` | 위 3.4 순서대로 `.dmg` 생성 |

`dev:desktop` 에서는 Electron 안 서버가 8787 을 써야 Vite 프록시가 붙는다 (개발 모드에선 port 0 대신 8787 고정).

## 4. 시작 전에 확인할 것

- [ ] `npm install-scripts approve esbuild` — 지금 esbuild postinstall 이 승인 안 돼서 실행되지 않았다. Electron 번들링에 필요
- [ ] Electron 바이너리도 postinstall 로 내려받으니 `electron` 도 승인 필요할 수 있음
- [ ] `npm audit` 에 high 5건 있음 — 패키징 전에 한 번 확인
- [ ] 코드 서명·공증(notarization): 나 혼자 쓰면 생략 가능. 남에게 배포하려면 Apple Developer 계정 필요

## 5. 완료 기준

- [ ] `npm run dev:api` / `npm run dev` 가 지금처럼 그대로 동작
- [ ] `npm run dev:desktop` 으로 창이 뜨고 HMR 동작
- [ ] 배포판 `.dmg` 설치 후 저장소 없이 실행됨
- [ ] 앱 안에서 API 키·사용자 입력 → 라이브러리 화면 동작
- [ ] 캐시·설정이 `~/Library/Application Support/Steamverse/` 에 생김
- [ ] 외부 링크가 기본 브라우저로 열림
