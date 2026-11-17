import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
