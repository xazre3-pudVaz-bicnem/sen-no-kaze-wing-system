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
  it('商品登録を2つの大きな作業単位にまとめる', () => {
    for (const label of ['商品情報', '内容確認・登録']) {
      expect(editPage).toContain(label);
      expect(newPage).toContain(label);
    }
    expect(editPage).toContain('aria-label="商品登録の2ステップ"');
    expect(editPage).toContain('mode="product"');
    expect(editPage).toContain('mode="pricing"');
    expect(editPage).toContain('data-testid="option-registration-info"');
    expect(editPage).toContain('data-testid="option-customer-preview"');
    expect(editPage).not.toContain('発注内容確認');
    expect(editPage).not.toContain('商品登録の7ステップ');
  });
  it('新規登録でも2STEPとreturn_to導線を案内する', () => {
    expect(newPage).toContain('商品登録の2ステップ');
    expect(newPage).toContain('登録して見積テンプレートへ戻る');
    expect(newPage).toContain('return_to');
    expect(forms).toContain('登録して見積テンプレートへ戻る');
    expect(forms).toContain('商品を作成して次へ');
  });

  it('正式商品とフリー商品の登録導線を分ける', () => {
    expect(newPage).toContain('requestedFreeCategory');
    expect(newPage).toContain('FREE_PRODUCT_CATEGORY_CODE');
    expect(editPage).toContain("'/admin/free-products'");
    expect(listPage).toContain('catalogOptions');
  });
  it('商品特定は既存値を候補として使える', () => {
    expect(forms).toContain('option-manufacturer-suggestions');
    expect(forms).toContain('option-model-no-suggestions');
    expect(forms).toContain('既存商品にあるメーカーは候補から選べます');
    expect(forms).toContain('現在の商品マスターではシリーズ名と型番を1項目で管理します');
    expect(forms).toContain('型番・品番');
  });

  it('商品情報画面にメイン画像・サブ画像・メーカーPDFをまとめる', () => {
    expect(forms).toContain('メイン画像');
    expect(media).toContain('サブ画像・メーカー資料');
    expect(media).toContain('メイン画像＋必要なサブ画像');
    expect(media).toContain('PDF内の複数ページはそのまま利用できます');
    expect(media).toContain('登録済みPDFを確認');
    expect(media).not.toContain('<details id="product-media"');
  });

  it('お客様選択は画像なし文字カードを許容し、価格設定と同じSTEP2内で管理する', () => {
    expect(variants).toContain('お客様選択');
    expect(variants).toContain('文字カードとして表示');
    expect(variants).toContain('価格・公開設定');
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

  it('商品価格と標準品との差額を混同しない', () => {
    expect(forms).toContain('価格・公開設定');
    expect(forms).toContain('商品価格（税別・円）');
    expect(forms).toContain('標準品との差額は別途の計算で扱います');
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
