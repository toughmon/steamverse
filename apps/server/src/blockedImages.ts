import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 이미지를 보여 주지 않을 게임 목록. 퍼블리셔가 요청하면 appid를 blocked-images.json에 넣는다.
 * (STEAM_COMPLIANCE C7) 파일을 고치면 서버 재시작 없이 다음 요청부터 반영된다.
 */
const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'blocked-images.json');

export async function loadBlockedImages(): Promise<number[]> {
  try {
    const body = JSON.parse(await readFile(FILE, 'utf8')) as { appids?: unknown };
    return Array.isArray(body.appids) ? body.appids.filter((n): n is number => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}
