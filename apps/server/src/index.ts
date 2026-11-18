import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from './env';
import { getApp, getCatalog, startPrewarm } from './catalog';
import { getGlobalPercentages } from './globalAchievements';
import { storeQueue } from './steam/store';
import { steamspyQueue } from './steam/steamspy';
import { MissingKeyError, getPlayers } from './steam/webapi';
import {
  CALLBACK_PATH,
  LoginError,
  SESSION_COOKIE,
  beginLogin,
  clearCookie,
  clearStateCookie,
  devSecret,
  finishLogin,
  originFor,
  sessionCookie,
  sessionSteamId,
} from './auth';
import { ProfileNotFoundError, deleteLibrary, getLibrary, purgeLibraries, resolveSteamId } from './library';
import { QuotaError, UserQuotaError, usage } from './steam/quota';
import { loadBlockedImages } from './blockedImages';

/**
 * 로그에는 경로만 남긴다. 쿼리(?user=)에는 SteamID·프로필 주소가 들어 있다.
 * 오류는 이름·메시지·스택만 — cause 등 딸린 객체에 요청 정보가 섞이지 않게 (STEAM_COMPLIANCE K2)
 */
const app = Fastify({
  // HTTPS를 끝내는 리버스 프록시 뒤에서는 X-Forwarded-* 를 믿어야 실제 프로토콜·IP를 안다
  trustProxy: env.trustProxy,
  logger: {
    level: 'info',
    serializers: {
      req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
      err: (err: Error) => ({ type: err.name, message: err.message, stack: err.stack ?? '' }),
    },
  },
});

/**
 * 보안 헤더. 외부에서 불러오는 것은 Steam 이미지(steamstatic), 글꼴(jsdelivr·Google Fonts)뿐이다.
 * Sigma 배치 계산은 blob: 워커를 쓴다.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.steamstatic.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://steamcommunity.com",
].join('; ');

app.addHook('onSend', async (req, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('x-frame-options', 'DENY');
  if (env.publicOrigin?.startsWith('https://')) reply.header('strict-transport-security', 'max-age=31536000');
  // CSP는 웹 화면에만 (API 응답·리다이렉트에는 필요 없다)
  if (!req.url.startsWith('/api/')) reply.header('content-security-policy', CSP);
});

const MAX_APPIDS = 500;

function parseAppids(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const ids = [...new Set(raw.split(',').map((s) => Number(s.trim())))];
  if (ids.length > MAX_APPIDS || ids.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return ids;
}

app.get('/api/health', async () => ({
  ok: true,
  // 키 값은 절대 내보내지 않고, 있는지만 알린다
  steamApiKey: Boolean(env.steamApiKey),
  testUser: Boolean(env.testUser),
  publicMode: env.publicMode,
  webapi: await usage(),
  queues: {
    store: { pausedForMs: storeQueue.pausedFor },
    steamspy: { pausedForMs: steamspyQueue.pausedFor },
  },
}));

app.get<{ Querystring: { appids?: string } }>('/api/catalog', async (req, reply) => {
  const appids = parseAppids(req.query.appids);
  if (!appids) return reply.code(400).send({ error: `appids는 쉼표로 구분한 양의 정수, 최대 ${MAX_APPIDS}개` });
  return getCatalog(appids);
});

/** 업적의 전 세계 달성률 (게임 단위 공개 통계, 키 불필요). 없는 것은 받기 시작하고 status.pending으로 알린다 */
app.get<{ Querystring: { appids?: string } }>('/api/achievements/global', async (req, reply) => {
  const appids = parseAppids(req.query.appids);
  if (!appids) return reply.code(400).send({ error: `appids는 쉼표로 구분한 양의 정수, 최대 ${MAX_APPIDS}개` });
  return getGlobalPercentages(appids);
});

app.get<{ Params: { appid: string } }>('/api/catalog/:appid', async (req, reply) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) return reply.code(400).send({ error: 'appid가 올바르지 않다' });
  const result = await getApp(appid);
  if (!result) return reply.code(502).send({ error: 'Steam에서 정보를 받지 못했다. 잠시 뒤 다시 시도' });
  return result;
});

/** 웹이 처음에 한 번 받는 설정: 이미지를 끈 게임 목록 (퍼블리셔 요청 대응 — STEAM_COMPLIANCE C7) */
app.get('/api/config', async () => ({
  blockedImageAppids: await loadBlockedImages(),
  publicMode: env.publicMode,
  // 개인정보처리방침에 필요한 운영자 연락처·서버 위치 (STEAM_COMPLIANCE P5)
  contactEmail: env.contactEmail ?? null,
  serverRegion: env.serverRegion ?? null,
}));

// ── 로그인 ─────────────────────────────────────────────────────

/** Steam 로그인 페이지로 보낸다 */
app.get('/api/auth/steam/login', async (req, reply) => {
  const origin = originFor(req.headers.host);
  if (!origin) return reply.code(500).send({ error: 'PUBLIC_ORIGIN이 설정되지 않았다' });
  const { url, stateCookie } = beginLogin(origin);
  return reply.header('set-cookie', stateCookie).redirect(url, 302);
});

/** Steam에서 돌아오는 곳. 확인되면 세션 쿠키를 주고 첫 화면으로 */
app.get<{ Querystring: Record<string, string | undefined> }>(CALLBACK_PATH, async (req, reply) => {
  const origin = originFor(req.headers.host);
  if (!origin) return reply.code(500).send({ error: 'PUBLIC_ORIGIN이 설정되지 않았다' });
  try {
    const steamid = await finishLogin(req.query, req.headers.cookie, origin);
    return reply.header('set-cookie', [sessionCookie(steamid, origin), clearStateCookie(origin)]).redirect(`${origin}/`, 302);
  } catch (err) {
    const reason = err instanceof LoginError ? err.reason : 'error';
    if (!(err instanceof LoginError)) req.log.error(err);
    else req.log.warn(`Steam 로그인 실패: ${reason}`);
    return reply.header('set-cookie', clearStateCookie(origin)).redirect(`${origin}/?login=${encodeURIComponent(reason)}`, 302);
  }
});

/** 로그아웃: 세션을 끝내고, 그 계정의 라이브러리 캐시(친구 정보 포함)도 바로 지운다 */
app.post('/api/auth/logout', async (req, reply) => {
  const steamid = sessionSteamId(req.headers.cookie);
  if (steamid) await deleteLibrary(steamid);
  const origin = originFor(req.headers.host) ?? '';
  return reply.header('set-cookie', clearCookie(SESSION_COOKIE, origin)).send({ ok: true });
});

const profileCache = new Map<string, { at: number; value: { name?: string; avatar?: string } }>();

/** 로그인한 사람. 로그인 안 했으면 401 */
app.get('/api/auth/me', async (req, reply) => {
  const steamid = sessionSteamId(req.headers.cookie);
  if (!steamid) return reply.code(401).send({ error: 'login' });
  let profile = profileCache.get(steamid);
  if (!profile || Date.now() - profile.at > 10 * 60 * 1000) {
    const [p] = env.steamApiKey ? await getPlayers([steamid]).catch(() => []) : [];
    profile = { at: Date.now(), value: { name: p?.personaname, avatar: p?.avatarfull } };
    profileCache.set(steamid, profile);
  }
  return { steamid, ...profile.value };
});

/**
 * 조회할 계정. 로그인한 본인이 우선이다.
 * 공개 모드에서는 본인만. 개발에서는 ?user= 나 .env의 STEAM_TEST_USER도 받는다.
 */
async function targetSteamId(req: FastifyRequest<{ Querystring: { user?: string } }>): Promise<string | null> {
  const own = sessionSteamId(req.headers.cookie);
  if (own) return own;
  if (env.publicMode) return null;
  const input = req.query.user ?? env.testUser;
  return input ? resolveSteamId(input) : null;
}

// ── 플레이 기록 ────────────────────────────────────────────────

/** 플레이 기록(보유 게임·시간·업적·친구). 로그인이 필요하면 401 { error: 'login' } */
app.get<{ Querystring: { user?: string; refresh?: string } }>('/api/library', async (req, reply) => {
  // 로그인 여부를 먼저 본다 (키가 없어도 로그인 버튼은 보여야 한다)
  if (!sessionSteamId(req.headers.cookie) && (env.publicMode || !(req.query.user ?? env.testUser))) {
    return reply.code(401).send({ error: 'login' });
  }
  if (!env.steamApiKey) return reply.code(503).send({ error: 'no-key' });
  try {
    const steamid = await targetSteamId(req);
    if (!steamid) return reply.code(401).send({ error: 'login' });
    return await getLibrary(steamid, req.query.refresh === '1');
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: 'not-found' });
    if (err instanceof MissingKeyError) return reply.code(503).send({ error: 'no-key' });
    if (err instanceof QuotaError) return reply.code(503).send({ error: 'quota' });
    if (err instanceof UserQuotaError) return reply.code(429).send({ error: 'user-quota' });
    req.log.error(err);
    return reply.code(502).send({ error: 'steam-failed' });
  }
});

/** 이 계정의 라이브러리 캐시(친구 정보 포함)를 지운다. "내 데이터 지우기" (STEAM_COMPLIANCE P6) */
app.delete<{ Querystring: { user?: string } }>('/api/library', async (req, reply) => {
  const steamid = await targetSteamId(req).catch(() => null);
  if (!steamid) return reply.code(401).send({ error: 'login' });
  await deleteLibrary(steamid);
  return { ok: true };
});

// ── 웹 화면 ───────────────────────────────────────────────────
// 빌드된 웹(apps/web/dist)이 있으면 같은 서버·같은 주소에서 내보낸다. 개발 중에는 Vite가 대신한다
const webIndex = path.join(env.webDist, 'index.html');
if (existsSync(webIndex)) {
  await app.register(fastifyStatic, {
    root: env.webDist,
    wildcard: false,
    index: false,
    setHeaders: (res, file) => {
      // 파일 이름에 해시가 붙은 빌드 결과물은 오래 캐시, index.html은 매번 확인
      res.header('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.get('/*', async (req, reply) => {
    // 없는 API 주소는 화면이 아니라 404
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not-found' });
    const file = path.join(env.webDist, path.normalize(req.url.split('?')[0]!));
    if (file.startsWith(env.webDist) && existsSync(file) && !file.endsWith(path.sep) && path.extname(file)) {
      return reply.sendFile(path.relative(env.webDist, file));
    }
    // 화면 주소는 모두 index.html (한 페이지 앱)
    return reply.header('cache-control', 'no-cache').sendFile('index.html');
  });
}
app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not-found' }));

// 오래된 라이브러리 캐시는 시작할 때와 매시간 지운다
const purge = () =>
  purgeLibraries()
    .then((n) => n && app.log.info(`오래된 라이브러리 캐시 ${n}개 삭제`))
    .catch((err) => app.log.error(err));
void purge();
setInterval(purge, 60 * 60 * 1000).unref();

// 인기 게임 상점 정보를 한가할 때 미리 채운다
startPrewarm((err) => app.log.warn(`인기 게임 목록을 받지 못함: ${err instanceof Error ? err.message : 'unknown'}`));

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Steam API 키: ${env.steamApiKey ? '있음' : '없음 (상점 정보만 동작)'}`);
  app.log.info(existsSync(webIndex) ? `웹 화면도 함께 제공: ${env.webDist}` : '웹 빌드 없음: API만 제공 (개발 중이면 Vite가 웹을 띄운다)');
  app.log.info(env.publicMode ? '공개 모드: 로그인한 본인 계정만 조회' : '개발 모드: 로그인 없으면 STEAM_TEST_USER 사용');
  if (devSecret) app.log.warn('SESSION_SECRET 없음: 개발용 임시 키 사용 (서버를 재시작하면 다시 로그인해야 한다)');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
