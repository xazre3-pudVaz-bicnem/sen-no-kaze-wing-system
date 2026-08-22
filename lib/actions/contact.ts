'use server';

import { contactSchema, flattenErrors, type FieldErrors } from '@/lib/validation';

export interface ContactState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

/**
 * お問い合わせフォーム。
 * 第一段階ではメール送信基盤（Resend 等）を持たないため、サーバーログに記録する。
 * QUOTE_NOTIFY_EMAIL と送信基盤を用意したら、ここから通知を出す。
 */
export async function submitContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'website')) return { ok: true }; // bot
    return { ok: false, fieldErrors: flattenErrors(parsed.error), values };
  }
  console.info('[wing] contact received', {
    name: parsed.data.full_name,
    email: parsed.data.email,
    phone: parsed.data.phone,
    at: new Date().toISOString(),
  });
  return { ok: true };
}
