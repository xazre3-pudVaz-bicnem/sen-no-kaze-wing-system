'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { parseChoiceImportScope } from '@/lib/domain/cost-import-choice-scope';
import { parseProductImportScope, type ProductImportScope } from '@/lib/domain/cost-import-product-scope';

const PAGE = '/admin/options/cost-import';
const ITEM_PATTERN = /^(option|choice):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(-?\d{1,10})$/i;

function errorPath(message: string, scopeIds?: string[], productScope?: { id: string; amount: number }) {
  const scope = scopeIds?.length
    ? `choice_ids=${encodeURIComponent(scopeIds.join(','))}&`
    : productScope
      ? `product_id=${productScope.id}&product_amount=${productScope.amount}&`
      : '';
  return `${PAGE}?${scope}error=${encodeURIComponent(message)}`;
}

/**
 * 既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む（v2.5 PR-A3）。本部だけ。
 * 画面で確かめた金額を一緒に送り、DB（import_option_standard_costs）が今の値と同じときだけ記録する。
 */
export async function importOptionCostsAction(formData: FormData): Promise<void> {
  await requireAdmin(PAGE);
  const rawScope = formData.get('choice_scope');
  const scope = rawScope === null ? null : parseChoiceImportScope(String(rawScope));
  const rawProductId = formData.get('product_scope_id');
  const rawProductAmount = formData.get('product_scope_amount');
  const productScope = parseProductImportScope(
    rawProductId === null ? undefined : String(rawProductId),
    rawProductAmount === null ? undefined : String(rawProductAmount)
  );
  if ((scope && productScope) || (scope && !scope.valid) || (productScope && !productScope.valid)) {
    redirect(errorPath('限定対象の指定が正しくありません。'));
  }
  const scopeIds = scope?.valid ? scope.ids : undefined;
  const singleProduct = productScope?.valid ? productScope : undefined;
  if (isLocalMode()) redirect(errorPath('ローカル検証モードでは取り込めません。', scopeIds, singleProduct));

  const reason = String(formData.get('change_reason') ?? '').trim();
  if (reason.length < 1 || reason.length > 500) redirect(errorPath('取り込みの理由を1〜500文字で入力してください。', scopeIds, singleProduct));

  const items: { kind: 'option' | 'choice'; id: string; amount: number }[] = [];
  for (const raw of formData.getAll('item')) {
    const match = String(raw).match(ITEM_PATTERN);
    if (!match) redirect(errorPath('取り込む一覧の形式が正しくありません。画面を開き直してください。', scopeIds, singleProduct));
    items.push({ kind: match[1].toLowerCase() as 'option' | 'choice', id: match[2].toLowerCase(), amount: Number(match[3]) });
  }
  if (!items.length) redirect(errorPath('取り込む商品・選択肢を選んでください。', scopeIds, singleProduct));
  // 限定フォームでは、商品本体や指定外IDが送信されてもサーバー側で拒否する。
  if (scopeIds && (
    items.length !== scopeIds.length ||
    items.some((item) => item.kind !== 'choice' || item.amount !== 0 || !scopeIds.includes(item.id))
  )) {
    redirect(errorPath('限定した選択肢以外は取り込めません。対象を確認してください。', scopeIds, singleProduct));
  }

  // 商品本体限定では指定1件・指定金額以外を必ず拒否する。原価Versionの競合判定は既存のDB RPCが実施する。
  if (singleProduct && (
    items.length !== 1 ||
    items[0].kind !== 'option' ||
    items[0].id !== singleProduct.id ||
    items[0].amount !== singleProduct.amount
  )) {
    redirect(errorPath('指定商品1件の金額以外は取り込めません。', scopeIds, singleProduct));
  }

  const db = await createClient();
  const { data, error } = await db.rpc('import_option_standard_costs', { p_items: items, p_change_reason: reason });
  if (error) {
    const message = (error.message ?? '').replace(/^(VALIDATION|CONFLICT|FORBIDDEN|NOT_FOUND|UNAUTHENTICATED|LOCKED):\s*/, '').trim();
    redirect(errorPath(error.code === 'PGRST202' ? '原価の取り込みの DB 機能が未反映です。取り込んでいません。' : message || '取り込めませんでした。', scopeIds, singleProduct));
  }

  const rows = (data ?? []) as { result: string }[];
  const imported = rows.filter((row) => row.result === 'imported').length;
  const unchanged = rows.filter((row) => row.result === 'unchanged').length;
  revalidatePath(PAGE);
  revalidatePath('/admin/ledger');
  // シミュレーターの v2.5 の売価の表は今の原価の Version から作る（v2.5 PR-C1）
  if (imported > 0) updateTag(CATALOG_TAG);
  const successPath = scopeIds?.length
    ? `${PAGE}?choice_ids=${encodeURIComponent(scopeIds.join(','))}&`
    : singleProduct
      ? `${PAGE}?product_id=${singleProduct.id}&product_amount=${singleProduct.amount}&`
      : `${PAGE}?`;
  redirect(`${successPath}imported=${imported}&unchanged=${unchanged}`);
}
