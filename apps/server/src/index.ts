import Fastify from 'fastify';
import { env } from './env';
import { getApp, getCatalog } from './catalog';
import { storeQueue } from './steam/store';
import { steamspyQueue } from './steam/steamspy';
import { MissingKeyError } from './steam/webapi';
import { ProfileNotFoundError, getLibrary, resolveSteamId } from './library';

const app = Fastify({ logger: { level: 'info' } });

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

/**
 * 플레이 기록(보유 게임·시간·업적·친구). user를 안 주면 .env의 STEAM_TEST_USER.
 * user는 SteamID64, 프로필 주소, /id/ 이름 모두 된다.
 */
app.get<{ Querystring: { user?: string; refresh?: string } }>('/api/library', async (req, reply) => {
  const input = req.query.user ?? env.testUser;
  if (!env.steamApiKey) return reply.code(503).send({ error: 'no-key' });
  if (!input) return reply.code(400).send({ error: 'no-user' });
  try {
    const steamid = await resolveSteamId(input);
    return await getLibrary(steamid, req.query.refresh === '1');
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return reply.code(404).send({ error: 'not-found' });
    if (err instanceof MissingKeyError) return reply.code(503).send({ error: 'no-key' });
    req.log.error(err);
    return reply.code(502).send({ error: 'steam-failed' });
  }
});

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Steam API 키: ${env.steamApiKey ? '있음' : '없음 (상점 정보만 동작)'}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
