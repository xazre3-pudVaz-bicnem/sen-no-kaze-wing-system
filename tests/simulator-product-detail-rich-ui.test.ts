import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const productDetail = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/product-detail.tsx'),
  'utf8'
);

describe('シミュレーター商品詳細の情報表示', () => {
  it('登録済みの色・仕様画像を商品詳細の選択カードに表示する', () => {
    expect(productDetail).toContain('showImages');
    expect(productDetail).toContain('showCurrentValue');
    expect(productDetail).not.toContain('showImages={false}');
    expect(productDetail).not.toContain('showCurrentValue={false}');
  });

  it('画像付き仕様を選ぶと左の商品画像へ連動する', () => {
    expect(productDetail).toContain('const handleVariantChange = (choiceId: string, groupId: string) => {');
    expect(productDetail).toContain("const choice = choices.find((item) => item.id === choiceId);");
    expect(productDetail).toContain("setActiveMedia('image');");
    expect(productDetail).toContain('setActiveImageIndex(imageIndex);');
    expect(productDetail).toContain('onChange={handleVariantChange}');
  });

  it('お客様向け特徴を区分表ではなく商品名直下で訴求する', () => {
    expect(productDetail).toContain('data-testid="product-detail-highlight"');
    expect(productDetail).not.toContain("{ label: '区分', value: option.highlight }");
  });

  it('商品説明とメーカー参考価格を既存の商品マスター値から表示する', () => {
    expect(productDetail).toContain('{option.description && (');
    expect(productDetail).toContain('メーカー参考価格 {formatYen(option.list_price)}');
  });
});
