import { z } from 'zod';

/**
 * 標準見積 v2.5 の下書きの保存の payload（save_standard_estimate_v25_draft に渡す形）の確かめ。
 * Server Action（lib/actions/standard-estimate-v25.ts）から使う。DB の RPC でも同じ決まりで確かめる。
 * z.object は知らないキーを捨てるので、payload に項目を足したら、ここにも足す（2026-11-16：row_order・work_item）
 */
const decimal = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, '数の形式が正しくありません'));

export const v25SavePayloadSchema = z.object({
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
        // 位置・用途の選択枠（v2.5 PR-S1）。DB でも同じ決まりで確かめる
        slot_code: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).nullable().default(null),
        slot_label: z.string().trim().min(1).max(40).nullable().default(null),
        selectable_option_ids: z.array(z.uuid()).max(50).default([]),
        // 並び順（版の中で商品と明細を通した番号）と工事項目（2026-11-16 の先方の依頼。DB でも同じ決まりで確かめる）
        row_order: z.number().int().min(1).max(100000).nullable().optional(),
        work_item: z.string().trim().max(120).nullable().optional(),
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
        row_order: z.number().int().min(1).max(100000).nullable().optional(),
      })
    )
    .max(300),
});
