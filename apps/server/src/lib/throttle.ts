/**
 * 호스트별 요청 간격 제한. 작업을 한 줄로 세워 최소 간격을 두고 실행한다.
 * 429를 받으면 pause()로 한동안 전체를 멈춘다.
 */
export function createThrottle(name: string, minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let nextAt = 0;
  let pausedUntil = 0;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    name,
    schedule<T>(task: () => Promise<T>): Promise<T> {
      const run = chain.then(async () => {
        const now = Date.now();
        const at = Math.max(nextAt, pausedUntil);
        if (at > now) await wait(at - now);
        nextAt = Date.now() + minIntervalMs;
        return task();
      });
      // 실패해도 줄이 끊기지 않게
      chain = run.catch(() => undefined);
      return run;
    },
    pause(ms: number) {
      pausedUntil = Math.max(pausedUntil, Date.now() + ms);
    },
    get pausedFor() {
      return Math.max(0, pausedUntil - Date.now());
    },
  };
}

export class RateLimitedError extends Error {
  constructor(host: string) {
    super(`${host} rate limited`);
  }
}
