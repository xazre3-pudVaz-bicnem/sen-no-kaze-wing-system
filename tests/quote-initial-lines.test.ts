import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStore } from '@/lib/data/local-store';
import { initialSiteworkLinesToAdd } from '@/lib/domain/quote-initial-lines';
import { seedCategories, seedModels, seedOptions } from '@/lib/seed/catalog';
import { INITIAL_QUOTE_LINES } from '@/lib/seed/quote-initial-lines';

/** A-3（2026-11-04 先方回答）：別途工事の 9 品目は商品台帳から削除し、代理店の見積編集の初期明細（9 種類の工事）にする */

const NAMES = ['運送費', '設計監理及び確認申請費', '梱包養生', '現場設置工事', '電気設備工事', '給排水給湯設備工事', '基礎工事（設置後工事）', '廃材処分費', '別途現場諸費用'];
const migration = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261104110000_remove_sitework_catalog.sql'), 'utf8');

describe('初期明細（9 種類の工事）', () => {
  it('初期値は削除した 9 品目の名前・並び順のまま（単位は式）', () => {
    expect(INITIAL_QUOTE_LINES.map((line) => line.name)).toEqual(NAMES);
    expect(INITIAL_QUOTE_LINES.every((line) => line.section_code === 'sitework' && line.unit === '式')).toBe(true);
    expect(INITIAL_QUOTE_LINES.map((line) => line.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('Supabase の migration も同じ 9 件を入れる', () => {
    const inserted = [...migration.matchAll(/\('sitework', '([^']+)', '式', (\d+)\)/g)].map((m) => `${m[2]}:${m[1]}`);
    expect(inserted).toEqual(NAMES.map((name, index) => `${index + 1}:${name}`));
  });

  it('第 1 版を初めて編集するときだけ並べ、第 2 版以降の編集では並べない', () => {
    expect(initialSiteworkLinesToAdd(1, ['本体一式'], INITIAL_QUOTE_LINES).map((line) => line.name)).toEqual(NAMES);
    expect(initialSiteworkLinesToAdd(2, ['本体一式'], INITIAL_QUOTE_LINES)).toEqual([]);
  });

  it('前の版に同じ名前の行がある工事は足さない（9 品目を商品として選んでいた頃の見積と重ならない）', () => {
    const lines = initialSiteworkLinesToAdd(1, ['本体一式', ' 運送費 ', '電気設備工事'], INITIAL_QUOTE_LINES);
    expect(lines.map((line) => line.name)).toEqual(NAMES.filter((name) => name !== '運送費' && name !== '電気設備工事'));
  });

  it('並び順で並べる（マスターの並びが乱れていても同じ順）', () => {
    const shuffled = [...INITIAL_QUOTE_LINES].reverse();
    expect(initialSiteworkLinesToAdd(1, [], shuffled).map((line) => line.name)).toEqual(NAMES);
  });
});

describe('初期データ（ローカル検証モード・Supabase の初回投入）', () => {
  it('別途工事のカテゴリーと 9 品目は無い', () => {
    expect(seedCategories.some((category) => category.code === 'sitework')).toBe(false);
    expect(seedOptions.some((option) => option.code.startsWith('sw-'))).toBe(false);
  });

  it('本体のプランの標準構成にも 9 品目は無い', () => {
    const codes = seedModels.flatMap((model) => (model.presets ?? []).flatMap((preset) => preset.option_codes));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.some((code) => code.startsWith('sw-'))).toBe(false);
    // 標準構成の商品は、すべて初期データにある
    const known = new Set(seedOptions.map((option) => option.code));
    expect(codes.filter((code) => !known.has(code))).toEqual([]);
  });
});

describe('ローカル検証モードの読み取り', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wing-initial-lines-'));
    process.env.WING_LOCAL_DIR = dir;
  });
  afterEach(() => {
    delete process.env.WING_LOCAL_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('別途工事の初期明細を並び順で返す', async () => {
    const lines = await new LocalStore().listQuoteInitialLines('sitework');
    expect(lines.map((line) => line.name)).toEqual(NAMES);
  });
});
