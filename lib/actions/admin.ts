'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireAdmin } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, StoreError } from '@/lib/data/store';
import {
  categorySchema,
  modelSchema,
  optionSchema,
  previewRuleSchema,
  productImageSchema,
  quoteStatusSchema,
  flattenErrors,
  type FieldErrors,
} from '@/lib/validation';

export interface AdminFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function errState(e: unknown): AdminFormState {
  if (e instanceof StoreError) return { ok: false, error: e.message };
  console.error('[wing] admin action error', e);
  return { ok: false, error: '処理中にエラーが発生しました。' };
}

/** 画像ファイルがあればアップロードして URL を返す。なければ url フィールドをそのまま使う */
async function resolveImageUrl(formData: FormData, folder: string, field = 'url', fileField = 'file'): Promise<string> {
  const file = formData.get(fileField);
  if (file instanceof File && file.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new StoreError('VALIDATION', 'JPEG / PNG / WebP / AVIF のみアップロードできます');
    if (file.size > MAX_IMAGE_BYTES) throw new StoreError('VALIDATION', '画像は 10MB 以下にしてください');
    const store = await getStore();
    return store.uploadImage({ bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, fileName: file.name }, folder);
  }
  return String(formData.get(field) ?? '').trim();
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

const pairs = (v: FormDataEntryValue | null, a: string, b: string) =>
  lines(v).map((line) => {
    const [k, ...rest] = line.split('|');
    return { [a]: k.trim(), [b]: rest.join('|').trim() };
  });

const nullableId = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

export async function saveModelAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  const parsed = modelSchema.safeParse({
    id: nullableId(formData.get('id')),
    slug: formData.get('slug'),
    name: formData.get('name'),
    tagline: formData.get('tagline'),
    description: formData.get('description'),
    base_price: formData.get('base_price'),
    expense_rate: Number(formData.get('expense_rate') || 15) / 100,
    presets: lines(formData.get('presets')).map((line) => {
      const [code = '', name = '', description = '', opts = ''] = line.split('|').map((s) => s.trim());
      return { code, name, description, option_codes: opts.split(',').map((s) => s.trim()).filter(Boolean) };
    }),
    status: formData.get('status'),
    sort_order: formData.get('sort_order'),
    specs: pairs(formData.get('specs'), 'label', 'value'),
    features: pairs(formData.get('features'), 'title', 'body'),
    standard_equipment: lines(formData.get('standard_equipment')),
    use_cases: lines(formData.get('use_cases')),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  let createdId: string | null = null;
  try {
    const store = await getStore();
    const m = await store.upsertModel(parsed.data);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    if (!parsed.data.id) createdId = m.id;
  } catch (e) {
    return errState(e);
  }
  if (createdId) redirect(`/admin/models/${createdId}?saved=1`);
  return { ok: true, message: '保存しました' };
}

export async function saveCategoryAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  const parsed = categorySchema.safeParse({
    id: nullableId(formData.get('id')),
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description'),
    group_code: formData.get('group_code'),
    group_name: formData.get('group_name'),
    group_sort: formData.get('group_sort') || 99,
    selection_mode: formData.get('selection_mode'),
    is_required: formData.get('is_required'),
    sort_order: formData.get('sort_order'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.upsertCategory(parsed.data);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: '保存しました' };
  } catch (e) {
    return errState(e);
  }
}

export async function saveOptionAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  let image_url: string;
  try {
    image_url = await resolveImageUrl(formData, 'options', 'image_url', 'image_file');
  } catch (e) {
    return errState(e);
  }
  const parsed = optionSchema.safeParse({
    id: nullableId(formData.get('id')),
    base_model_id: formData.get('base_model_id'),
    category_id: formData.get('category_id'),
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description'),
    price: formData.get('price'),
    image_url,
    selection_type: formData.get('selection_type'),
    is_required: formData.get('is_required'),
    is_default: formData.get('is_default'),
    is_installation: formData.get('is_installation'),
    price_on_request: formData.get('price_on_request'),
    preview_key: formData.get('preview_key'),
    affects_views: formData.getAll('affects_views'),
    spec_codes: formData.getAll('spec_codes'),
    sort_order: formData.get('sort_order'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  const dependencies = formData
    .getAll('requires')
    .map(String)
    .filter(Boolean)
    .map((requires_option_id) => ({ requires_option_id, message: nullableId(formData.get(`requires_message_${requires_option_id}`)) }));
  const conflicts = formData
    .getAll('conflicts')
    .map(String)
    .filter(Boolean)
    .map((conflicts_with_option_id) => ({
      conflicts_with_option_id,
      message: nullableId(formData.get(`conflicts_message_${conflicts_with_option_id}`)),
    }));
  let createdId: string | null = null;
  try {
    const store = await getStore();
    const o = await store.upsertOption(parsed.data);
    await store.setOptionRelations(
      o.id,
      dependencies.filter((d) => d.requires_option_id !== o.id),
      conflicts.filter((c) => c.conflicts_with_option_id !== o.id)
    );
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    if (!parsed.data.id) createdId = o.id;
  } catch (e) {
    return errState(e);
  }
  if (createdId) redirect(`/admin/options/${createdId}?saved=1`);
  return { ok: true, message: '保存しました' };
}

export async function deleteOptionAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const store = await getStore();
  try {
    await store.deleteOption(id);
  } catch (e) {
    redirect(`/admin/options/${id}?error=${encodeURIComponent(errState(e).error ?? '')}`);
  }
  revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
  redirect('/admin/options?deleted=1');
}

export async function savePreviewRuleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  let url: string;
  try {
    url = await resolveImageUrl(formData, 'preview');
  } catch (e) {
    return errState(e);
  }
  const parsed = previewRuleSchema.safeParse({
    id: nullableId(formData.get('id')),
    base_model_id: formData.get('base_model_id'),
    view: formData.get('view'),
    kind: formData.get('kind'),
    preview_keys: [...new Set(formData.getAll('preview_keys').map(String).filter(Boolean))].sort(),
    url,
    alt: formData.get('alt'),
    note: formData.get('note'),
    z_index: formData.get('z_index') || 0,
    status: formData.get('status') || 'published',
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.upsertPreviewRule(parsed.data);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: '保存しました' };
  } catch (e) {
    return errState(e);
  }
}

export async function deletePreviewRuleAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const store = await getStore();
  await store.deletePreviewRule(String(formData.get('id') ?? ''));
  revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
  redirect('/admin/preview-rules?deleted=1');
}

export async function addProductImageAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  let url: string;
  try {
    url = await resolveImageUrl(formData, 'products');
  } catch (e) {
    return errState(e);
  }
  const parsed = productImageSchema.safeParse({
    base_model_id: formData.get('base_model_id'),
    kind: formData.get('kind'),
    url,
    alt: formData.get('alt'),
    caption: formData.get('caption'),
    sort_order: formData.get('sort_order') || 0,
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.addProductImage(parsed.data);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: '画像を追加しました' };
  } catch (e) {
    return errState(e);
  }
}

export async function deleteProductImageAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const store = await getStore();
  await store.deleteProductImage(String(formData.get('id') ?? ''));
  revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
  redirect(`/admin/models/${String(formData.get('base_model_id') ?? '')}?image_deleted=1`);
}

export async function updateContactStatusAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || (status !== 'new' && status !== 'handled')) return { ok: false, error: '入力内容が正しくありません' };
  try {
    const store = await getStore();
    await store.updateContactStatus(id, status);
    revalidatePath('/admin/contacts');
    return { ok: true, message: '更新しました' };
  } catch (e) {
    return errState(e);
  }
}

export async function updateQuoteStatusAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireAdmin();
  const parsed = quoteStatusSchema.safeParse({
    quote_id: formData.get('quote_id'),
    status: formData.get('status'),
    request_status: formData.get('request_status'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.updateQuoteStatus(parsed.data.quote_id, parsed.data.status, parsed.data.request_status);
    revalidatePath('/admin/quotes');
    revalidatePath('/mypage');
    return { ok: true, message: 'ステータスを更新しました' };
  } catch (e) {
    return errState(e);
  }
}
