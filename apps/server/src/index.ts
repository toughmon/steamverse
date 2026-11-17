import Fastify from 'fastify';
import { env } from './env';
import { getApp, getCatalog } from './catalog';
import { storeQueue } from './steam/store';
import { steamspyQueue } from './steam/steamspy';

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

try {
  await app.listen({ port: env.port, host: env.host });
  app.log.info(`Steam API 키: ${env.steamApiKey ? '있음' : '없음 (상점 정보만 동작)'}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
