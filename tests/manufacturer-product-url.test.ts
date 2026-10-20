import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optionSchema } from '@/lib/validation';

const source = (path: string) => readFileSync(path, 'utf8');
const field = optionSchema.shape.manufacturer_product_url;

describe('メーカー公式商品ページの任意リンク', () => {
  it('既存商品・未入力ではNULLとなり、既存の保存経路を壊さない', () => {
    expect(field.parse(undefined)).toBeNull();
    expect(field.parse(null)).toBeNull();
    expect(field.parse('')).toBeNull();
    expect(field.parse('  ')).toBeNull();
  });

  it('HTTPSのメーカー商品ページURLをトリムして保持する', () => {
    expect(field.parse(' https://www.lixil.co.jp/lineup/entrance/giesta/ ')).toBe(
      'https://www.lixil.co.jp/lineup/entrance/giesta/'
    );
  });

  it('非HTTPS・不正URL・認証情報つきURL・1000文字超過を拒否する', () => {
    const invalid = [
      'http://www.lixil.co.jp/product',
      'javascript:alert(1)',
      'data:text/html,test',
      'https://user:pass@www.lixil.co.jp/',
      'not a URL',
      'https://www.lixil.co.jp/' + 'a'.repeat(1000),
    ];
    for (const url of invalid) expect(field.safeParse(url).success).toBe(false);
  });

  it('STEP1フォーム・保存・共通商品詳細が同じ項目を利用する', () => {
    const form = source('components/admin/forms.tsx');
    const actions = source('lib/actions/admin.ts');
    const detail = source('components/simulator/product-detail.tsx');
    const preview = source('components/admin/option-customer-preview.tsx');
    expect(form).toContain('name="manufacturer_product_url"');
    expect(form).toContain('value={option.manufacturer_product_url ??');
    expect(actions).toContain("manufacturer_product_url: formData.get('manufacturer_product_url')");
    expect(detail).toContain('safeManufacturerProductUrl(option.manufacturer_product_url)');
    expect(detail).toContain('data-testid="manufacturer-product-link"');
    expect(detail).toContain('target="_blank"');
    expect(detail).toContain('rel="noopener noreferrer"');
    expect(preview).toContain('<ProductDetail');
  });

  it('migrationはNULL可で、画像/PDF・金額・権限の構造を変更しない', () => {
    const sql = source('supabase/migrations/20261020140000_manufacturer_product_url.sql');
    expect(sql).toContain('add column manufacturer_product_url text;');
    expect(sql).toContain('manufacturer_product_url is null');
    expect(sql).toContain('options_manufacturer_product_url_https_check');
    expect(sql).not.toMatch(/(drop table|drop column|delete from|update public\.)/i);
  });
});
