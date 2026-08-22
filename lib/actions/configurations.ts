'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/auth/session';
import { getStore, StoreError } from '@/lib/data/store';
import type { Configuration, QuoteContact } from '@/lib/domain/types';
import { quoteRequestSchema, saveConfigurationSchema, flattenErrors, type FieldErrors } from '@/lib/validation';

export type SaveErrorCode = 'UNAUTHENTICATED' | 'VALIDATION' | 'LOCKED' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL';

export type SaveResult = { ok: true; configuration: Configuration } | { ok: false; error: string; code: SaveErrorCode };

function fromStoreError(e: unknown): { error: string; code: SaveErrorCode } {
  if (e instanceof StoreError) return { error: e.message, code: e.code };
  console.error('[wing] action error', e);
  return { error: '保存中にエラーが発生しました。時間をおいて再度お試しください。', code: 'INTERNAL' };
}

/** シミュレーターからの保存（JSON 呼び出し）。金額はサーバー側で再計算する */
export async function saveConfigurationAction(input: unknown): Promise<SaveResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: '保存にはログインが必要です。', code: 'UNAUTHENTICATED' };
  const parsed = saveConfigurationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力内容が正しくありません。', code: 'VALIDATION' };
  try {
    const store = await getStore();
    const configuration = await store.saveConfiguration(user, parsed.data);
    revalidatePath('/mypage');
    return { ok: true, configuration };
  } catch (e) {
    return { ok: false, ...fromStoreError(e) };
  }
}

export async function duplicateConfigurationAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/mypage');
  const id = String(formData.get('id') ?? '');
  const store = await getStore();
  try {
    await store.duplicateConfiguration(id, user);
  } catch (e) {
    redirect(`/mypage?error=${encodeURIComponent(fromStoreError(e).error)}`);
  }
  revalidatePath('/mypage');
  redirect('/mypage?duplicated=1');
}

export async function deleteConfigurationAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/mypage');
  const id = String(formData.get('id') ?? '');
  const store = await getStore();
  try {
    await store.deleteConfiguration(id, user);
  } catch (e) {
    redirect(`/mypage?error=${encodeURIComponent(fromStoreError(e).error)}`);
  }
  revalidatePath('/mypage');
  redirect('/mypage?deleted=1');
}

export interface QuoteRequestState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
}

export async function requestQuoteAction(_prev: QuoteRequestState, formData: FormData): Promise<QuoteRequestState> {
  const user = await getSessionUser();
  const raw = Object.fromEntries(formData);
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  if (!user) return { ok: false, error: '見積依頼にはログインが必要です。', values };
  const parsed = quoteRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error), values };
  const { configuration_id, message, ...contact } = parsed.data;
  const store = await getStore();
  let quoteId: string;
  try {
    const quote = await store.createQuoteFromConfiguration(user, configuration_id, contact as QuoteContact, message);
    quoteId = quote.id;
  } catch (e) {
    return { ok: false, error: fromStoreError(e).error, values };
  }
  revalidatePath('/mypage');
  redirect(`/mypage/quotes/${quoteId}?requested=1`);
}
