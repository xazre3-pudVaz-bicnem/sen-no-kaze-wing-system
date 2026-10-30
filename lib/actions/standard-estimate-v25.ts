'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

/**
 * 標準見積の v2.5 の編集画面（PR-B1b）。DB の RPC（20261019100000）を呼ぶだけで、金額・原価 Version の固定・公開の可否は DB が決める。
 * 本体マスター・v2.5 以前の標準見積と同じく、Supabase 接続環境だけで使う（ローカル検証モードでは案内だけ）。
 */

export type StandardEstimateV25ActionResult =
  | { ok: true; message: string; lockVersion?: number }
  | { ok: false; error: string };

function message(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? '処理に失敗しました。時間をおいて再度お試しください。';
  return raw.replace(/^(VALIDATION|FORBIDDEN|LOCKED|NOT_FOUND|UNAUTHENTICATED|RETIRED):\s*/i, '');
}

function localUnavailable(): StandardEstimateV25ActionResult | null {
  return isLocalMode() ? { ok: false, error: '標準見積の管理はSupabase接続環境で利用できます。' } : null;
}

const decimal = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, '数の形式が正しくありません'));

const payloadSchema = z.object({
  rates: z.object({ sales_fee_rate: decimal, markup_rate: decimal, expense_rate: decimal }),
  adjustment: z.number().int(),
  adjustment_reason: z.string().trim().max(500).nullable(),
  slots: z
    .array(
      z.object({
        baseline_key: z.uuid().nullable(),
        option_id: z.uuid(),
        variant_choice_ids: z.array(z.uuid()).max(20),
        quantity: decimal,
        price_mode: z.enum(['auto', 'manual', 'por']),
        manual_unit_price: z.number().int().min(0).nullable(),
      })
    )
    .max(200),
  lines: z
    .array(
      z.object({
        line_key: z.uuid().nullable(),
        section_code: z.enum(['interior_exterior', 'option', 'sitework']),
        group_label: z.string().trim().max(120).nullable(),
        name: z.string().trim().min(1, '品名を入力してください').max(120),
        quantity: decimal,
        unit: z.string().trim().max(40).nullable(),
        price_mode: z.enum(['manual', 'por']),
        unit_price: z.number().int().min(0).nullable(),
        remark: z.string().trim().max(500).nullable(),
        review_required: z.boolean(),
      })
    )
    .max(300),
});

const revisionSchema = z.object({ revision_id: z.uuid(), expected_lock_version: z.number().int().min(0) });

/**
 * v2.5 の下書きを作る。公開中の Revision を土台に新しい下書きを作るか、v2.5 以前の下書きを（画面が読んだ版と一致するときだけ）v2.5 に切り替える。
 * 公開済みの Revision は変えない
 */
export async function startStandardEstimateV25DraftAction(formData: FormData): Promise<void> {
  await requireAdmin('/admin/standard-estimates');
  if (isLocalMode()) redirect('/admin/standard-estimates?error=local');
  const masterId = z.uuid().safeParse(formData.get('master_id'));
  const rawLock = formData.get('expected_draft_lock_version');
  const draftLock = rawLock === null || rawLock === '' ? null : Number(rawLock);
  if (!masterId.success || (draftLock !== null && !Number.isSafeInteger(draftLock))) redirect('/admin/standard-estimates?error=invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_standard_estimate_v25_draft', {
    p_master_id: masterId.data,
    p_expected_draft_lock_version: draftLock,
  });
  if (error || !data) redirect(`/admin/standard-estimates?error=${encodeURIComponent(message(error))}`);
  revalidatePath('/admin/standard-estimates');
  redirect(`/admin/standard-estimates/${data as string}?v25=started`);
}

/** v2.5 の下書きを保存する。原価 Version は、同じ商品・同じ選択肢なら固定のまま（DB が判断する） */
export async function saveStandardEstimateV25DraftAction(input: unknown): Promise<StandardEstimateV25ActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = revisionSchema.extend({ payload: payloadSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_standard_estimate_v25_draft', {
    p_revision_id: parsed.data.revision_id,
    p_expected_lock_version: parsed.data.expected_lock_version,
    p_payload: parsed.data.payload,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${parsed.data.revision_id}`);
  revalidatePath('/admin/standard-estimates');
  return {
    ok: true,
    message: '保存しました。金額は DB で計算し直しています（原価は、商品・選択肢を変えた行だけ現在の原価になります）。',
    lockVersion: (data as { lock_version?: number } | null)?.lock_version,
  };
}

/** 最新原価を取り込む（auto の選択枠の原価 Version と、計算ルール・税ルールを現在の Version にする） */
export async function refreshStandardEstimateV25CostsAction(input: unknown): Promise<StandardEstimateV25ActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容を確認してください' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('refresh_standard_estimate_v25_costs', {
    p_revision_id: parsed.data.revision_id,
    p_expected_lock_version: parsed.data.expected_lock_version,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${parsed.data.revision_id}`);
  return {
    ok: true,
    message: '最新原価を取り込みました。金額を確認してから公開してください。',
    lockVersion: (data as { lock_version?: number } | null)?.lock_version,
  };
}

/** v2.5 の下書きを公開する。原価・ルールが古い・原価未設定なら DB が止める */
export async function publishStandardEstimateV25RevisionAction(input: unknown): Promise<StandardEstimateV25ActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容を確認してください' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_standard_estimate_v25_revision', {
    p_revision_id: parsed.data.revision_id,
    p_expected_lock_version: parsed.data.expected_lock_version,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${parsed.data.revision_id}`);
  revalidatePath('/admin/standard-estimates');
  // 公開中の Revision が替わる（シミュレーターの売価の取得は v2.5 の Revision をまだ返さないが、cache を揃える）
  updateTag(CATALOG_TAG);
  return { ok: true, message: '公開しました。' };
}
