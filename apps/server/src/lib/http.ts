import { RateLimitedError } from './throttle';

const USER_AGENT = 'steamverse-dev/0.1';

export class UpstreamError extends Error {
  constructor(
    public host: string,
    public status: number,
  ) {
    super(`${host} responded ${status}`);
  }
}

export async function getJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  const host = new URL(url).host;
  if (res.status === 429) throw new RateLimitedError(host);
  if (!res.ok) throw new UpstreamError(host, res.status);
  const text = await res.text();
  // Store API는 한도에 걸리면 200과 함께 'null'을 돌려주기도 한다
  if (text.trim() === 'null' || text.trim() === '') throw new RateLimitedError(host);
  return JSON.parse(text) as T;
}
