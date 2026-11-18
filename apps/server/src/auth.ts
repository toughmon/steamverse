import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * Steam 로그인 (OpenID 2.0) + 서명된 세션 쿠키.
 *
 * - 비밀번호는 Steam 페이지에만 입력된다. 우리는 Steam이 확인해 준 SteamID만 받는다 (STEAM_COMPLIANCE A1·A2)
 * - 세션 쿠키에는 SteamID와 발급 시각만 담고 HMAC으로 서명한다. 서버에 세션 저장소가 없다
 * - Steam 문서: https://partner.steamgames.com/doc/features/auth (Steam은 OpenID 2.0 제공자)
 */

const OP_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export const SESSION_COOKIE = 'sv_session';
const STATE_COOKIE = 'sv_login_state';
const SESSION_MAX_AGE_S = 30 * 24 * 3600;
const STATE_MAX_AGE_S = 10 * 60;
export const CALLBACK_PATH = '/api/auth/steam/callback';

// ── 서명 키 ────────────────────────────────────────────────────

function resolveSecret(): Buffer {
  if (env.sessionSecret && env.sessionSecret.length >= 32) return Buffer.from(env.sessionSecret);
  if (env.publicMode) throw new Error('공개 모드에는 SESSION_SECRET(32자 이상)이 필요하다');
  // 개발용: 실행할 때마다 새 키 → 서버를 재시작하면 다시 로그인해야 한다
  return randomBytes(32);
}
const secret = resolveSecret();
export const devSecret = !env.sessionSecret;

const b64url = (b: Buffer) => b.toString('base64url');
const sign = (payload: string) => b64url(createHmac('sha256', secret).update(payload).digest());

function verifySigned(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return payload;
}

// ── 쿠키 ──────────────────────────────────────────────────────

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name: string, value: string, maxAgeS: number, origin: string): string {
  const secure = origin.startsWith('https://') ? '; Secure' : '';
  // Lax: Steam에서 우리 콜백으로 돌아오는 최상위 이동(GET)에는 쿠키가 실린다
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

// ── 세션 ──────────────────────────────────────────────────────

export function sessionCookie(steamid: string, origin: string): string {
  const payload = `${steamid}.${Math.floor(Date.now() / 1000)}`;
  return cookie(SESSION_COOKIE, `${payload}.${sign(payload)}`, SESSION_MAX_AGE_S, origin);
}

export function clearCookie(name: string, origin: string): string {
  return cookie(name, '', 0, origin);
}

/** 쿠키에서 로그인한 SteamID. 서명이 틀렸거나 만료면 null */
export function sessionSteamId(cookieHeader: string | undefined): string | null {
  const raw = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!raw) return null;
  const payload = verifySigned(raw);
  if (!payload) return null;
  const [steamid, issued] = payload.split('.');
  if (!steamid || !/^\d{17}$/.test(steamid)) return null;
  if (Date.now() / 1000 - Number(issued) > SESSION_MAX_AGE_S) return null;
  return steamid;
}

// ── 서비스 주소 ────────────────────────────────────────────────

/**
 * 로그인 후 돌아올 주소의 기준. 공개 모드는 PUBLIC_ORIGIN만 쓴다.
 * 개발에서는 Host 헤더를 쓰되 localhost·127.0.0.1일 때만 믿는다 (Vite 프록시가 Host를 그대로 넘긴다)
 */
export function originFor(hostHeader: string | undefined): string | null {
  if (env.publicOrigin) return env.publicOrigin;
  if (env.publicMode) return null;
  const host = hostHeader ?? '';
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? `http://${host}` : null;
}

// ── OpenID ────────────────────────────────────────────────────

/** Steam 로그인 페이지 주소와, 되돌아올 때 맞춰 볼 state 쿠키 */
export function beginLogin(origin: string): { url: string; stateCookie: string } {
  const state = b64url(randomBytes(16));
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${origin}${CALLBACK_PATH}?state=${state}`,
    'openid.realm': origin,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  });
  const signedState = `${state}.${sign(state)}`;
  return { url: `${OP_ENDPOINT}?${params}`, stateCookie: cookie(STATE_COOKIE, signedState, STATE_MAX_AGE_S, origin) };
}

export class LoginError extends Error {
  constructor(public reason: string) {
    super(`steam login failed: ${reason}`);
  }
}

/**
 * Steam에서 돌아온 요청을 확인하고 SteamID를 돌려준다.
 * 1) 우리가 보낸 state인지 (쿠키와 비교) 2) 돌아온 주소·제공자·ID 형식이 맞는지
 * 3) Steam에 check_authentication으로 서명이 진짜인지 직접 묻는다 (Steam은 같은 응답을 두 번 인정하지 않는다)
 */
export async function finishLogin(query: Record<string, string | undefined>, cookieHeader: string | undefined, origin: string): Promise<string> {
  const rawState = parseCookies(cookieHeader)[STATE_COOKIE];
  const state = rawState ? verifySigned(rawState) : null;
  if (!state || query.state !== state) throw new LoginError('state');

  if (query['openid.mode'] !== 'id_res') throw new LoginError(query['openid.mode'] === 'cancel' ? 'cancel' : 'mode');
  if (query['openid.op_endpoint'] !== OP_ENDPOINT) throw new LoginError('endpoint');
  if (query['openid.return_to'] !== `${origin}${CALLBACK_PATH}?state=${state}`) throw new LoginError('return_to');
  const claimed = query['openid.claimed_id'] ?? '';
  const m = CLAIMED_ID.exec(claimed);
  if (!m || query['openid.identity'] !== claimed) throw new LoginError('claimed_id');

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.') && v !== undefined) body.set(k, v);
  body.set('openid.mode', 'check_authentication');

  let text: string;
  try {
    const res = await fetch(OP_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    text = await res.text();
  } catch {
    throw new LoginError('verify-unreachable');
  }
  if (!/^is_valid\s*:\s*true\s*$/m.test(text)) throw new LoginError('verify');
  return m[1]!;
}

export const clearStateCookie = (origin: string) => clearCookie(STATE_COOKIE, origin);
