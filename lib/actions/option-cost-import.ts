'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

const PAGE = '/admin/options/cost-import';
const ITEM_PATTERN = /^(option|choice):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(-?\d{1,10})$/i;

function errorPath(message: string) {
  return `${PAGE}?error=${encodeURIComponent(message)}`;
}

/**
 * 既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む（v2.5 PR-A3）。本部だけ。
 * 画面で確かめた金額を一緒に送り、DB（import_option_standard_costs）が今の値と同じときだけ記録する。
 */
export async function importOptionCostsAction(formData: FormData): Promise<void> {
  await requireAdmin(PAGE);
  if (isLocalMode()) redirect(errorPath('ローカル検証モードでは取り込めません。'));

  const reason = String(formData.get('change_reason') ?? '').trim();
  if (reason.length < 1 || reason.length > 500) redirect(errorPath('取り込みの理由を1〜500文字で入力してください。'));

  const items: { kind: 'option' | 'choice'; id: string; amount: number }[] = [];
  for (const raw of formData.getAll('item')) {
    const match = String(raw).match(ITEM_PATTERN);
    if (!match) redirect(errorPath('取り込む一覧の形式が正しくありません。画面を開き直してください。'));
    items.push({ kind: match[1].toLowerCase() as 'option' | 'choice', id: match[2].toLowerCase(), amount: Number(match[3]) });
  }
  if (!items.length) redirect(errorPath('取り込む商品・選択肢を選んでください。'));

  const db = await createClient();
  const { data, error } = await db.rpc('import_option_standard_costs', { p_items: items, p_change_reason: reason });
  if (error) {
    const message = (error.message ?? '').replace(/^(VALIDATION|CONFLICT|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED|LOCKED):\s*/, '').trim();
    redirect(errorPath(error.code === 'PGRST202' ? '原価の取り込みの DB 機能が未反映です。取り込んでいません。' : message || '取り込めませんでした。'));
  }

  const rows = (data ?? []) as { result: string }[];
  const imported = rows.filter((row) => row.result === 'imported').length;
  const unchanged = rows.filter((row) => row.result === 'unchanged').length;
  revalidatePath(PAGE);
  revalidatePath('/admin/ledger');
  redirect(`${PAGE}?imported=${imported}&unchanged=${unchanged}`);
}
