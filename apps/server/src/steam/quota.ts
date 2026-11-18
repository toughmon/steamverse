import { cacheGet, cacheSet } from '../lib/cache';

/**
 * Steam Web API 하루 호출 수. 약관상 키당 하루 10만 회 (STEAM_COMPLIANCE L1).
 * UTC 날짜 단위로 세고, 재시작해도 이어지도록 캐시에 저장한다.
 */
export const DAILY_LIMIT = 100_000;
/** 이만큼 쓰면 경고 로그 */
const WARN_AT = 0.8;
/** 이만큼 쓰면 새 라이브러리 동기화를 거절한다 (동기화 한 번이 최대 약 150회라 여유를 둔다) */
const STOP_AT = 0.95;
const KEEP_MS = 3 * 24 * 3600 * 1000;

export class QuotaError extends Error {
  constructor() {
    super('Steam Web API 하루 호출 한도에 가까워 새 동기화를 멈췄다');
  }
}

const today = () => new Date().toISOString().slice(0, 10);

let day = today();
let count = 0;
let loaded: Promise<void> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let warned = false;

function load(): Promise<void> {
  loaded ??= cacheGet<number>('meta', `webapi-usage-${day}`, KEEP_MS).then((n) => {
    count = Math.max(count, n ?? 0);
  });
  return loaded;
}

function rollover() {
  const d = today();
  if (d === day) return;
  day = d;
  count = 0;
  warned = false;
  loaded = Promise.resolve();
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void cacheSet('meta', `webapi-usage-${day}`, count);
  }, 2000);
}

/** Web API를 한 번 부를 때마다 */
export async function countCall(onWarn: (used: number) => void): Promise<void> {
  await load();
  rollover();
  count++;
  if (!warned && count >= DAILY_LIMIT * WARN_AT) {
    warned = true;
    onWarn(count);
  }
  scheduleSave();
}

/** 새 동기화를 시작해도 되는지 */
export async function assertQuota(): Promise<void> {
  await load();
  rollover();
  if (count >= DAILY_LIMIT * STOP_AT) throw new QuotaError();
}

export async function usage(): Promise<{ day: string; calls: number; limit: number }> {
  await load();
  rollover();
  return { day, calls: count, limit: DAILY_LIMIT };
}
