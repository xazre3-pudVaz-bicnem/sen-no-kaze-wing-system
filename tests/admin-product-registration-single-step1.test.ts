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

describe('商品登録 STEP1 の1画面導線', () => {
  const sections = [
    '基本情報',
    '商品の詳細',
    '画像・資料',
    'お客様選択',
    '価格・対象モデル',
    '登録前チェック',
  ];

  it('新規登録画面でSTEP1の実セクションを同じ画面に並べる', () => {
    expect(newPage).toContain('STEP 1の商品情報を1画面で入力し');
    expect(newPage).not.toContain('data-testid="option-registration-step1-outline"');
    expect(newPage).toContain('lockedSections');
    expect(newPage).toContain('基本情報保存後');
    expect(newPage).toContain("content: '1. '");
    expect(newPage).toContain("content: '基本情報を保存して続ける'");
    for (const label of sections) expect(newPage).toContain(label);
  });

  it('基本情報保存後も同じSTEP1で実入力欄を1から6の順に表示する', () => {
    expect(editPage).toContain('title="商品を追加"');
    expect(editPage).toContain('続けて2〜6を同じSTEP 1の画面で入力してください');
    expect(editPage).not.toContain('data-testid="option-registration-step1-progress"');
    expect(editPage).toContain('registration-step1-sections');
    expect(editPage).toContain('mode="all"');
    expect(editPage).toContain("content: '1. '");
    expect(editPage).toContain("content: '2. '");
    expect(editPage).toContain("content: '3. 画像・資料'");
    expect(editPage).toContain("content: '4. お客様選択'");
    expect(editPage).toContain("content: '5. 価格・対象モデル'");
    expect(editPage).toContain('6. 登録前チェック');
    for (const label of sections) expect(editPage).toContain(label);
  });

  it('最終確認だけはSTEP2として別画面に残す', () => {
    expect(editPage).toContain('STEP 2 登録内容確認');
    expect(editPage).toContain('OptionCustomerPreview');
    expect(editPage).toContain('この内容で登録');
  });
});
