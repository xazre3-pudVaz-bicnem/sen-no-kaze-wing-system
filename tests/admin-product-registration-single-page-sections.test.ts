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

describe('商品登録 STEP 1 の1画面構成', () => {
  it('進捗カード一覧を廃止し、実セクション名へ1〜7の番号を付ける', () => {
    expect(newPage).not.toContain('option-registration-step1-outline');
    expect(editPage).not.toContain('option-registration-step1-progress');

    for (const entry of [
      "['2', '商品の詳細'",
      "['3', '商品画像'",
      "['4', 'メーカー資料'",
      "['5', 'お客様選択'",
      "['6', '価格・対象モデル'",
      "['7', '登録前チェック'",
    ]) {
      expect(newPage).toContain(entry);
    }
    expect(newPage).toContain('{no}. {label}');

    expect(newPage).toContain("content: '1. '");
    expect(editPage).toContain("content: '1. '");
    expect(editPage).toContain("content: '2. '");
    expect(editPage).toContain("content: '3. 商品画像'");
    expect(media).toContain('4. メーカー資料');
    expect(editPage).toContain("content: '5. お客様選択'");
    expect(editPage).toContain("content: '6. 価格・対象モデル'");
    expect(editPage).toContain('7. 登録前チェック');
  });

  it('新規登録時もSTEP1全体を同じ画面上に見せる', () => {
    expect(newPage).toContain('lockedSections.map');
    expect(newPage).toContain('基本情報保存後');
    expect(newPage).toContain('同じSTEP 1の続きとして入力できます');
    expect(newPage).toContain("content: '基本情報を保存して続ける'");
  });

  it('下書き作成後は実入力欄を1→7の順に並べる', () => {
    expect(editPage).toContain('.registration-step1-sections > form#option-main-form { display: contents; }');
    expect(editPage).toContain('#product-identify { order: 10; }');
    expect(editPage).toContain('#product-details { order: 20; }');
    expect(editPage).toContain('#product-main-media { order: 30; }');
    expect(editPage).toContain('style={{ order: 35 }}');
    expect(editPage).toContain('style={{ order: 40 }}');
    expect(editPage).toContain('#sales-settings { order: 50; }');
    expect(editPage).toContain('style={{ order: 60 }}');
  });
});