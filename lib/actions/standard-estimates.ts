'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

/**
 * 標準見積の管理画面（PR F）。DB の RPC（PR E）を呼ぶだけで、金額はすべて DB が計算する。
 * 本体マスターと同じく Supabase 接続環境だけで使う（ローカル検証モードでは案内だけ）。
 */

export type StandardEstimateActionResult =
  | { ok: true; message: string; lockVersion?: number }
  | { ok: false; error: string };

const rate = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, '率の形式が正しくありません'));

const lineSchema = z.object({
  line_key: z.uuid().nullable(),
  section_code: z.enum(['interior_exterior', 'option', 'sitework']),
  group_label: z.string().trim().max(120).nullable(),
  name: z.string().trim().min(1, '品名を入力してください').max(120),
  quantity: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  unit: z.string().trim().max(12).nullable(),
  price_mode: z.enum(['auto', 'manual', 'por']),
  cost_unit_price: z.number().int().min(0).nullable(),
  unit_price: z.number().int().min(0).nullable(),
  remark: z.string().trim().max(200).nullable(),
});

const saveSchema = z.object({
  revision_id: z.uuid(),
  expected_lock_version: z.number().int().min(1),
  sales_fee_rate: rate,
  expense_rate: rate,
  markup_rate: rate,
  adjustment: z.number().int(),
  adjustment_reason: z.string().trim().max(200),
  section_methods: z.object({
    base: z.enum(['rate', 'none']),
    interior_exterior: z.enum(['rate', 'none']),
    option: z.enum(['rate', 'none']),
    sitework: z.enum(['rate', 'none']),
  }),
  lines: z.array(lineSchema).max(300),
});

function message(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? '処理に失敗しました。時間をおいて再度お試しください。';
  return raw.replace(/^(VALIDATION|FORBIDDEN|LOCKED|NOT_FOUND):\s*/i, '');
}

function localUnavailable(): StandardEstimateActionResult | null {
  return isLocalMode() ? { ok: false, error: '標準見積の管理はSupabase接続環境で利用できます。' } : null;
}

/**
 * 本部：シミュレーターの価格を、新しい標準見積に切り替える（または戻す）。
 * 切り替えは先方の最終確認のあとに行う（2026-10-13 先方回答）。誤操作を防ぐため、切り替えには確認のチェックを必須にする。
 */
export async function setSimulatorStandardPricingAction(formData: FormData): Promise<void> {
  await requireAdmin('/admin/standard-estimates');
  if (isLocalMode()) redirect('/admin/standard-estimates?error=local');
  const enabled = formData.get('enabled') === 'true';
  if (enabled && formData.get('confirmed') !== 'on') redirect('/admin/standard-estimates?error=switch_confirm');
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_simulator_standard_pricing', { p_enabled: enabled });
  if (error) redirect(`/admin/standard-estimates?error=${encodeURIComponent(message(error))}`);
  // シミュレーターのページは売価とスイッチを CATALOG_TAG で cache しているため破棄する
  updateTag(CATALOG_TAG);
  revalidatePath('/admin/standard-estimates');
  redirect(`/admin/standard-estimates?switched=${enabled ? 'on' : 'off'}`);
}

/** 公開中の本体 Revision を基準に、標準見積の下書きを作る */
export async function createStandardEstimateDraftAction(formData: FormData): Promise<void> {
  await requireAdmin('/admin/standard-estimates');
  if (isLocalMode()) redirect('/admin/standard-estimates?error=local');
  const baseRevisionId = z.uuid().safeParse(formData.get('base_master_revision_id'));
  if (!baseRevisionId.success) redirect('/admin/standard-estimates?error=invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_standard_estimate_draft', { p_base_master_revision_id: baseRevisionId.data });
  if (error || !data) redirect(`/admin/standard-estimates?error=${encodeURIComponent(message(error))}`);
  revalidatePath('/admin/standard-estimates');
  redirect(`/admin/standard-estimates/${data as string}?created=1`);
}

/** 下書きを保存する（率・調整額・区分の経費の方法・明細）。DB が全額を計算し直す */
export async function saveStandardEstimateDraftAction(input: unknown): Promise<StandardEstimateActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_standard_estimate_draft', {
    p_revision_id: value.revision_id,
    p_sales_fee_rate: value.sales_fee_rate,
    p_expense_rate: value.expense_rate,
    p_markup_rate: value.markup_rate,
    p_adjustment: value.adjustment,
    p_adjustment_reason: value.adjustment_reason || null,
    p_section_methods: value.section_methods,
    p_lines: value.lines.map((line) => ({
      ...line,
      cost_unit_price: line.price_mode === 'por' ? null : line.cost_unit_price,
      unit_price: line.price_mode === 'manual' ? line.unit_price : null,
    })),
    p_expected_lock_version: value.expected_lock_version,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${value.revision_id}`);
  revalidatePath('/admin/standard-estimates');
  return { ok: true, message: '保存しました。金額は DB で計算し直しています。', lockVersion: (data as { lock_version?: number } | null)?.lock_version };
}

/** 下書きを公開する（前の公開版は置き換え済みになる） */
export async function publishStandardEstimateRevisionAction(input: unknown): Promise<StandardEstimateActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = z.object({ revision_id: z.uuid(), expected_lock_version: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容を確認してください' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_standard_estimate_revision', {
    p_revision_id: parsed.data.revision_id,
    p_expected_lock_version: parsed.data.expected_lock_version,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${parsed.data.revision_id}`);
  revalidatePath('/admin/standard-estimates');
  // シミュレーターの価格（売価だけの標準見積）にすぐ反映する
  updateTag(CATALOG_TAG);
  return { ok: true, message: '公開しました。' };
}

const baselineSchema = z.object({
  revision_id: z.uuid(),
  expected_lock_version: z.number().int().min(1),
  items: z
    .array(
      z.object({
        option_id: z.uuid(),
        quantity: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
        variant_choice_ids: z.array(z.uuid()).max(20),
      })
    )
    .max(200),
});

/** 下書きの標準状態の商品（シミュレーターの差額の基準）を置き換える。価格・区分は DB が商品台帳から決める */
export async function setStandardEstimateBaselineAction(input: unknown): Promise<StandardEstimateActionResult> {
  await requireAdmin('/admin/standard-estimates');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;
  const parsed = baselineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_standard_estimate_baseline', {
    p_revision_id: parsed.data.revision_id,
    p_items: parsed.data.items,
    p_expected_lock_version: parsed.data.expected_lock_version,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/standard-estimates/${parsed.data.revision_id}`);
  return {
    ok: true,
    message: '標準状態の商品を保存しました。価格は公開時に商品台帳の価格で確定します。',
    lockVersion: (data as { lock_version?: number } | null)?.lock_version,
  };
}

/** 公開版の率・明細を写して次の Revision の下書きを作る */
export async function startNextStandardEstimateRevisionAction(formData: FormData): Promise<void> {
  await requireAdmin('/admin/standard-estimates');
  if (isLocalMode()) redirect('/admin/standard-estimates?error=local');
  const masterId = z.uuid().safeParse(formData.get('master_id'));
  const baseRevisionId = z.uuid().nullable().safeParse(formData.get('base_master_revision_id') || null);
  if (!masterId.success || !baseRevisionId.success) redirect('/admin/standard-estimates?error=invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('start_next_standard_estimate_revision', {
    p_master_id: masterId.data,
    p_base_master_revision_id: baseRevisionId.data,
  });
  if (error || !data) redirect(`/admin/standard-estimates?error=${encodeURIComponent(message(error))}`);
  revalidatePath('/admin/standard-estimates');
  redirect(`/admin/standard-estimates/${data as string}?created=1`);
}
