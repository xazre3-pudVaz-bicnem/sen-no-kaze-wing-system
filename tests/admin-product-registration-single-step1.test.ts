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

  it('新規登録画面でSTEP1全体の入力順を先に示す', () => {
    expect(newPage).toContain('STEP 1の商品情報を1画面で入力し');
    expect(newPage).toContain('data-testid="option-registration-step1-outline"');
    expect(newPage).toContain('STEP 1は1つの入力画面です');
    expect(newPage).toContain('基本情報を保存すると入力できます');
    for (const label of sections) expect(newPage).toContain(label);
  });

  it('基本情報保存後も同じSTEP1の続きとして表示する', () => {
    expect(editPage).toContain('title="商品を追加"');
    expect(editPage).toContain('同じSTEP 1の続きとして入力できます');
    expect(editPage).toContain('data-testid="option-registration-step1-progress"');
    expect(editPage).toContain('基本情報は保存済みです');
    expect(editPage).toContain('下書き保存済み');
    expect(editPage).toContain('mode="all"');
    for (const label of sections) expect(editPage).toContain(label);
  });

  it('最終確認だけはSTEP2として別画面に残す', () => {
    expect(editPage).toContain('STEP 2 登録内容確認');
    expect(editPage).toContain('OptionCustomerPreview');
    expect(editPage).toContain('この内容で登録');
  });
});
