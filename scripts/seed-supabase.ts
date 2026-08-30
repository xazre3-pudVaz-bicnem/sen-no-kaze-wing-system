/**
 * 初期データを Supabase へ投入する（service role）。
 *   node scripts/seed-supabase.ts            … 既存行は触らず、シードにあって DB に無い行だけ追加（既定・安全）
 *   node scripts/seed-supabase.ts --force    … 既存行もシードの値で上書き（管理画面の登録を消す。初期構築時のみ）
 *   node scripts/seed-supabase.ts --prune    … シードに無い行を削除（--force と同様に初期構築時のみ）
 *
 * 2026-08-30 の事故を受けて既定を「追加のみ」にした：
 *   上書き upsert を本番で再実行したため、管理画面から登録された商品画像（options.image_url）や
 *   本体内訳マスターの編集がシードの初期値に戻ってしまった。運用開始後の本番では --force を使わないこと。
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env.ts';
import { seedCatalog } from '../lib/seed/catalog.ts';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
// 既定は「追加のみ」。--force のときだけ既存行を上書きする（旧 --skip-existing は既定動作になった）
const force = process.argv.includes('--force');
const skipExisting = !force;
const prune = process.argv.includes('--prune');
if (force || prune) {
  console.warn('⚠ --force / --prune は管理画面の登録内容を上書き・削除します。運用中の本番では実行しないでください。');
}
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

/**
 * 依存・競合は (option_id, 相手) に一意制約がある。
 * 一括登録 RPC などで別 ID の同内容行が既にあると id 基準の upsert が重複エラーになるため、
 * 自然キーで upsert する（id は送らない）。
 */
async function upsertByPair(table: string, rows: Record<string, unknown>[], conflictCols: string) {
  const noId = rows.map(({ id: _id, ...rest }) => rest);
  const { error } = await db.from(table).upsert(noId, { onConflict: conflictCols });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`${table}: ${noId.length} rows`);
}
await upsertByPair('option_dependencies', seedCatalog.dependencies as unknown as Record<string, unknown>[], 'option_id,requires_option_id');
await upsertByPair('option_conflicts', seedCatalog.conflicts as unknown as Record<string, unknown>[], 'option_id,conflicts_with_option_id');
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
