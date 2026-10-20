'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { isMissingNamedFunction } from '@/lib/data/schema-compat';
import { flushNotificationsSafely } from '@/lib/mail/send';
import { createClient } from '@/lib/supabase/server';

export interface LegacyAcceptedFormalizationState {
  ok: boolean;
  error?: string;
}

const installationItemSchema = z.object({
  source_item_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, '品名を入力してください。').max(120),
  unit: z.string().trim().max(12).optional().default('式'),
  remark: z.string().trim().max(200).optional().default(''),
  unit_price: z.number().int().min(0).max(100_000_000),
  quantity: z.number().min(0.01).max(99_999).refine((value) => Number.isFinite(value) && Math.round(value * 10_000) / 10_000 === value, {
    message: '数量は小数4桁以内で入力してください。',
  }),
});

const payloadSchema = z.object({
  quote_id: z.string().uuid(),
  dealer_note: z.string().max(1000).optional().default(''),
  items: z.array(installationItemSchema).max(100),
});

function userFacingRpcError(error: { code?: string; message?: string } | null) {
  if (isMissingNamedFunction(error, 'create_formal_quote_from_accepted_preliminary')) {
    return 'この操作に必要なDB更新がまだ適用されていません。本番DB反映後に利用できます。';
  }

  const message = error?.message ?? '';
  for (const prefix of ['VALIDATION:', 'LOCKED:', 'FORBIDDEN:']) {
    if (message.startsWith(prefix)) return message.slice(prefix.length).trim();
  }
  if (error?.code === '42501') return 'この案件の確定見積を発行する権限がありません。';
  if (message.startsWith('NOT_FOUND')) return '対象の見積が見つかりません。';
  return '確定見積の発行に失敗しました。案件を再読み込みして状態を確認してください。';
}

/** 画面が送った別途見積の一覧の key（JSON の文字列の配列）。形が違えば null */
function parsePorKeys(value: FormDataEntryValue | null): string[] | null {
  if (value === null || value === '') return [];
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (!Array.isArray(parsed) || parsed.length > 500) return null;
    if (!parsed.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 200)) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

export async function formalizeLegacyAcceptedQuoteAction(
  _prev: LegacyAcceptedFormalizationState,
  formData: FormData
): Promise<LegacyAcceptedFormalizationState> {
  await requireStaff();

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(formData.get('items_json') ?? '[]'));
  } catch {
    return { ok: false, error: '施工金額明細を読み取れませんでした。' };
  }

  const parsed = payloadSchema.safeParse({
    quote_id: formData.get('quote_id'),
    dealer_note: formData.get('dealer_note') ?? '',
    items: rawItems,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください。' };
  }

  // お客様が選んだ別途見積の商品（画面に出した一覧）。確認欄にチェックがあるときだけ確認として記録する（D1 までの暫定）
  const porKeys = parsePorKeys(formData.get('por_keys'));
  if (porKeys === null) {
    return { ok: false, error: '別途見積の確認の内容を読み取れませんでした。画面を再読み込みしてください。' };
  }
  if (porKeys.length > 0 && formData.get('por_confirmed') !== '1') {
    return { ok: false, error: 'お客様が選んだ別途見積の商品について、「別途見積の確認」にチェックを入れてから発行してください。' };
  }

  // LocalStore has no equivalent privileged transaction. Do not emulate a
  // lifecycle write in memory and accidentally claim DB-level guarantees.
  if (isLocalMode()) {
    return { ok: false, error: 'この互換処理はSupabase DB更新後の環境でのみ実行できます。' };
  }

  const db = await createClient();
  if (porKeys.length > 0) {
    const { error: confirmError } = await db.rpc('confirm_quote_por_selections', {
      p_quote_id: parsed.data.quote_id,
      p_selection_keys: porKeys,
    });
    // migration の適用前は確認の仕組みが無い（従来どおり発行だけを行う）
    if (confirmError && !isMissingNamedFunction(confirmError, 'confirm_quote_por_selections')) {
      return { ok: false, error: userFacingRpcError(confirmError) };
    }
  }
  const { data, error } = await db.rpc('create_formal_quote_from_accepted_preliminary', {
    p_quote_id: parsed.data.quote_id,
    p_installation_items: parsed.data.items,
    p_dealer_note: parsed.data.dealer_note || null,
  });

  if (error) return { ok: false, error: userFacingRpcError(error) };

  const newQuoteId = typeof data === 'string' ? data : null;
  if (!newQuoteId) return { ok: false, error: '確定見積の発行結果を確認できませんでした。' };

  await flushNotificationsSafely();
  revalidatePath('/admin/quotes');
  revalidatePath(`/admin/quotes/${parsed.data.quote_id}`);
  revalidatePath('/mypage');

  redirect(`/admin/quotes?case=${encodeURIComponent(newQuoteId)}&tab=estimate&created=1#case-workspace`);
}
