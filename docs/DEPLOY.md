---
uid: 68264e8f-4c1d-4899-a8ee-2f179c79872a
kind: element
title: 배포 가이드
domain: docs
---

# 배포 가이드

> 작성: 2026-11-18 · 배포 형태: **공개 웹 서비스** (호스팅 업체는 아직 정하지 않음)
>
> 서버 하나가 웹 화면(`/`)과 API(`/api`)를 **같은 주소**에서 내보낸다. 로그인 쿠키와 상대 경로 `fetch('/api/…')`가 그대로 동작하고 CORS 설정이 필요 없다.

---

## 1. 구조

```
이용자 ──HTTPS──▶ 리버스 프록시 / 호스팅의 HTTPS ──HTTP──▶ Node 서버 (:8787)
                                                         ├─ /api/*   Fastify 라우트
                                                         ├─ /assets/* 빌드 결과물 (1년 캐시)
                                                         └─ 그 밖     index.html (한 페이지 앱)
                                                         캐시 ▶ CACHE_DIR (영구 디스크)
```

- HTTPS는 호스팅(또는 앞단 프록시)이 끝내고, 서버는 그 뒤에서 HTTP로 돈다 → `TRUST_PROXY=1`
- 캐시 폴더에는 상점 정보(게임 사실 정보, 7일), 오늘의 Web API 호출 수, 라이브러리(20분 뒤 삭제)가 쌓인다. **재배포해도 남도록 영구 디스크**에 둔다

## 2. 환경 변수

| 이름 | 필수 | 값 | 설명 |
|---|---|---|---|
| `STEAM_API_KEY` | ✅ | | Steam Web API 키. **서비스 전용 Steam 계정**으로 발급 (§4) |
| `PUBLIC_MODE` | ✅ | `1` | 로그인한 본인 계정만 조회 (STEAM_COMPLIANCE L5) |
| `PUBLIC_ORIGIN` | ✅ | `https://도메인` | Steam 로그인 후 돌아올 주소. 끝에 `/` 없이 |
| `SESSION_SECRET` | ✅ | 64자 임의 문자열 | 로그인 쿠키 서명 키. `openssl rand -hex 32`. 바꾸면 모두 로그아웃됨 |
| `TRUST_PROXY` | ✅ | `1` | HTTPS 프록시 뒤에서 실제 프로토콜·IP 인식 |
| `CACHE_DIR` | ✅ | `/data` 등 | 영구 디스크 경로 (Docker 이미지 기본값 `/data`) |
| `HOST` / `PORT` | | `0.0.0.0` / `8787` | Docker 이미지 기본값 |
| `CONTACT_EMAIL` | ✅ | | 운영자 연락처. 정보 패널·처리방침에 표시 (P5·P6) |
| `SERVER_REGION` | ✅ | 예: `대한민국` | 서버 위치(국가). 처리방침에 표시 (API 약관 §2) |
| `USER_DAILY_SYNCS` | | `10` | 한 사람이 하루에 새로 동기화할 수 있는 횟수 |

- `STEAM_TEST_USER`는 공개 모드에서 무시된다. 넣지 않는다
- 공개 모드에서 `SESSION_SECRET`(32자 이상)이 없으면 서버가 시작을 거부한다

## 3. 실행

### Docker (어느 호스팅이든)

```bash
docker build -t steamverse .
docker run -p 8787:8787 --env-file .env.production -v steamverse-cache:/data steamverse
```

- 이미지는 `PUBLIC_MODE=1`, `CACHE_DIR=/data`, `HOST=0.0.0.0`이 기본이다
- `.env`·`.cache`·`docs`는 이미지에 들어가지 않는다 (`.dockerignore`)
- ⚠️ 이 PC에 Docker가 없어 이미지 빌드는 아직 실제로 해 보지 않았다. 처음 배포할 때 한 번 확인한다

### Docker 없이

```bash
npm ci
npm run build          # apps/web/dist 생성
npm start              # NODE_ENV=production, 웹 + API를 한 서버에서
```

## 4. 공개 전 체크

- [ ] **API 키 교체**: 서비스 전용 Steam 계정 만들기 → 결제 이력 갖추기(제한 계정은 키 발급 불가) → https://steamcommunity.com/dev/apikey 에서 도메인 칸에 실제 도메인으로 발급 → 배포 환경의 `STEAM_API_KEY`에만 넣기. 지금 개발용 키(채팅에 노출됨)는 같은 페이지에서 폐기
- [ ] `PUBLIC_ORIGIN`을 실제 HTTPS 주소로. 로그인 → 돌아오기까지 한 번 해 보기
- [ ] 캐시 폴더가 영구 디스크인지 (재배포 후 `/api/health`의 `webapi.calls`가 0으로 돌아가지 않는지)
- [ ] `CONTACT_EMAIL`·`SERVER_REGION` 설정, [PRIVACY.md](PRIVACY.md) 빈칸 채워 게시
- [ ] 응답 헤더 확인: `content-security-policy`, `strict-transport-security`(HTTPS일 때), `x-frame-options`
- [ ] 앱 이름 (STEAM_COMPLIANCE T4)

## 5. 운영

- `/api/health`: 키 유무(값은 안 보임), 공개 모드, 오늘 Web API 호출 수, 요청 줄 상태
- 하루 호출 80%에서 경고 로그, 95%에서 새 동기화를 멈추고 지난 캐시만 준다
- 한 사람당 하루 `USER_DAILY_SYNCS`회까지 새로 동기화. 넘으면 `429 user-quota`, 지난 캐시가 있으면 그걸 준다
- 상점 정보: 이용자 요청이 우선이고, 요청 줄이 비면 지금 인기 게임 상위 100개(Steam 공식 차트)를 한 개씩 미리 채운다
- 권리자가 이미지 삭제를 요청하면 `apps/server/blocked-images.json`에 appid 추가 (재시작 불필요)

## 6. 알려진 사항

- **npm audit high 5건**: 모두 `picomatch`의 정규식 처리 문제(ReDoS) 하나가 의존 경로로 5번 잡힌 것이다. Vite(개발·빌드 도구) 안에서만 쓰이고 운영 서버 의존성에는 없다. 최신 `picomatch`(4.0.7)에도 아직 수정판이 없고, npm이 제안하는 해결(Vite 6.2로 내리기)은 빌드를 깬다. 수정판이 나오면 `npm update`로 올린다
- 운영에서도 `tsx`로 TypeScript를 바로 실행한다 (`tsx`를 서버 런타임 의존성으로 둠)
