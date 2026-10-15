import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  hasPowerSpec,
  normalizePowerSpec,
  productRequiresPowerSpec,
} from '@/lib/domain/product-power-spec';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const page = read('app/admin/options/[id]/page.tsx');
const field = read('components/admin/product-power-spec.tsx');
const saveBoundary = read('components/admin/option-registration-save-boundary.tsx');
const action = read('lib/actions/product-power-spec.ts');
const migration = read('supabase/migrations/20261015180000_option_power_spec.sql');

describe('商品登録 電源仕様', () => {
  it('表示名ではなくカテゴリーcodeで空調だけを必須判定する', () => {
    expect(productRequiresPowerSpec('aircon')).toBe(true);
    expect(productRequiresPowerSpec('lighting')).toBe(false);
    expect(productRequiresPowerSpec('kitchen')).toBe(false);
    expect(productRequiresPowerSpec('空調')).toBe(false);
    expect(productRequiresPowerSpec('エアコン')).toBe(false);
  });

  it('空白だけの電源仕様を未入力として扱う', () => {
    expect(normalizePowerSpec('   ')).toBeNull();
    expect(hasPowerSpec('\t\n')).toBe(false);
    expect(normalizePowerSpec(' 単相100V・15A（専用回路） ')).toBe('単相100V・15A（専用回路）');
  });

  it('STEP1で能力クラスと電源仕様を分離し、空調の電源仕様を必須表示する', () => {
    expect(field).toContain("const AIRCON_CAPACITY_LABEL = '能力クラス・容量'");
    expect(field).toContain("const POWER_SPEC_PLACEHOLDER = '単相100V・15A（専用回路）'");
    expect(field).toContain('メーカー公式資料に記載された電源仕様を入力してください。');
    expect(field).toContain("setCustomValidity('電源仕様を入力してください')");
    expect(page).toContain('airconCategoryId');
    expect(page).toContain('<ProductPowerSpecRegistrationField');
  });

  it('STEP2へ進む前にHTML必須検証と専用列保存を完了する', () => {
    expect(saveBoundary).toContain('form.reportValidity()');
    expect(saveBoundary).toContain('for (const handler of handlers)');
    expect(action).toContain('.update({ power_spec: value })');
    expect(page).toContain("error: '電源仕様を入力してください'");
  });

  it('STEP2と登録済み商品詳細で電源仕様を確認・再編集できる', () => {
    expect(page).toContain('<ProductPowerSpecSummary value={powerSpec} />');
    expect(page).toContain('<ProductPowerSpecPublishedCard');
    expect(field).toContain('data-testid="product-power-spec-summary"');
    expect(field).toContain('data-testid="product-power-spec-published-editor"');
  });

  it('公開処理も空調の電源仕様なしをサーバー側で拒否する', () => {
    expect(action).toContain('publishOptionWithPowerSpecAction');
    expect(action).toContain('productRequiresPowerSpec(category.code)');
    expect(action).toContain("previewErrorUrl(id, formData, '電源仕様を入力してください')");
    expect(page).toContain('action={publishOptionWithPowerSpecAction}');
  });

  it('DB列はnullableのadditive変更だけで既存商品を書き換えない', () => {
    expect(migration).toContain('add column if not exists power_spec text');
    expect(migration.toLowerCase()).not.toContain('not null');
    expect(migration.toLowerCase()).not.toContain('update public.options');
    expect(migration.toLowerCase()).not.toContain('delete from public.options');
  });

  it('電源仕様保存処理は価格・選択項目・追加価格を変更しない', () => {
    expect(action).not.toContain('.update({ price:');
    expect(action).not.toContain('extra_price');
    expect(action).not.toContain('variant_choice');
    expect(action).not.toContain('list_price:');
  });
});
