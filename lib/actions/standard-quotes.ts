'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { quoteLineGuardError } from '@/lib/data/quote-line-guard';
import { applyQuoteLineStateInput, QuoteLineStateInputError } from '@/lib/domain/quote-por';
import { quoteLineStateReasonSchema, quoteLineStateSchema } from '@/lib/validation';
import { createClient } from '@/lib/supabase/server';

/**
 * 標準見積から作成する見積（PR H）。DB の RPC を呼ぶだけで、金額・経費の行・内部原価はすべて DB が計算する。
 * 作成・編集・発行は本部だけ（DB でも確認する）。標準見積と同じく Supabase 接続環境だけで使う。
 */

export type StandardQuoteActionResult =
  | { ok: true; message: string; lockVersion?: number }
  | { ok: false; error: string };

export interface StandardQuoteCaseFormState {
  ok: boolean;
  error?: string;
}

const rate = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, '率の形式が正しくありません'));
const method = z.enum(['rate', 'none']);

const lineSchema = z.object({
  line_key: z.uuid().nullable(),
  section_code: z.enum(['base', 'interior_exterior', 'option', 'sitework']),
  name: z.string().trim().min(1, '品名を入力してください').max(120),
  description: z.string().trim().max(200).nullable(),
  quantity: z.union([z.string(), z.number()]).transform((value) => String(value).trim()),
  unit: z.string().trim().max(12).nullable(),
  price_mode: z.enum(['auto', 'manual', 'por']),
  cost_unit_price: z.number().int().min(0).nullable(),
  unit_price: z.number().int().min(0).nullable(),
  remark: z.string().trim().max(200).nullable(),
  /** 明細の状態（画面の明示の選択。サーバーが備考に印を付ける。D1 までの暫定） */
  line_state: quoteLineStateSchema.optional(),
  line_state_reason: quoteLineStateReasonSchema.optional(),
});

const saveSchema = z.object({
  draft_id: z.uuid(),
  expected_lock_version: z.number().int().min(0),
  sales_fee_rate: rate,
  expense_rate: rate,
  markup_rate: rate,
  expense_methods: z.object({ base: method, interior_exterior: method, option: method, sitework: method }),
  adjustment: z.number().int(),
  adjustment_reason: z.string().trim().max(500),
  notes: z.string().trim().max(1000),
  lines: z.array(lineSchema).max(300),
});

const caseSchema = z.object({
  standard_estimate_revision_id: z.uuid('標準見積を選んでください'),
  case_name: z.string().trim().max(120, '案件名は120文字以内で入力してください'),
  customer_name: z.string().trim().min(1, 'お客様名を入力してください').max(60, 'お客様名は60文字以内で入力してください'),
  customer_company: z.string().trim().max(100, '会社名は100文字以内で入力してください'),
  site_address: z.string().trim().max(200, '設置予定地は200文字以内で入力してください'),
  memo: z.string().trim().max(1000, 'メモは1000文字以内で入力してください'),
});

function message(error: { message?: string } | null | undefined): string {
  const raw = error?.message ?? '処理に失敗しました。時間をおいて再度お試しください。';
  return raw.replace(/^(VALIDATION|FORBIDDEN|LOCKED|NOT_FOUND|QUOTE_IMMUTABLE):\s*/i, '');
}

const LOCAL_UNAVAILABLE = '標準見積からの見積作成はSupabase接続環境で利用できます。';

/** 公開中の標準見積から、案件と見積下書きを作る */
export async function createStandardQuoteCaseAction(_prev: StandardQuoteCaseFormState, formData: FormData): Promise<StandardQuoteCaseFormState> {
  await requireAdmin('/admin/quotes/standard-drafts/new');
  if (isLocalMode()) return { ok: false, error: LOCAL_UNAVAILABLE };
  const parsed = caseSchema.safeParse({
    standard_estimate_revision_id: formData.get('standard_estimate_revision_id'),
    case_name: formData.get('case_name') ?? '',
    customer_name: formData.get('customer_name') ?? '',
    customer_company: formData.get('customer_company') ?? '',
    site_address: formData.get('site_address') ?? '',
    memo: formData.get('memo') ?? '',
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  const value = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_standard_quote_case', {
    p_case_name: value.case_name || null,
    p_contact: {
      full_name: value.customer_name,
      company_name: value.customer_company || null,
      email: '',
      phone: '',
      address: '',
      site_address: value.site_address || null,
    },
    p_message: value.memo || null,
    p_standard_estimate_revision_id: value.standard_estimate_revision_id,
  });
  if (error || !data) return { ok: false, error: message(error) };
  revalidatePath('/admin/quotes');
  redirect(`/admin/quotes/standard-drafts/${data as string}?created=1`);
}

/** 下書きを保存する（率・区分の経費の方法・明細・調整額）。DB が全額を計算し直し、新しい版を返す */
export async function saveStandardQuoteDraftAction(input: unknown): Promise<StandardQuoteActionResult> {
  await requireAdmin('/admin/quotes');
  if (isLocalMode()) return { ok: false, error: LOCAL_UNAVAILABLE };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? '入力内容を確認してください' };
  const value = parsed.data;
  // 「対象外」「0円確定」は本体以外の区分の「金額を入力」の 0 円の行だけ。印は画面の選択から付け、手入力の印は受け付けない。
  // 対象外の行は今回の契約に含めないので、原価も 0 円にする（経費の計算にも入れない）
  let lines;
  try {
    lines = value.lines.map(({ line_state, line_state_reason, ...line }) => {
      if (line_state && (line.section_code === 'base' || line.price_mode !== 'manual')) {
        throw new QuoteLineStateInputError(
          `「対象外」「0円確定」の明細（${line.name}）は、本体以外の区分で、価格の決め方を「金額を入力」にしてください`
        );
      }
      const remark = applyQuoteLineStateInput({ name: line.name, remark: line.remark, unit_price: line.unit_price ?? 0, line_state, line_state_reason });
      return {
        ...line,
        remark,
        cost_unit_price: line.price_mode === 'por' ? null : line_state === 'excluded' ? 0 : line.cost_unit_price,
        unit_price: line.price_mode === 'manual' ? (line_state ? 0 : line.unit_price) : null,
      };
    });
  } catch (e) {
    if (e instanceof QuoteLineStateInputError) return { ok: false, error: e.message };
    throw e;
  }
  const supabase = await createClient();
  // 「0円確定」「対象外」の印は、DB の更新（20261016111000）が済むまで保存しない
  if (value.lines.some((line) => line.line_state)) {
    const blocked = await quoteLineGuardError(supabase);
    if (blocked) return { ok: false, error: blocked };
  }
  const { data, error } = await supabase.rpc('save_standard_quote_draft', {
    p_draft_id: value.draft_id,
    p_expected_lock_version: value.expected_lock_version,
    p_sales_fee_rate: value.sales_fee_rate,
    p_expense_rate: value.expense_rate,
    p_markup_rate: value.markup_rate,
    p_expense_methods: value.expense_methods,
    p_lines: lines,
    p_adjustment: value.adjustment,
    p_adjustment_reason: value.adjustment_reason || null,
    p_notes: value.notes || null,
  });
  if (error) return { ok: false, error: message(error) };
  revalidatePath(`/admin/quotes/standard-drafts/${value.draft_id}`);
  return { ok: true, message: '保存しました。金額は DB で計算し直しています。', lockVersion: typeof data === 'number' ? data : undefined };
}

/** 保存済みの内容で正式保存（発行）する。価格未確定の明細が残っていれば DB が拒否する */
export async function finalizeStandardQuoteDraftAction(input: unknown): Promise<StandardQuoteActionResult> {
  await requireAdmin('/admin/quotes');
  if (isLocalMode()) return { ok: false, error: LOCAL_UNAVAILABLE };
  const parsed = z.object({ draft_id: z.uuid(), expected_lock_version: z.number().int().min(0) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容を確認してください' };
  const supabase = await createClient();
  // DB の更新（20261016111000）が済むまで、旧い関数で正式見積を発行しない
  const blocked = await quoteLineGuardError(supabase);
  if (blocked) return { ok: false, error: blocked };
  // 初回か改訂かは DB の下書きで判断する（画面の値は使わない）
  const { data: detail, error: readError } = await supabase.rpc('get_standard_quote_draft', { p_draft_id: parsed.data.draft_id });
  if (readError || !detail) return { ok: false, error: message(readError) };
  const parentQuoteId = (detail as { draft?: { parent_quote_id?: string | null } }).draft?.parent_quote_id ?? null;
  const { data: quoteId, error } = await supabase.rpc(parentQuoteId ? 'finalize_quote_revision_draft' : 'finalize_quote_draft', {
    p_draft_id: parsed.data.draft_id,
    p_expected_lock_version: parsed.data.expected_lock_version,
  });
  if (error || !quoteId) return { ok: false, error: message(error) };
  const { data: quote } = await supabase.from('quotes').select('id, revision').eq('id', quoteId as string).maybeSingle();
  const revision = (quote as { revision?: number } | null)?.revision ?? 1;
  revalidatePath('/admin/quotes');
  revalidatePath(`/admin/quotes/${quoteId as string}`);
  redirect(
    `/admin/quotes?case=${encodeURIComponent(quoteId as string)}&tab=estimate&${revision > 1 ? 'revised=1' : 'created=1'}&revision=${encodeURIComponent(String(revision))}#case-workspace`
  );
}
