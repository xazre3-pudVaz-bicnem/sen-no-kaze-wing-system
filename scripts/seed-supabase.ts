/**
 * 初期データを Supabase へ投入する（service role）。
 *   node scripts/seed-supabase.ts
 * 何度実行しても同じ ID に upsert されるため安全。
 * 既存の管理画面での変更を上書きしたくない場合は --skip-existing を付ける。
 * 商品台帳を作り直したあと、旧データの残骸を消したい場合は --prune を付ける。
 *   （保存済みプランから参照されている商品は外部キーで守られ、削除されずエラーになる）
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env.ts';
import { seedCatalog } from '../lib/seed/catalog.ts';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const skipExisting = process.argv.includes('--skip-existing');
const prune = process.argv.includes('--prune');
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
await upsert('preview_hotspots', seedCatalog.hotspots as unknown as Record<string, unknown>[]);
await upsert('option_variant_groups', seedCatalog.variantGroups as unknown as Record<string, unknown>[]);
await upsert('option_variant_choices', seedCatalog.variantChoices as unknown as Record<string, unknown>[]);
await upsert('base_breakdown_items', seedCatalog.baseBreakdownItems as unknown as Record<string, unknown>[]);

/** シードに存在しない行（旧台帳の残骸）を削除する。子テーブルから順に消す */
async function pruneTable(table: string, keepIds: string[]) {
  const { data, error } = await db.from(table).select('id');
  if (error) throw new Error(`${table}: ${error.message}`);
  const keep = new Set(keepIds);
  const stale = (data ?? []).map((r: { id: string }) => r.id).filter((id) => !keep.has(id));
  if (!stale.length) {
    console.log(`${table}: prune 0`);
    return;
  }
  const { error: delError } = await db.from(table).delete().in('id', stale);
  if (delError) throw new Error(`${table}: 削除できませんでした（保存済みプランから参照されている可能性があります）: ${delError.message}`);
  console.log(`${table}: prune ${stale.length}`);
}

if (prune) {
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
  await pruneTable('base_breakdown_items', ids(seedCatalog.baseBreakdownItems));
  await pruneTable('option_variant_choices', ids(seedCatalog.variantChoices));
  await pruneTable('option_variant_groups', ids(seedCatalog.variantGroups));
  await pruneTable('preview_hotspots', ids(seedCatalog.hotspots));
  await pruneTable('option_conflicts', ids(seedCatalog.conflicts));
  await pruneTable('option_dependencies', ids(seedCatalog.dependencies));
  await pruneTable('preview_image_rules', ids(seedCatalog.previewRules));
  await pruneTable('options', ids(seedCatalog.options));
  await pruneTable('option_categories', ids(seedCatalog.categories));
  await pruneTable('product_images', ids(seedCatalog.images));
}

console.log('done');
