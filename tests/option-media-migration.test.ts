import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationName = '20260915030000_option_media.sql';
const migrationPath = path.resolve(process.cwd(), 'supabase/migrations', migrationName);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('商品メディア migration', () => {
  it('Standard Estimate基盤より後のmigration番号を使う', () => {
    expect(migrationName.localeCompare('20260915012500_standard_estimate_foundation.sql')).toBeGreaterThan(0);
  });

  it('既存のoptions.image_urlを残したままメーカー資料URLとサブ画像を追加する', () => {
    expect(sql).toContain('add column if not exists manufacturer_document_url text');
    expect(sql).toContain('create table if not exists public.option_images');
    expect(sql).toContain('option_id uuid not null references public.options(id) on delete cascade');
    expect(sql).not.toMatch(/drop\s+column\s+(if\s+exists\s+)?image_url/i);
  });

  it('DB直操作でも商品メディアURLを親option固有prefixに限定する', () => {
    expect(sql).toContain('option_images_owned_storage_url_check');
    expect(sql).toContain("'/storage/v1/object/public/product-images/option-' || option_id::text || '/gallery/'");
    expect(sql).toContain('options_manufacturer_document_owned_url_check');
    expect(sql).toContain("'/storage/v1/object/public/product-documents/option-' || id::text || '/manufacturer/'");
  });

  it('options_adminはdealerの直接API更新を自分のfree-productだけに限定する', () => {
    expect(sql).toContain('drop policy if exists options_admin on public.options');
    expect(sql).toContain('create policy options_admin on public.options');
    expect(sql).toContain('and owner_id = auth.uid()');
    expect(sql).toContain("and c.code = 'free-product'");
    expect(sql).toMatch(/with check[\s\S]*owner_id = auth\.uid\(\)[\s\S]*c\.code = 'free-product'/);
  });

  it('option_imagesは公開商品を読め、dealer writeは自分のfree-productだけに限定する', () => {
    expect(sql).toContain('alter table public.option_images enable row level security');
    expect(sql).toMatch(/o\.status\s*=\s*'published'/);
    expect(sql).toContain('public.can_edit_catalog()');
    expect(sql).toMatch(/option_images_write[\s\S]*o\.owner_id = auth\.uid\(\)[\s\S]*c\.id = o\.category_id[\s\S]*c\.code = 'free-product'/);
    expect(sql).toMatch(/with check[\s\S]*o\.owner_id = auth\.uid\(\)[\s\S]*c\.code = 'free-product'/);
  });

  it('メーカー資料はPDF専用の公開bucketとし、直接write policyを作らない', () => {
    expect(sql).toContain("'product-documents'");
    expect(sql).toContain("array['application/pdf']");
    expect(sql).toContain('20971520');
    expect(sql).toContain('"product documents public read"');
    expect(sql).not.toMatch(/create policy\s+"?product documents[^"]*(insert|update|delete)/i);
  });
});
