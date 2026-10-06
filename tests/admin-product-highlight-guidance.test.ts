import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forms = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/forms.tsx'),
  'utf8'
);
const productDetail = fs.readFileSync(
  path.resolve(process.cwd(), 'components/simulator/product-detail.tsx'),
  'utf8'
);

describe('商品特徴の登録方針', () => {
  it('メーカー資料に根拠がある場合だけ任意入力する案内にする', () => {
    expect(forms).toContain('メーカー記載の特徴（任意）');
    expect(forms).toContain('メーカー資料・カタログに明確な記載がある場合のみ入力。記載がなければ空欄で構いません。');
    expect(forms).toContain('サイズ、説明、メーカー資料に記載された特徴など、商品を理解するための情報を整理します。');
    expect(forms).not.toContain('label="お客様向け特徴"');
    expect(forms).not.toContain('例：標準候補／清掃性が高い／節水仕様');
  });

  it('highlightの保存項目は残し、空欄なら商品詳細にバッジを表示しない', () => {
    expect(forms).toContain('name="highlight" defaultValue={option?.highlight ?? \'\'}');
    expect(productDetail).toContain('{option.highlight && (');
    expect(productDetail).toContain('{option.highlight}');
  });
});
