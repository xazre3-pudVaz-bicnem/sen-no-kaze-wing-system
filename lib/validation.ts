import { z } from 'zod';
import { VIEW_KEYS } from '@/lib/domain/types';
import { contactTopics } from '@/data/site-content';

const trimmed = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v));

export const passwordSchema = z
  .string()
  .min(8, 'パスワードは8文字以上で入力してください')
  .max(72, 'パスワードは72文字以内で入力してください')
  .regex(/[A-Za-z]/, '英字を含めてください')
  .regex(/[0-9]/, '数字を含めてください');

export const signUpSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません').max(254),
  password: passwordSchema,
  full_name: trimmed(60).min(1, '氏名を入力してください'),
  company_name: optional(100),
  phone: trimmed(20).min(1, '電話番号を入力してください').regex(/^[0-9+\-() ]+$/, '電話番号は数字とハイフンで入力してください'),
  postal_code: optional(10),
  address: trimmed(200).min(1, '住所を入力してください'),
  agree: z.literal('on', { error: '利用規約とプライバシーポリシーへの同意が必要です' }),
});

export const signInSchema = z.object({
  email: z.email('メールアドレスの形式が正しくありません'),
  password: z.string().min(1, 'パスワードを入力してください'),
});

export const resetRequestSchema = z.object({ email: z.email('メールアドレスの形式が正しくありません') });

export const updatePasswordSchema = z
  .object({
    password: passwordSchema,
    password_confirm: z.string(),
    token: z.string().optional(),
  })
  .refine((v) => v.password === v.password_confirm, { message: 'パスワードが一致しません', path: ['password_confirm'] });

export const profileSchema = z.object({
  full_name: trimmed(60).min(1, '氏名を入力してください'),
  company_name: optional(100),
  phone: optional(20),
  postal_code: optional(10),
  address: optional(200),
});

export const saveConfigurationSchema = z.object({
  id: z.uuid().nullable(),
  base_model_id: z.uuid(),
  name: trimmed(60),
  option_ids: z.array(z.uuid()).max(100),
  preview_image_url: z.string().max(500).nullable(),
  notes: optional(1000).nullable(),
  finish_level: z.enum(['shell', 'equipment', 'full']).default('full'),
  variant_choice_ids: z.array(z.uuid()).max(300).default([]),
});

export const quoteRequestSchema = z.object({
  configuration_id: z.uuid(),
  full_name: trimmed(60).min(1, 'お名前を入力してください'),
  company_name: optional(100),
  email: z.email('メールアドレスの形式が正しくありません'),
  phone: trimmed(20).min(1, '電話番号を入力してください'),
  address: trimmed(200).min(1, 'ご住所を入力してください'),
  site_address: optional(200),
  message: optional(2000),
});

export const contactSchema = z.object({
  full_name: trimmed(60).min(1, 'お名前を入力してください'),
  email: z.email('メールアドレスの形式が正しくありません'),
  phone: optional(20),
  topic: z.enum(contactTopics, { error: 'お問い合わせの種類を選択してください' }),
  message: trimmed(2000).min(1, 'お問い合わせ内容を入力してください'),
  agree: z.literal('on', { error: 'プライバシーポリシーへの同意が必要です' }),
  // ハニーポット
  website: z.string().max(0).optional(),
});

/* ---------- 管理画面 ---------- */

const intFromForm = z.coerce.number().int().min(0);
const boolFromForm = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const statusSchema = z.enum(['published', 'draft']);

export const modelSchema = z.object({
  id: z.uuid().nullable(),
  slug: trimmed(60).min(1).regex(/^[a-z0-9-]+$/, 'slug は英小文字・数字・ハイフン'),
  name: trimmed(60).min(1),
  tagline: trimmed(120),
  description: trimmed(2000),
  base_price: intFromForm,
  expense_rate: z.coerce.number().min(0).max(1),
  presets: z.array(z.object({ code: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1), description: z.string(), option_codes: z.array(z.string()) })),
  status: statusSchema,
  sort_order: intFromForm,
  specs: z.array(z.object({ label: z.string(), value: z.string() })),
  features: z.array(z.object({ title: z.string(), body: z.string() })),
  standard_equipment: z.array(z.string()),
  use_cases: z.array(z.string()),
});

export const categorySchema = z.object({
  id: z.uuid().nullable(),
  code: trimmed(40).min(1).regex(/^[a-z0-9-]+$/),
  name: trimmed(40).min(1),
  group_code: trimmed(40).min(1).regex(/^[a-z0-9-]+$/),
  group_name: trimmed(40).min(1),
  group_sort: intFromForm,
  description: optional(200),
  selection_mode: z.enum(['single', 'multi']),
  finish_level: z.enum(['shell', 'equipment', 'full']),
  is_required: boolFromForm,
  sort_order: intFromForm,
  status: statusSchema,
});

export const optionSchema = z.object({
  id: z.uuid().nullable(),
  base_model_id: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  category_id: z.uuid(),
  code: trimmed(60).min(1).regex(/^[a-z0-9-]+$/, 'コードは英小文字・数字・ハイフン'),
  name: trimmed(60).min(1, '名称を入力してください'),
  description: optional(500),
  price: intFromForm,
  image_url: optional(500),
  selection_type: z.enum(['checkbox', 'radio']),
  is_required: boolFromForm,
  is_default: boolFromForm,
  is_installation: boolFromForm,
  price_on_request: boolFromForm,
  preview_key: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().regex(/^[a-z0-9_]+$/, 'プレビューキーは英小文字・数字・アンダースコア').nullable()
  ),
  affects_views: z.array(z.enum(VIEW_KEYS)),
  spec_codes: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  sort_order: intFromForm,
  status: statusSchema,
  owner_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.uuid().nullable()),
  manufacturer: optional(60).nullable(),
  model_no: optional(80).nullable(),
  size_note: optional(120).nullable(),
  list_price: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.coerce.number().int().min(0).max(100_000_000).nullable()),
  highlight: optional(40).nullable(),
});

export const previewRuleSchema = z.object({
  id: z.uuid().nullable(),
  base_model_id: z.uuid(),
  view: z.enum(VIEW_KEYS),
  kind: z.enum(['composite', 'layer']),
  preview_keys: z.array(z.string().regex(/^[a-z0-9_]+$/)),
  url: trimmed(500).min(1, '画像をアップロードするか URL を入力してください'),
  alt: trimmed(200),
  note: optional(300),
  z_index: z.coerce.number().int(),
  status: statusSchema,
});

export const productImageSchema = z.object({
  base_model_id: z.uuid(),
  kind: z.enum(['hero', 'exterior', 'interior', 'floorplan', 'transport', 'case']),
  url: trimmed(500).min(1, '画像をアップロードするか URL を入力してください'),
  alt: trimmed(200),
  caption: optional(200),
  sort_order: intFromForm,
});

export const quoteStatusSchema = z.object({
  quote_id: z.uuid(),
  status: z.enum(['issued', 'expired', 'accepted', 'declined', 'cancelled']),
  request_status: z.preprocess((v) => (v === '' ? null : v), z.enum(['new', 'reviewing', 'sent', 'closed', 'cancelled']).nullable()),
});

export type FieldErrors = Record<string, string[] | undefined>;

export function flattenErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** 管理者が見積へ代理店を割り当てる */
export const assignDealerSchema = z.object({
  quote_id: z.uuid(),
  dealer_id: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.uuid().nullable()),
});

/** 代理店が入力する別途工事・フリー商品の 1 行 */
export const dealerRevisionItemSchema = z.object({
  kind: z.enum(['installation', 'free']),
  name: trimmed(80).min(1, '項目名を入力してください'),
  description: optional(200).nullable(),
  unit_price: z.coerce.number().int().min(0, '金額は 0 円以上で入力してください').max(100_000_000),
  quantity: z.coerce.number().int().min(1).max(999),
});

export const dealerRevisionSchema = z.object({
  quote_id: z.uuid(),
  items: z.array(dealerRevisionItemSchema).max(60),
  dealer_note: optional(1000).nullable(),
});

/** 管理者がユーザーの権限を変更する */
export const userRoleSchema = z.object({
  user_id: z.uuid(),
  role_code: z.enum(['customer', 'dealer', 'master_dealer', 'admin']),
});
