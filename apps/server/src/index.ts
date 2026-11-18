import Fastify, { type FastifyRequest } from 'fastify';
import { env } from './env';
import { getApp, getCatalog } from './catalog';
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
import { QuotaError, usage } from './steam/quota';
import { loadBlockedImages } from './blockedImages';

/**
 * 로그에는 경로만 남긴다. 쿼리(?user=)에는 SteamID·프로필 주소가 들어 있다.
 * 오류는 이름·메시지·스택만 — cause 등 딸린 객체에 요청 정보가 섞이지 않게 (STEAM_COMPLIANCE K2)
 */
const app = Fastify({
  logger: {
    level: 'info',
    serializers: {
      req: (req) => ({ method: req.method, url: req.url.split('?')[0] }),
      err: (err: Error) => ({ type: err.name, message: err.message, stack: err.stack ?? '' }),
    },
  },
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

app.get<{ Params: { appid: string } }>('/api/catalog/:appid', async (req, reply) => {
  const appid = Number(req.params.appid);
  if (!Number.isInteger(appid) || appid <= 0) return reply.code(400).send({ error: 'appid가 올바르지 않다' });
  const result = await getApp(appid);
  if (!result) return reply.code(502).send({ error: 'Steam에서 정보를 받지 못했다. 잠시 뒤 다시 시도' });
  return result;
});

/** 웹이 처음에 한 번 받는 설정: 이미지를 끈 게임 목록 (퍼블리셔 요청 대응 — STEAM_COMPLIANCE C7) */
app.get('/api/config', async () => ({ blockedImageAppids: await loadBlockedImages(), publicMode: env.publicMode }));

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

// 오래된 라이브러리 캐시는 시작할 때와 매시간 지운다
const purge = () =>
  purgeLibraries()
    .then((n) => n && app.log.info(`오래된 라이브러리 캐시 ${n}개 삭제`))
    .catch((err) => app.log.error(err));
void purge();
setInterval(purge, 60 * 60 * 1000).unref();

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Steam API 키: ${env.steamApiKey ? '있음' : '없음 (상점 정보만 동작)'}`);
  app.log.info(env.publicMode ? '공개 모드: 로그인한 본인 계정만 조회' : '개발 모드: 로그인 없으면 STEAM_TEST_USER 사용');
  if (devSecret) app.log.warn('SESSION_SECRET 없음: 개발용 임시 키 사용 (서버를 재시작하면 다시 로그인해야 한다)');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
