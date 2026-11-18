import { RateLimitedError } from './throttle';

const USER_AGENT = 'steamverse-dev/0.1';

/**
 * 외부 요청 오류. 메시지에는 호스트와 상태만 담는다.
 * 요청 URL에는 API 키(?key=)가 들어 있으므로 URL이나 원래 오류 객체를 절대 담지 않는다. (STEAM_COMPLIANCE K2)
 */
export class UpstreamError extends Error {
  constructor(
    public host: string,
    /** 0 = 응답을 받지 못함(네트워크·타임아웃), -1 = 응답 본문이 JSON이 아님 */
    public status: number,
    reason?: string,
  ) {
    super(`${host} ${reason ?? `responded ${status}`}`);
    this.name = 'UpstreamError';
  }
}

export async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // fetch 오류의 cause에는 요청 정보가 딸려 올 수 있어 버리고 새로 만든다
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new UpstreamError(host, 0, timeout ? 'timed out' : 'network error');
  }
  if (res.status === 429) throw new RateLimitedError(host);
  if (!res.ok) throw new UpstreamError(host, res.status);
  const text = await res.text();
  // Store API는 한도에 걸리면 200과 함께 'null'을 돌려주기도 한다
  if (text.trim() === 'null' || text.trim() === '') throw new RateLimitedError(host);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(host, -1, 'invalid json');
  }
}
