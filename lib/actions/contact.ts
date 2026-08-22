'use server';

import { getStore } from '@/lib/data/store';
import { contactSchema, flattenErrors, type FieldErrors } from '@/lib/validation';

export interface ContactState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

const MAX_ATTACHMENT = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'application/pdf']);

/**
 * お問い合わせを保存する（添付は非公開ストレージへ）。
 * 通知メールは第二段階（送信基盤の導入後）。管理画面 /admin/contacts で確認できる。
 */
export async function submitContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)])
  );
  const parsed = contactSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'website')) return { ok: true }; // bot
    return { ok: false, fieldErrors: flattenErrors(parsed.error), values };
  }

  let attachment: { bytes: Uint8Array; contentType: string; fileName: string } | null = null;
  const file = formData.get('attachment');
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED.has(file.type)) return { ok: false, fieldErrors: { attachment: ['画像（JPEG/PNG/WebP）または PDF を添付してください'] }, values };
    if (file.size > MAX_ATTACHMENT) return { ok: false, fieldErrors: { attachment: ['ファイルは 10MB 以下にしてください'] }, values };
    attachment = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, fileName: file.name };
  }

  try {
    const store = await getStore();
    await store.createContactMessage({
      full_name: parsed.data.full_name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      topic: parsed.data.topic,
      message: parsed.data.message,
      attachment,
    });
  } catch (e) {
    console.error('[wing] contact save failed', e);
    return { ok: false, error: '送信に失敗しました。時間をおいて再度お試しいただくか、お電話にてご連絡ください。', values };
  }
  return { ok: true };
}
