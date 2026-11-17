import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..');

// 저장소 루트의 .env 를 읽는다. 없으면 그냥 넘어간다 (키 없이 되는 기능만 동작)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* .env 없음 */
}

export const env = {
  /** 아직 없을 수 있다. 응답이나 로그에 절대 그대로 내보내지 않는다 */
  steamApiKey: process.env.STEAM_API_KEY?.trim() || undefined,
  testUser: process.env.STEAM_TEST_USER?.trim() || undefined,
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  cacheDir: path.join(here, '..', '.cache'),
};
