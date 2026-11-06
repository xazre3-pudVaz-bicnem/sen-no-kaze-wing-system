'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth/session';
import { getStore, StoreError, type QuoteV25RevisionInput } from '@/lib/data/store';
import { flushNotificationsSafely } from '@/lib/mail/send';

/**
 * v2.5 の見積の第 2 版以降（v2.5 PR-D1）。金額はサーバー（DB の create_quote_revision_v25）が作る。
 * 画面から送るのは行の出どころ（前の版の行・商品台帳の商品・自由明細）・数量・自由明細の売価・状態と、
 * 前の版から変えた区分の経費の決め方（率／手動の額。A-2 ⑥）だけ
 */

export type QuoteV25ActionState = { ok: boolean; error?: string };

const uuid = z.uuid();
const quantity = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, '数量の形式が正しくありません').max(12);
const state = z.enum(['zero_confirmed', 'excluded']).nullable().optional();
const reason = z.string().trim().max(190).nullable().optional();
const price = z.number().int().min(0).max(100_000_000);

const lineSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('parent'),
    parent_item_id: uuid,
    quantity: quantity.nullable().optional(),
    unit_price: price.nullable().optional(),
    state,
    state_reason: reason,
  }),
  z.object({
    source: z.literal('catalog'),
    section: z.enum(['interior_exterior', 'option', 'sitework']),
    option_id: uuid,
    variant_choice_ids: z.array(uuid).max(30),
    quantity,
  }),
  z.object({
    source: z.literal('manual'),
    section: z.enum(['base', 'interior_exterior', 'option', 'sitework']),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(200).nullable().optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    quantity,
    unit_price: price,
    remark: z.string().trim().max(200).nullable().optional(),
    state,
    state_reason: reason,
  }),
  z
    .object({
      source: z.literal('expense'),
      section: z.enum(['base', 'interior_exterior', 'option']),
      method: z.enum(['rate', 'fixed']),
      amount: price.nullable().optional(),
    })
    .refine((line) => line.method !== 'fixed' || typeof line.amount === 'number'),
]);

const payloadSchema = z.object({
  quote_id: uuid,
  lines: z.array(lineSchema).max(300),
  adjustment: z.number().int().min(-100_000_000).max(100_000_000),
  adjustment_reason: z.string().trim().max(500).nullable(),
  dealer_note: z.string().trim().max(1000).nullable(),
  por_keys: z.array(z.string().min(1).max(1000)).max(500),
  por_confirmed: z.boolean(),
});

/** 発行（第 N＋1 版）。成功したら案件の画面へ戻る */
export async function createQuoteRevisionV25Action(_prev: QuoteV25ActionState, formData: FormData): Promise<QuoteV25ActionState> {
  const actor = await requireStaff();
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { ok: false, error: '編集の内容を読み取れませんでした。画面を再読み込みしてください。' };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません（数量・売価・品名・経費の手動の額を確かめてください）。' };
  const { quote_id, por_keys, por_confirmed, ...rest } = parsed.data;
  // お客様が選んだ別途見積の商品（画面に出した一覧）は、確認欄にチェックがあるときだけ確認として送る（#529 と同じ）
  if (por_keys.length > 0 && !por_confirmed) {
    return { ok: false, error: 'お客様が選んだ別途見積の商品について、「金額未確定の確認」にチェックを入れてから発行してください。' };
  }
  const input: QuoteV25RevisionInput = {
    lines: rest.lines,
    adjustment: rest.adjustment,
    adjustment_reason: rest.adjustment_reason || null,
    dealer_note: rest.dealer_note || null,
    por_confirmation_keys: por_confirmed ? por_keys : null,
  };
  let newId: string;
  try {
    const store = await getStore();
    const quote = await store.createQuoteRevisionV25(quote_id, input, actor);
    newId = quote.id;
    await flushNotificationsSafely();
    revalidatePath('/admin/quotes');
    revalidatePath('/mypage');
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, error: e.message };
    console.error('[wing] v2.5 revision error', e);
    return { ok: false, error: '処理中にエラーが発生しました。' };
  }
  redirect(`/admin/quotes?case=${encodeURIComponent(newId)}&tab=estimate&revised=1#case-workspace`);
}

const unitsSchema = z.object({
  quote_id: uuid,
  items: z.array(z.object({ option_id: uuid, choice_ids: z.array(uuid).max(30) })).max(300),
});

/** 商品台帳の「商品＋選択肢」の売価単価を、見積に固定した版で計算する（価格未確定は null。原価は返さない） */
export async function fetchQuoteV25UnitsAction(
  input: unknown
): Promise<{ ok: true; units: (number | null)[] } | { ok: false; error: string }> {
  const actor = await requireStaff();
  const parsed = unitsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '商品の指定が正しくありません。' };
  try {
    const store = await getStore();
    return { ok: true, units: await store.getQuoteV25Units(parsed.data.quote_id, parsed.data.items, actor) };
  } catch (e) {
    if (e instanceof StoreError) return { ok: false, error: e.message };
    console.error('[wing] v2.5 units error', e);
    return { ok: false, error: '売価を計算できませんでした。' };
  }
}
