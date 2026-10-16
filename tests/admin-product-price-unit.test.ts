import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeProductPriceUnit,
  productPriceUnitDefaults,
  PRODUCT_PRICE_UNIT_PRESETS,
} from '@/lib/domain/product-price-unit';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
const field = read('components/admin/product-price-unit.tsx');
const host = read('components/admin/product-power-spec.tsx');
const preview = read('components/admin/option-customer-preview.tsx');
const ledger = read('components/admin/product-ledger-client.tsx');
const action = read('lib/actions/product-price-unit.ts');
const migration = read('supabase/migrations/20261016110000_option_price_units.sql');

describe('商品登録 価格単位', () => {
  it('見積書で使う単位をプルダウン候補として持ち、その他は自由入力にする', () => {
    expect(PRODUCT_PRICE_UNIT_PRESETS).toEqual([
      '式', '台', '個', '枚', '本', 'セット', 'ケース', 'm', '㎡', '坪', '人',
    ]);
    expect(field).toContain('その他（自由入力）');
    expect(field).toContain('例：箱、束、ロール');
  });

  it('商品価格単位はカテゴリーcodeから初期値を決める', () => {
    expect(productPriceUnitDefaults('floor').priceUnit).toBe('ケース');
    expect(productPriceUnitDefaults('wall-ceiling').priceUnit).toBe('㎡');
    expect(productPriceUnitDefaults('roof').priceUnit).toBe('㎡');
    expect(productPriceUnitDefaults('aircon').priceUnit).toBe('台');
    expect(productPriceUnitDefaults('sash').priceUnit).toBe('セット');
    expect(productPriceUnitDefaults('interior-door').priceUnit).toBe('枚');
    expect(productPriceUnitDefaults('床').priceUnit).toBeNull();
  });

  it('メーカー参考価格は単位がぶれやすい建材を未選択にし、明確な設備だけ台を初期値にする', () => {
    expect(productPriceUnitDefaults('floor').listPriceUnit).toBeNull();
    expect(productPriceUnitDefaults('roof').listPriceUnit).toBeNull();
    expect(productPriceUnitDefaults('exterior-wall').listPriceUnit).toBeNull();
    expect(productPriceUnitDefaults('sash').listPriceUnit).toBeNull();
    expect(productPriceUnitDefaults('aircon').listPriceUnit).toBe('台');
    expect(productPriceUnitDefaults('toilet').listPriceUnit).toBe('台');
    expect(productPriceUnitDefaults('kitchen').listPriceUnit).toBe('台');
  });

  it('自由入力単位は前後空白だけ除去して保持する', () => {
    expect(normalizeProductPriceUnit('  ロール  ')).toBe('ロール');
    expect(normalizeProductPriceUnit('㎡')).toBe('㎡');
    expect(normalizeProductPriceUnit('   ')).toBeNull();
  });

  it('STEP1で商品価格とメーカー参考価格の単位を別々に編集し、手動変更後はカテゴリー既定値で上書きしない', () => {
    expect(field).toContain('商品価格の単位');
    expect(field).toContain('メーカー参考価格の単位');
    expect(field).toContain('priceTouchedRef.current = true');
    expect(field).toContain('listTouchedRef.current = true');
    expect(field).toContain('if (!priceTouchedRef.current)');
    expect(field).toContain('if (!listTouchedRef.current)');
    expect(host).toContain('<ProductPriceUnitRegistrationField optionId={optionId} />');
  });

  it('別途見積を選ぶと商品価格と商品価格単位だけ入力不可にし、メーカー参考価格は編集可能のままにする', () => {
    expect(field).toContain('usePriceOnRequestLock');
    expect(field).toContain('input[name="price_on_request"]');
    expect(field).toContain('input[name="price"]');
    expect(field).toContain('priceInput.readOnly = nextLocked');
    expect(field).toContain("priceInput.value = '0'");
    expect(field).toContain('priceInput.dataset.priceBeforeOnRequest');
    expect(field).toContain('disabled={priceOnRequest}');
    expect(field).toContain('disabled={!editable || priceOnRequest}');
    expect(field).toContain('id="manufacturer-list-price-unit"');
    expect(field).toContain('id="published-manufacturer-list-price-unit"');
    expect(field).toContain('「価格は別途見積」が選択されているため、商品価格とこの単位は編集できません。');
  });

  it('既に別途見積の商品を開いただけでは既存の価格数値を強制的に0円へ書き換えない', () => {
    const initialLock = field.indexOf('applyVisualState(checkbox.checked);');
    const zeroOnToggle = field.indexOf("priceInput.value = '0';");
    expect(initialLock).toBeGreaterThan(-1);
    expect(zeroOnToggle).toBeGreaterThan(initialLock);
    expect(field).toContain('既に別途見積で保存済みの商品を開いただけでは、既存の数値を勝手に書き換えない。');
  });

  it('STEP2で価格と単位を組み合わせて確認できる', () => {
    expect(preview).toContain('formatPriceWithUnit(option.price, option.price_unit)');
    expect(preview).toContain('formatPriceWithUnit(option.list_price, option.list_price_unit)');
    expect(preview).toContain('data-testid="registration-price-unit-summary"');
    expect(host).toContain('<ProductPriceUnitRouteSummary />');
  });

  it('商品台帳の一覧・カード・管理情報で商品価格の単位を表示する', () => {
    expect(ledger).toContain('formatPriceWithUnit(option.price, option.price_unit)');
    expect(ledger).toContain('メーカー参考価格（税別）');
    expect(ledger).toContain('formatPriceWithUnit(selected.list_price, selected.list_price_unit)');
  });

  it('登録済み商品でも保存済み単位を個別編集できる', () => {
    expect(field).toContain('data-testid="product-price-unit-published-editor"');
    expect(field).toContain('既存の保存値をカテゴリー既定値で自動上書きしません');
    expect(host).toContain('<ProductPriceUnitPublishedCard optionId={optionId} />');
  });

  it('DB変更はnullable列の追加だけで既存商品・価格・履歴を書き換えない', () => {
    expect(migration).toContain('add column if not exists price_unit text');
    expect(migration).toContain('add column if not exists list_price_unit text');
    expect(migration.toLowerCase()).not.toContain('not null');
    expect(migration.toLowerCase()).not.toContain('update public.options');
    expect(migration.toLowerCase()).not.toContain('delete from public.options');
  });

  it('専用保存処理は価格数値や標準見積・Quoteを変更しない', () => {
    expect(action).toContain('price_unit: priceUnitResult.value');
    expect(action).toContain('list_price_unit: listPriceUnitResult.value');
    expect(action).not.toContain(".from('standard_estimate");
    expect(action).not.toContain(".from('quotes')");
    expect(action).not.toContain('unit_price');
    expect(action).not.toContain('quantity:');
  });
});