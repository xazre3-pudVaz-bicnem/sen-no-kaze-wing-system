'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth/session';
import { isMissingFunction } from '@/lib/data/schema-compat';
import { createClient } from '@/lib/supabase/server';

export type OptionHqStandardCostActionState = {
  ok: boolean;
  error?: string;
  message?: string;
  standardCost?: number;
  lockVersion?: number;
  changed?: boolean;
};

const DB_WAIT = '本部商品基準原価はDB反映待ちです。反映完了後にもう一度お試しください。';
const MAX_INTEGER = 2_147_483_647;

function cleanDbMessage(message: string) {
  return message.replace(/^(VALIDATION|CONFLICT|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED):\s*/, '').trim();
}

function safeRpcError(error: { code?: string; message?: string }): string {
  if (isMissingFunction(error)) return DB_WAIT;
  const message = error.message ?? '';
  if (
    message.startsWith('VALIDATION:') ||
    message.startsWith('CONFLICT:') ||
    message.startsWith('FORBIDDEN:') ||
    message.startsWith('NOT_FOUND:') ||
    message.startsWith('UNAUTHENTICATED:')
  ) {
    return cleanDbMessage(message);
  }
  if (error.code === '42501') return '本部商品基準原価を変更する権限がありません。';
  console.error('[wing] option HQ standard cost RPC error', { code: error.code });
  return '本部商品基準原価の保存に失敗しました。';
}

export async function saveOptionHqStandardCostAction(
  _previous: OptionHqStandardCostActionState,
  formData: FormData
): Promise<OptionHqStandardCostActionState> {
  await requireStaff();

  const optionId = String(formData.get('option_id') ?? '').trim();
  const rawCost = String(formData.get('standard_cost') ?? '').trim();
  const rawVersion = String(formData.get('expected_lock_version') ?? '').trim();
  const changeReason = String(formData.get('change_reason') ?? '').trim();

  if (!optionId) return { ok: false, error: '商品IDがありません。' };
  if (!/^\d+$/.test(rawCost)) return { ok: false, error: '本部商品基準原価は0円以上の整数で入力してください。' };
  if (!/^\d+$/.test(rawVersion)) return { ok: false, error: '読み込んだ版が不正です。再読み込みしてください。' };

  const standardCost = Number(rawCost);
  const expectedLockVersion = Number(rawVersion);
  if (!Number.isSafeInteger(standardCost) || standardCost < 0 || standardCost > MAX_INTEGER) {
    return { ok: false, error: '本部商品基準原価は0〜2,147,483,647円で入力してください。' };
  }
  if (!Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 0) {
    return { ok: false, error: '読み込んだ版が不正です。再読み込みしてください。' };
  }
  if (changeReason.length < 1 || changeReason.length > 500) {
    return { ok: false, error: '変更理由は1〜500文字で入力してください。' };
  }

  const db = await createClient();
  const { data, error } = await db.rpc('set_option_hq_standard_cost', {
    p_option_id: optionId,
    p_standard_cost: standardCost,
    p_expected_lock_version: expectedLockVersion,
    p_change_reason: changeReason,
  });

  if (error) return { ok: false, error: safeRpcError(error) };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: '本部商品基準原価の保存結果を確認できませんでした。' };

  revalidatePath(`/admin/options/${optionId}`);
  revalidatePath('/admin/ledger');

  return {
    ok: true,
    message: row.changed ? '本部商品基準原価を保存しました。' : '金額に変更はありません。',
    standardCost: Number(row.standard_cost),
    lockVersion: Number(row.lock_version),
    changed: Boolean(row.changed),
  };
}
