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

  it('option_imagesは公開商品を読め、編集権限または所有者だけが書ける', () => {
    expect(sql).toContain('alter table public.option_images enable row level security');
    expect(sql).toMatch(/o\.status\s*=\s*'published'/);
    expect(sql).toContain('public.can_edit_catalog()');
    expect(sql).toContain('public.is_dealer() and o.owner_id = auth.uid()');
  });

  it('メーカー資料はPDF専用の公開bucketとし、直接write policyを作らない', () => {
    expect(sql).toContain("'product-documents'");
    expect(sql).toContain("array['application/pdf']");
    expect(sql).toContain('20971520');
    expect(sql).toContain('"product documents public read"');
    expect(sql).not.toMatch(/create policy\s+"?product documents[^"]*(insert|update|delete)/i);
  });
});
