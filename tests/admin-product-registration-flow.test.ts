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
  it('商品登録の1〜5を同じ編集画面で案内する', () => {
    for (const label of [
      '1. 商品特定',
      '2. 商品の詳細',
      '3. お客様資料',
      '4. お客様選択',
      '5. 価格設定',
    ]) {
      expect(forms).toContain(label);
    }
    expect(editPage).toContain('6.</span>発注内容確認');
    expect(editPage).toContain('7.</span>お客様画面最終確認');
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
    expect(forms).toContain('標準との差額ではなく、この商品を選んだときの追加金額');
  });

  it('管理画面では商品登録・編集として案内する', () => {
    expect(listPage).toContain('title="商品登録・編集"');
    expect(listPage).toContain('商品を追加');
    expect(nav).toContain("label: '商品登録・編集'");
  });
});
