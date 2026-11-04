import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * ローカル検証モード（E2E）の DB の初期化（WING_LOCAL_RESET=1）。開発・E2E 専用で、本番では使わない。
 *
 * - WING_LOCAL_RESET_ID（Playwright の 1 回の実行ごとの値。playwright.config.ts が付ける）があれば、
 *   その実行の中で 1 回だけ初期化する。開発サーバーが途中で再起動しても、実行の途中の DB を消さない
 * - 無ければ、これまでどおりプロセスごとに 1 回
 *
 * 公開カタログのキャッシュ（.next に残る）は、初期化の世代ごとに分ける（public-catalog.ts）。
 * 前回の実行のカタログが、初期化した DB の代わりに表示されないようにするため
 */

declare global {
  var __wingLocalReset: boolean | undefined;
  var __wingLocalProcessResetId: string | undefined;
}

const MARKER = '.reset-id';

function runId(): string {
  return process.env.WING_LOCAL_RESET_ID?.trim() ?? '';
}

/** 初期化の世代。初期化しない（WING_LOCAL_RESET が 1 でない）ときは空 */
export function localResetGeneration(): string {
  if (process.env.WING_LOCAL_RESET !== '1') return '';
  const id = runId();
  if (id) return id;
  return (globalThis.__wingLocalProcessResetId ??= randomUUID());
}

/**
 * このプロセスで最初に DB を読むときに呼ぶ。初期化するなら true（同じ世代では 2 回目以降 false）。
 * 実行ごとの値があるときは、ローカルの保存先に世代の印を残して、別のプロセスからも同じ世代では初期化しない
 */
export function takeLocalReset(dir: string): boolean {
  if (process.env.WING_LOCAL_RESET !== '1' || globalThis.__wingLocalReset) return false;
  globalThis.__wingLocalReset = true;
  const id = runId();
  if (!id) return true;
  const marker = path.join(dir, MARKER);
  let previous = '';
  try {
    previous = fs.readFileSync(marker, 'utf8').trim();
  } catch {
    // 印が無い＝この保存先ではまだ初期化していない
  }
  if (previous === id) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marker, id);
  return true;
}
