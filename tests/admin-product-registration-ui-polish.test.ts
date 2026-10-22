import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const enhancer = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-ui-enhancer.tsx'),
  'utf8'
);
const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);
const saveBoundary = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-registration-save-boundary.tsx'),
  'utf8'
);

describe('商品登録 UI polish', () => {
  it('カテゴリーはグループ見出しを1回だけ表示し、文字をコンパクトにする', () => {
    expect(enhancer).toContain("document.createElement('optgroup')");
    expect(enhancer).toContain('GROUP_LABEL_PATTERN');
    expect(enhancer).toContain("match?.[2]?.trim()");
    expect(enhancer).toContain("select[name=\"category_id\"]");
    expect(enhancer).toContain('setNativeSelectValue');
    expect(enhancer).toContain("dispatchEvent(new Event('change', { bubbles: true }))");
    expect(enhancer).toContain("element.style.fontSize = '14px'");
  });

  it('新規登録ではサイズ・仕様を基本情報から隠し、2. 商品の詳細として案内する', () => {
    expect(newPage).toContain('<OptionRegistrationUiEnhancer hideCreateSize />');
    expect(newPage).toContain("['2', '商品の詳細', 'サイズ・仕様・商品説明・メーカー記載の特徴']");
    expect(enhancer).toContain("document.getElementById('size_note-create')");
  });

  it('基本情報保存後は保存完了表示を見せてから2. 商品の詳細へ続ける', () => {
    expect(saveBoundary).toContain('<OptionRegistrationUiEnhancer scrollAfterCreate />');
    expect(enhancer).toContain("params.get('created')");
    expect(enhancer).toContain("document.getElementById('basic-info-saved') ?? document.getElementById('product-details')");
    expect(enhancer).toContain("target.style.scrollMarginTop = '96px'");
    expect(enhancer).toContain("target.scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(editPage).toContain('id="basic-info-saved"');
    expect(editPage).toContain('✓ 1. 基本情報を保存しました。');
  });

  it('長いSTEP1でも保存状態が常時わかる', () => {
    expect(saveBoundary).toContain('option-registration-save-status');
    expect(saveBoundary).toContain('未保存の変更があります');
    expect(saveBoundary).toContain('✓ 保存済み');
    expect(saveBoundary).toContain('保存中…');
  });

  it('カテゴリー別の大きな入力目安は商品登録画面で隠す', () => {
    expect(enhancer).toContain('[data-testid="category-registration-guidance"]');
    expect(enhancer).toContain("guidance.style.display = 'none'");
  });

  it('メイン画像と追加画像を1つの画像ブロックとして見せる', () => {
    expect(enhancer).toContain("document.getElementById('product-main-media')");
    expect(enhancer).toContain("document.getElementById('product-sub-images')");
    expect(enhancer).toContain("registrationWrapper.style.marginTop = '-1.5rem'");
    expect(enhancer).toContain("setLeadingTextIfChanged(heading, '追加画像')");
    expect(enhancer).toContain("setTextIfChanged(uploadLabel, 'または画像ファイルから登録')");
    expect(enhancer).toContain("row.textContent?.trim() === 'サブ画像はまだ登録されていません。'");
  });

  it('お客様選択は部位ごとの選択項目を1つの入口から追加する', () => {
    expect(enhancer).toContain("setTextIfChanged(addButton, '＋ 選択項目を追加')");
    expect(enhancer).toContain("setTextIfChanged(label, '選択項目名')");
    expect(enhancer).toContain('例：床／カウンター／アクセントパネル／浴槽');
    expect(enhancer).toContain("buttons.slice(0, -1).forEach");
  });
});
