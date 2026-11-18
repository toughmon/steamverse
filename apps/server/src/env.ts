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

/**
 * 공개 모드: 로그인한 본인 계정만 조회한다. ?user= 와 STEAM_TEST_USER를 무시한다.
 * (Steam Web API 약관 — 그 사용자가 요청할 때만 데이터를 받는다. STEAM_COMPLIANCE L5)
 */
const publicMode = process.env.PUBLIC_MODE === '1';

export const env = {
  /** 아직 없을 수 있다. 응답이나 로그에 절대 그대로 내보내지 않는다 */
  steamApiKey: process.env.STEAM_API_KEY?.trim() || undefined,
  publicMode,
  /** 개발용 기본 계정. 공개 모드에서는 쓰지 않는다 */
  testUser: publicMode ? undefined : process.env.STEAM_TEST_USER?.trim() || undefined,
  /**
   * 서비스 주소 (예: https://example.com). Steam 로그인 후 돌아올 주소를 만든다.
   * 공개 모드에서는 필수. 개발에서는 비워 두면 요청이 온 localhost 주소를 쓴다
   */
  publicOrigin: process.env.PUBLIC_ORIGIN?.trim().replace(/\/$/, '') || undefined,
  /** 로그인 세션 쿠키 서명 키. 공개 모드에서는 필수(32자 이상) */
  sessionSecret: process.env.SESSION_SECRET?.trim() || undefined,
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  cacheDir: path.join(here, '..', '.cache'),
};
