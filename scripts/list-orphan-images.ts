/**
 * Supabase Storage（product-images）にあるのに、どの商品・選択肢・商品画像・プレビューにも
 * 紐づいていない画像を一覧する（service role）。
 *   node scripts/list-orphan-images.ts [--out <file>]
 *
 * 用途：seed の再実行で options.image_url が初期値に戻ってしまった際の復旧の手がかり。
 * ファイル自体は消えていないので、URL を商品編集フォームの「画像URL」に貼れば元に戻せる。
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { arg, loadEnv, requireEnv } from './env.ts';

loadEnv();
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = 'product-images';

/** フォルダを再帰的に列挙する（Storage の list は 1 階層ずつ） */
async function walk(prefix: string): Promise<{ path: string; created_at: string | null; size: number }[]> {
  const out: { path: string; created_at: string | null; size: number }[] = [];
  const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });
  if (error) throw new Error(`${prefix}: ${error.message}`);
  for (const e of data ?? []) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (!e.id) out.push(...(await walk(p))); // フォルダ
    else out.push({ path: p, created_at: e.created_at ?? null, size: (e.metadata as { size?: number } | null)?.size ?? 0 });
  }
  return out;
}

const files = await walk('');
const publicUrl = (p: string) => db.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;

const referenced = new Set<string>();
const add = (u: string | null | undefined) => {
  if (u) referenced.add(u.split('?')[0]);
};
for (const [table, col] of [
  ['options', 'image_url'],
  ['option_variant_choices', 'image_url'],
  ['product_images', 'url'],
  ['preview_image_rules', 'url'],
] as const) {
  const { data, error } = await db.from(table).select(col);
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const r of (data ?? []) as Record<string, string | null>[]) add(r[col]);
}

const orphans = files.filter((f) => !referenced.has(publicUrl(f.path)));
const lines = [
  `# 未使用のアップロード画像（${new Date().toISOString().slice(0, 10)}）`,
  `# Storage 内 ${files.length} 件中、どこにも紐づいていないもの ${orphans.length} 件`,
  `# 復旧：商品編集フォームの「画像URL」にこの URL を貼って保存`,
  '',
  ...orphans.map((f) => `${(f.created_at ?? '').slice(0, 16).replace('T', ' ')}\t${Math.round(f.size / 1024)}KB\t${publicUrl(f.path)}`),
];
const out = arg('out');
if (out) fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(lines.slice(0, 3).join('\n'));
console.log(`（一覧は ${out ?? '標準出力'}）`);
if (!out) console.log(lines.slice(4).join('\n'));
