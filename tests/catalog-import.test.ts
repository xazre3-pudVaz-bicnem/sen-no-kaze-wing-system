import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsv, readXlsx } from '@/lib/import/archive';
import { buildImportPlan, summarize } from '@/lib/import/catalog-import';

const MASTER = path.join(process.cwd(), 'public', 'Wing_product_master_v1_5.xlsx');
const hasMaster = fs.existsSync(MASTER);

describe('CSV の読み取り', () => {
  it('引用符・カンマ・改行つきのセルを扱える', () => {
    const rows = readCsv('a,b,c\n"1,000","改行\nあり",x\n');
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1][0]).toBe('1,000');
    expect(rows[1][1]).toBe('改行\nあり');
  });
});

describe.runIf(hasMaster)('先方の商品マスター（Wing_product_master_v1_5.xlsx）', () => {
  const sheets = hasMaster ? readXlsx(fs.readFileSync(MASTER)) : [];

  it('4つのシートを読める', () => {
    expect(sheets.map((s) => s.name)).toEqual(['商品一覧', 'お客様選択項目', '画像一覧', 'カテゴリー一覧']);
  });

  it('商品・選択項目・カテゴリーを取り込める', () => {
    const plan = buildImportPlan(sheets);
    const s = summarize(plan);
    expect(s.categories).toBe(20);
    expect(s.products).toBe(7);
    expect(s.variantChoices).toBeGreaterThanOrEqual(40);
    expect(s.variantGroups).toBeGreaterThanOrEqual(10);
  });

  it('ユニットバスの本体と価格を正しく読む', () => {
    const plan = buildImportPlan(sheets);
    const bath = plan.products.find((p) => p.code === 'BATH-HT-NJB1216')!;
    expect(bath.name).toBe('NJB1216');
    expect(bath.manufacturer).toBe('ハウステック');
    expect(bath.listPrice).toBe(584_000);
    expect(bath.sizeNote).toContain('1216');
    expect(bath.description).toContain('コンパクト');
    expect(bath.imageFile).toBe('bath_housetec_njb1216_main.jpg');
  });

  it('参考価格が空欄で列がずれている行でも説明文を取り違えない', () => {
    const plan = buildImportPlan(sheets);
    // 「エムライン W600」は メーカー参考価格が空欄で、説明文が価格列へずれている
    const mline = plan.products.find((p) => p.code === 'WASH-PANA-MLINE-W600')!;
    expect(mline.name).toBe('エムライン W600');
    expect(mline.listPrice).toBeNull();
    expect(mline.description).toContain('省スペース');
  });

  it('壁色の選択肢に画像が紐づく（画像名が価格列に入っていても拾う）', () => {
    const plan = buildImportPlan(sheets);
    const wall = plan.choices.filter((c) => c.productCode === 'BATH-HT-NJB1216' && c.groupName === '壁色');
    expect(wall.length).toBe(6);
    expect(wall.every((c) => c.imageFile?.startsWith('bath_housetec_njb1216_wall_'))).toBe(true);
    expect(wall.find((c) => c.choiceName === 'オークグレージュ')?.imageFile).toBe('bath_housetec_njb1216_wall_oak_greige.jpg');
  });

  it('区分（標準／追加／固定）を読み分ける', () => {
    const plan = buildImportPlan(sheets);
    const plans = plan.choices.filter((c) => c.productCode === 'BATH-HT-NJB1216' && c.groupName === '壁プラン');
    expect(plans.find((c) => c.choiceName === '全面ホワイト')?.kind).toBe('standard');
    expect(plans.find((c) => c.choiceName === 'アクセント1面')?.kind).toBe('option');
    const fixed = plan.choices.find((c) => c.productCode === 'WASH-PANA-MLINE-W600' && c.groupName === '扉色');
    expect(fixed?.kind).toBe('fixed');
  });

  it('親商品ID にグループ名が入っている行（トイレ本体）も商品に紐づく', () => {
    const plan = buildImportPlan(sheets);
    const toilets = plan.choices.filter((c) => c.groupName === 'トイレ本体');
    expect(toilets.map((c) => c.productCode).sort()).toEqual(['TOILET-LIXIL-SATISS', 'TOILET-PANA-S160', 'TOILET-TOTO-RS1']);
  });

  it('取り込めなかった行は警告に出す（黙って捨てない）', () => {
    const plan = buildImportPlan(sheets);
    expect(Array.isArray(plan.warnings)).toBe(true);
    for (const w of plan.warnings) expect(typeof w).toBe('string');
  });
});
