import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';

/**
 * 파일 캐시. DB를 붙이기 전까지 상점 정보를 재시작 후에도 보관해
 * Steam에 같은 요청을 반복하지 않게 한다.
 */
interface Entry<T> {
  savedAt: number;
  value: T;
}

const memory = new Map<string, Entry<unknown>>();

function fileOf(ns: string, key: string) {
  return path.join(env.cacheDir, ns, `${key.replace(/[^\w.-]/g, '_')}.json`);
}

export async function cacheGet<T>(ns: string, key: string, ttlMs: number): Promise<T | undefined> {
  const id = `${ns}/${key}`;
  let entry = memory.get(id) as Entry<T> | undefined;
  if (!entry) {
    try {
      entry = JSON.parse(await readFile(fileOf(ns, key), 'utf8')) as Entry<T>;
      memory.set(id, entry);
    } catch {
      return undefined;
    }
  }
  return Date.now() - entry.savedAt <= ttlMs ? entry.value : undefined;
}

export async function cacheSet<T>(ns: string, key: string, value: T): Promise<void> {
  const entry: Entry<T> = { savedAt: Date.now(), value };
  memory.set(`${ns}/${key}`, entry);
  const file = fileOf(ns, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(entry));
}

export async function cacheDelete(ns: string, key: string): Promise<void> {
  memory.delete(`${ns}/${key}`);
  await rm(fileOf(ns, key), { force: true });
}

/**
 * 오래된 항목을 메모리와 디스크에서 지운다. 읽을 때만 TTL을 보면 파일이 끝없이 쌓이므로
 * 개인정보가 담긴 ns(library 등)는 주기적으로 이걸 부른다. (STEAM_COMPLIANCE P4)
 * 반환: 지운 파일 수
 */
export async function cachePurge(ns: string, maxAgeMs: number): Promise<number> {
  const now = Date.now();
  for (const [id, entry] of memory) {
    if (id.startsWith(`${ns}/`) && now - entry.savedAt > maxAgeMs) memory.delete(id);
  }
  const dir = path.join(env.cacheDir, ns);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const { mtimeMs } = await stat(file);
      if (now - mtimeMs > maxAgeMs) {
        await rm(file, { force: true });
        removed++;
      }
    } catch {
      /* 그 사이 지워졌으면 넘어간다 */
    }
  }
  return removed;
}
