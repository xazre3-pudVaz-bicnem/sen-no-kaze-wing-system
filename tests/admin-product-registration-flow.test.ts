import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forms = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/forms.tsx'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);
const newPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/new/page.tsx'),
  'utf8'
);
const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/page.tsx'),
  'utf8'
);
const nav = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'),
  'utf8'
);
const media = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-media-manager.tsx'),
  'utf8'
);
const variants = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);

describe('商品登録管理画面の業務フロー', () => {
  it('編集画面を7ステップで切り替える', () => {
    for (const label of [
      '商品特定',
      '商品の詳細',
      'お客様資料',
      'お客様選択',
      '価格設定',
      '発注内容確認',
      'お客様画面最終確認',
    ]) {
      expect(editPage).toContain(label);
    }
    expect(editPage).toContain('mode="identify"');
    expect(editPage).toContain('mode="details"');
    expect(editPage).toContain('mode="media"');
    expect(editPage).toContain('mode="pricing"');
    expect(editPage).toContain('aria-current={active ? \'step\' : undefined}');
    expect(editPage).toContain('data-testid="option-order-preview"');
    expect(editPage).toContain('data-testid="option-customer-preview"');
  });

  it('新規登録でも7ステップの全体像とreturn_to導線を案内する', () => {
    expect(newPage).toContain('商品登録の7ステップ');
    expect(newPage).toContain('登録して見積テンプレートへ戻る');
    expect(newPage).toContain('return_to');
    expect(forms).toContain('登録して見積テンプレートへ戻る');
    expect(forms).toContain('商品を保存して続きの設定へ');
  });

  it('商品特定は既存値を候補として使える', () => {
    expect(forms).toContain('option-manufacturer-suggestions');
    expect(forms).toContain('option-model-no-suggestions');
    expect(forms).toContain('既存商品にあるメーカーは候補から選べます');
    expect(forms).toContain('現在の商品マスターではシリーズ名と型番を1項目で管理します');
  });

  it('お客様資料はメイン画像・サブ画像・メーカーPDFを同じSTEPで確認できる', () => {
    expect(forms).toContain('STEP 3 お客様資料');
    expect(media).toContain('サブ画像・メーカー資料');
    expect(media).toContain('メイン画像＋必要なサブ画像');
    expect(media).toContain('PDF内の複数ページはそのまま利用できます');
    expect(media).toContain('登録済みPDFを確認');
    expect(media).not.toContain('<details id="product-media"');
  });

  it('お客様選択は画像なし文字カードを許容し、追加金額はSTEP 5へ分離する', () => {
    expect(variants).toContain('STEP 4 お客様選択');
    expect(variants).toContain('文字カードとして表示');
    expect(variants).toContain('追加金額は STEP 5');
    expect(variants).toContain('色・仕様ごとの追加金額');
    expect(variants).toContain('ChoicePriceEditor');
    expect(variants).toContain('name="extra_price"');
  });

  it('既存の商品保存フィールドを維持する', () => {
    for (const name of [
      'name',
      'code',
      'category_id',
      'base_model_id',
      'manufacturer',
      'model_no',
      'size_note',
      'highlight',
      'list_price',
      'price',
      'sort_order',
      'selection_type',
      'status',
      'description',
      'is_default',
      'is_required',
      'is_installation',
      'price_on_request',
      'image_file',
      'image_url',
      'preview_key',
      'affects_views',
      'spec_codes',
      'requires',
      'conflicts',
    ]) {
      expect(forms).toContain(`name="${name}"`);
    }
  });

  it('価格は追加金額として案内する', () => {
    expect(forms).toContain('STEP 5 価格設定');
    expect(forms).toContain('追加金額（税別・円）');
    expect(forms).toContain('この商品を選んだときに加算する金額');
  });

  it('商品一覧は検索・カテゴリー・公開状態で絞り込める', () => {
    expect(listPage).toContain('name="q"');
    expect(listPage).toContain('name="category"');
    expect(listPage).toContain('name="status"');
    expect(listPage).toContain('商品名・メーカー・型番');
  });

  it('管理画面では商品登録・編集として案内する', () => {
    expect(listPage).toContain('title="商品登録・編集"');
    expect(listPage).toContain('商品を追加');
    expect(nav).toContain("label: '商品登録・編集'");
  });
});
