/**
 * seed の上書きで消えた商品画像のリンクを、Storage に残っているファイルから復元する（service role）。
 *   node scripts/restore-catalog-images.ts           … 何をどう直すか表示だけ（dry run）
 *   node scripts/restore-catalog-images.ts --apply   … 実際に image_url を更新
 *
 * 仕組み：一括登録でアップロードされたファイルは「0011-bath_housetec_njb1216_wall_oak_greige.jpg」のように
 * 元のファイル名を保っている。一方、シードの商品・選択肢は「/images/catalog/<同じファイル名>」という
 * プレースホルダーを持つ（public には実体が無い）。両者をファイル名で突き合わせて紐づけ直す。
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnv, requireEnv } from './env.ts';

loadEnv();
const db = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const apply = process.argv.includes('--apply');
const BUCKET = 'product-images';

async function walk(prefix: string): Promise<{ path: string; created_at: string }[]> {
  const out: { path: string; created_at: string }[] = [];
  const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`${prefix}: ${error.message}`);
  for (const e of data ?? []) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (!e.id) out.push(...(await walk(p)));
    else out.push({ path: p, created_at: e.created_at ?? '' });
  }
  return out;
}

/** Storage のファイル名（先頭の連番を除く）→ 公開 URL（同名が複数なら新しいもの） */
const byName = new Map<string, { url: string; created_at: string }>();
for (const f of await walk('')) {
  const base = f.path.split('/').pop()!.replace(/^\d+-/, '');
  const url = db.storage.from(BUCKET).getPublicUrl(f.path).data.publicUrl;
  const cur = byName.get(base);
  if (!cur || cur.created_at < f.created_at) byName.set(base, { url, created_at: f.created_at });
}

let planned = 0;
let updated = 0;
for (const [table, label] of [
  ['options', '商品'],
  ['option_variant_choices', '選択肢'],
] as const) {
  const { data, error } = await db.from(table).select('id, code, name, image_url');
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const r of (data ?? []) as { id: string; code: string; name: string; image_url: string | null }[]) {
    const img = r.image_url ?? '';
    // 実体の無いプレースホルダー（/images/catalog/…）だけが対象。Storage の URL や public にある画像は触らない
    if (!img.startsWith('/images/catalog/')) continue;
    const base = img.split('/').pop()!;
    const hit = byName.get(base);
    if (!hit) continue;
    planned++;
    console.log(`${apply ? '更新' : '予定'} ${label} ${r.name}（${r.code}）\n   ${img} → ${hit.url}`);
    if (apply) {
      const { error: e2 } = await db.from(table).update({ image_url: hit.url }).eq('id', r.id);
      if (e2) throw new Error(`${table} ${r.code}: ${e2.message}`);
      updated++;
    }
  }
}
console.log(apply ? `\n${updated} 件を復元しました` : `\n${planned} 件を復元できます（--apply で実行）`);
