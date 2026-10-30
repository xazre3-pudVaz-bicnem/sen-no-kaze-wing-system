import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);
const media = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-media-manager.tsx'),
  'utf8'
);
const forms = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/forms.tsx'),
  'utf8'
);
const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);

describe('商品登録 STEP1 の1画面導線', () => {
  const sections = [
    '基本情報',
    '商品の詳細',
    '商品画像',
    'メーカー資料',
    'お客様選択',
    '価格・対象モデル',
    '登録前チェック',
  ];

  it('新規登録画面でSTEP1の実セクションを同じ画面に並べる', () => {
    expect(newPage).toContain('STEP 1の商品情報を1画面で入力し');
    expect(newPage).not.toContain('data-testid="option-registration-step1-outline"');
    expect(newPage).toContain('lockedSections');
    expect(newPage).toContain('基本情報保存後');
    expect(forms).toContain("'1. 基本情報'");
    expect(newPage).not.toContain("content: '1. '");
    expect(newPage).toContain("content: '基本情報を保存して続ける'");
    for (const label of sections) expect(newPage).toContain(label);
  });

  it('基本情報保存後も同じSTEP1で実入力欄を1から7の順に表示する', () => {
    expect(editPage).toContain('title="商品を追加"');
    expect(editPage).toContain('✓ 1. 基本情報を保存しました。');
    expect(editPage).not.toContain('data-testid="option-registration-step1-progress"');
    expect(editPage).toContain('registration-step1-sections');
    expect(editPage).toContain('mode="all"');
    for (const title of ['1. 基本情報', '2. 商品の詳細', '3. 商品画像', '6. 価格・対象モデル']) {
      expect(forms).toContain(title);
    }
    expect(media).toContain('label="4. メーカー資料"');
    expect(variants).toContain('label="5. お客様選択"');
    expect(editPage).not.toContain("content: '1. '");
    expect(editPage).not.toContain("content: '3. 商品画像'");
    expect(editPage).toContain('7. 登録前チェック');
    expect(editPage).toContain('<OptionMediaManager option={clientOption} />');
    expect(editPage).toContain('<OptionVariantManager option={clientOption}');
    expect(editPage).toContain('STEP 2 登録内容確認へ');
  });

  it('最終確認だけはSTEP2として別画面に残す', () => {
    expect(editPage).toContain('STEP 2 登録内容確認');
    expect(editPage).toContain('OptionCustomerPreview');
    expect(editPage).toContain('この内容で登録');
  });
});