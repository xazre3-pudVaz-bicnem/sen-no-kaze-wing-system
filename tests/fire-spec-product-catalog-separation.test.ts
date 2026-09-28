import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('防火仕様を商品カテゴリーから分離する互換境界', () => {
  it('旧防火カテゴリーを互換専用として明示する', () => {
    const types = source('lib/domain/types.ts');
    expect(types).toContain("export const LEGACY_FIRE_SPEC_CATEGORY_CODE = 'fireproof'");
    expect(types).toContain('防火仕様は商品カテゴリーではなく、標準見積・本体仕様を決める条件軸として扱う');
    expect(types).not.toContain('その他／防火仕様／別途工事');
  });

  it('商品台帳と商品登録一覧から旧防火カテゴリー・商品を除外する', () => {
    const ledger = source('app/admin/ledger/page.tsx');
    const options = source('app/admin/options/page.tsx');

    expect(ledger).toContain('LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(ledger).toContain('category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(options).toContain('LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(options).toContain('category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(options).toContain('catalogCategoryIds.has(option.category_id)');
  });

  it('新規商品と通常商品のカテゴリー候補に旧防火カテゴリーを出さない', () => {
    const create = source('app/admin/options/new/page.tsx');
    const edit = source('app/admin/options/[id]/page.tsx');

    expect(create).toContain("allCategories.filter((c) => c.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)");
    expect(edit).toContain("categories.filter((row) => row.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)");
    expect(edit).toContain("category?.code === LEGACY_FIRE_SPEC_CATEGORY_CODE");
  });

  it('カテゴリー管理では防火を商品カテゴリーとして編集対象にしない', () => {
    const categories = source('app/admin/categories/page.tsx');

    expect(categories).toContain('LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(categories).toContain("filter((category) => category.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)");
    expect(categories).toContain('防火仕様は商品カテゴリーではなく、標準見積・本体仕様の条件として管理します');
  });

  it('標準見積の商品選択から旧防火オプションを除外する', () => {
    const estimateNew = source('app/admin/estimate-templates/new/page.tsx');

    expect(estimateNew).toContain('LEGACY_FIRE_SPEC_CATEGORY_CODE');
    expect(estimateNew).toContain("categoryMap.get(option.category_id)?.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE");
  });

  it('旧シミュレーター互換はこのPRでは残す', () => {
    const simulator = source('components/simulator/simulator-app.tsx');
    const seed = source('lib/seed/catalog.ts');

    expect(simulator).toContain("bundle.categories.find((c) => c.code === 'fireproof')");
    expect(simulator).toContain('data-testid="fireproof-select"');
    expect(seed).toContain("fireproof: ['fireproof', '防火仕様', 1]");
    expect(seed).toContain("code: 'fire-standard'");
    expect(seed).toContain("code: 'fire-proof'");
    expect(seed).toContain('正式には標準見積・本体仕様の条件軸として扱う');
  });
});
