import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDb, saveDb } from '@/lib/data/local-db';
import { localResetGeneration, takeLocalReset } from '@/lib/data/local-reset';

// ローカル検証モード（E2E）の DB の初期化と、公開カタログのキャッシュの世代（2026-10-20：admin 11-12 の 25,300 円のずれ）
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const ENV_KEYS = ['WING_LOCAL_RESET', 'WING_LOCAL_RESET_ID', 'WING_LOCAL_DIR'] as const;

// 開発サーバーの再起動（別のプロセス）の代わりに、プロセスごとの印を消す
function newProcess() {
  globalThis.__wingLocalReset = undefined;
  globalThis.__wingLocalProcessResetId = undefined;
}

let dir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-local-reset-'));
  newProcess();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
  newProcess();
});

describe('ローカル検証モードの DB の初期化（E2E）', () => {
  it('実行ごとの値があれば、その実行の中で 1 回だけ初期化する（開発サーバーが再起動しても初期化し直さない）', () => {
    process.env.WING_LOCAL_RESET = '1';
    process.env.WING_LOCAL_RESET_ID = 'run-a';
    expect(takeLocalReset(dir)).toBe(true);
    expect(takeLocalReset(dir)).toBe(false);
    newProcess();
    expect(takeLocalReset(dir)).toBe(false);
    // 次の実行では初期化する
    newProcess();
    process.env.WING_LOCAL_RESET_ID = 'run-b';
    expect(takeLocalReset(dir)).toBe(true);
  });

  it('実行ごとの値が無ければ、これまでどおりプロセスごとに 1 回', () => {
    process.env.WING_LOCAL_RESET = '1';
    delete process.env.WING_LOCAL_RESET_ID;
    expect(takeLocalReset(dir)).toBe(true);
    expect(takeLocalReset(dir)).toBe(false);
    newProcess();
    expect(takeLocalReset(dir)).toBe(true);
  });

  it('WING_LOCAL_RESET が 1 でなければ初期化しない（世代も空＝カタログのキャッシュのキーを変えない）', () => {
    delete process.env.WING_LOCAL_RESET;
    process.env.WING_LOCAL_RESET_ID = 'run-a';
    expect(takeLocalReset(dir)).toBe(false);
    expect(localResetGeneration()).toBe('');
  });

  it('カタログのキャッシュの世代は、実行ごとの値（無ければプロセスごとに固定の値）', () => {
    process.env.WING_LOCAL_RESET = '1';
    process.env.WING_LOCAL_RESET_ID = 'run-a';
    expect(localResetGeneration()).toBe('run-a');
    delete process.env.WING_LOCAL_RESET_ID;
    const first = localResetGeneration();
    expect(first).not.toBe('');
    expect(localResetGeneration()).toBe(first);
    newProcess();
    expect(localResetGeneration()).not.toBe(first);
  });

  it('同じ実行の中では、開発サーバーが再起動しても保存した内容（価格の変更など）が残り、次の実行で初期値に戻る', () => {
    process.env.WING_LOCAL_DIR = dir;
    process.env.WING_LOCAL_RESET = '1';
    process.env.WING_LOCAL_RESET_ID = 'run-a';
    const db = loadDb();
    const ub = db.options.find((option) => option.code === 'ub-1216')!;
    const seedPrice = ub.price;
    ub.price = seedPrice + 20_000;
    saveDb(db);

    newProcess();
    expect(loadDb().options.find((option) => option.code === 'ub-1216')!.price).toBe(seedPrice + 20_000);

    newProcess();
    process.env.WING_LOCAL_RESET_ID = 'run-b';
    expect(loadDb().options.find((option) => option.code === 'ub-1216')!.price).toBe(seedPrice);
  });
});

describe('公開カタログのキャッシュと E2E の設定', () => {
  it('ローカル検証モードで初期化するときは、初期化の世代をキャッシュのキーに入れる（本番のキーは変えない）', () => {
    const src = read('lib/data/public-catalog.ts');
    expect(src).toContain('const cachedPublicCatalog = unstable_cache(fetchPublicCatalog, [PUBLIC_CATALOG_CACHE_KEY], PUBLIC_CATALOG_CACHE_OPTIONS);');
    expect(src).toContain("const generation = isLocalMode() ? localResetGeneration() : '';");
    expect(src).toContain('if (!generation) return cachedPublicCatalog();');
    expect(src).toContain('unstable_cache(fetchPublicCatalog, [PUBLIC_CATALOG_CACHE_KEY, generation], PUBLIC_CATALOG_CACHE_OPTIONS)()');
  });

  it('Playwright は実行ごとの値を開発サーバーへ渡す', () => {
    const src = read('playwright.config.ts');
    expect(src).toContain('const LOCAL_RESET_ID = (process.env.WING_LOCAL_RESET_ID ??= `${Date.now()}-${process.pid}`);');
    expect(src).toContain('WING_LOCAL_RESET_ID: LOCAL_RESET_ID,');
  });

  it('ローカル DB は local-reset.ts の判定で初期化する', () => {
    expect(read('lib/data/local-db.ts')).toContain('if (takeLocalReset(localDir())) {');
  });
});
