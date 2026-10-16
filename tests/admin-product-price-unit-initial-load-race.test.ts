import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/product-price-unit.tsx'),
  'utf8'
);

describe('商品価格単位の初期読込', () => {
  it('初期読込が完了する前に変更した商品価格単位を後着の読込結果で上書きしない', () => {
    const savedIndex = source.indexOf('const savedPrice =');
    const guardIndex = source.indexOf('if (!priceTouchedRef.current) {', savedIndex);
    const setIndex = source.indexOf('setPriceEditor(editorFromUnit(savedPrice ?? state.defaultPriceUnit ?? null));', guardIndex);

    expect(savedIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(savedIndex);
    expect(setIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain('priceTouchedRef.current = true;');
  });

  it('初期読込が完了する前に変更したメーカー参考価格単位も後着の読込結果で上書きしない', () => {
    const savedIndex = source.indexOf('const savedList =');
    const guardIndex = source.indexOf('if (!listTouchedRef.current) {', savedIndex);
    const setIndex = source.indexOf('setListEditor(editorFromUnit(savedList ?? state.defaultListPriceUnit ?? null));', guardIndex);

    expect(savedIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThan(savedIndex);
    expect(setIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain('listTouchedRef.current = true;');
  });
});
