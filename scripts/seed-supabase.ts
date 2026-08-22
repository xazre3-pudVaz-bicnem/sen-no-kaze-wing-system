/**
 * 初期データを Supabase へ投入する（service role）。
 *   node scripts/seed-supabase.ts
 * 何度実行しても同じ ID に upsert されるため安全。
 * 既存の管理画面での変更を上書きしたくない場合は --skip-existing を付ける。
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env.ts';
import { seedCatalog } from '../lib/seed/catalog.ts';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const skipExisting = process.argv.includes('--skip-existing');
const db = createClient(url, key, { auth: { persistSession: false } });

async function upsert(table: string, rows: Record<string, unknown>[]) {
  if (skipExisting) {
    const { data } = await db.from(table).select('id');
    const existing = new Set((data ?? []).map((r: { id: string }) => r.id));
    rows = rows.filter((r) => !existing.has(r.id as string));
  }
  if (!rows.length) {
    console.log(`${table}: skip`);
    return;
  }
  const { error } = await db.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${rows.length} rows`);
}

const strip = <T extends { created_at?: string; updated_at?: string }>(rows: T[]) =>
  rows.map((row) => {
    const rest = { ...row } as Record<string, unknown>;
    delete rest.created_at;
    delete rest.updated_at;
    return rest;
  });

await upsert('base_models', strip(seedCatalog.models));
await upsert('product_images', seedCatalog.images as unknown as Record<string, unknown>[]);
await upsert('option_categories', seedCatalog.categories as unknown as Record<string, unknown>[]);
await upsert('options', strip(seedCatalog.options));
await upsert('option_dependencies', seedCatalog.dependencies as unknown as Record<string, unknown>[]);
await upsert('option_conflicts', seedCatalog.conflicts as unknown as Record<string, unknown>[]);
await upsert('preview_image_rules', seedCatalog.previewRules as unknown as Record<string, unknown>[]);
console.log('done');
