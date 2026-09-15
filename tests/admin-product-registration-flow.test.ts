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
const listPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/page.tsx'),
  'utf8'
);
const nav = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/admin-nav.tsx'),
  'utf8'
);

describe('商品登録管理画面の業務フロー', () => {
  it('編集画面を3つの分かりやすい領域に整理する', () => {
    expect(editPage).toContain('1');
    expect(editPage).toContain('商品情報');
    expect(editPage).toContain('2');
    expect(editPage).toContain('お客様表示・選択');
    expect(editPage).toContain('3');
    expect(editPage).toContain('販売・詳細設定');
    expect(editPage).toContain('mode="product"');
    expect(editPage).toContain('mode="sales"');
    expect(forms).toContain('詳細設定');
    expect(forms).toContain('通常は変更不要');
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
