'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireAdmin, requireCatalogEditor, requireStaff } from '@/lib/auth/session';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, ROLE_LABELS } from '@/lib/domain/types';
import { flushNotificationsSafely } from '@/lib/mail/send';
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
  assignDealerSchema,
  dealerRevisionSchema,
  userRoleSchema,
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
  await requireCatalogEditor();
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
  await requireCatalogEditor();
  const parsed = categorySchema.safeParse({
    id: nullableId(formData.get('id')),
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description'),
    group_code: formData.get('group_code'),
    group_name: formData.get('group_name'),
    group_sort: formData.get('group_sort') || 99,
    selection_mode: formData.get('selection_mode'),
    finish_level: formData.get('finish_level') || 'full',
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
  const actor = await requireStaff();
  const catalogEditor = canEditCatalog(actor.role);
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
    owner_id: catalogEditor ? nullableId(formData.get('owner_id')) : actor.id,
    manufacturer: formData.get('manufacturer'),
    model_no: formData.get('model_no'),
    size_note: formData.get('size_note'),
    list_price: formData.get('list_price'),
    highlight: formData.get('highlight'),
    sort_order: formData.get('sort_order'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  // 代理店はフリー商品カテゴリー以外を触れない（サーバー側で拒否）
  if (!catalogEditor) {
    const store = await getStore();
    const categories = await store.listCategories();
    const cat = categories.find((c) => c.id === parsed.data.category_id);
    if (cat?.code !== FREE_PRODUCT_CATEGORY_CODE) {
      return { ok: false, error: '代理店が登録できるのはフリー商品だけです。' };
    }
    if (parsed.data.id) {
      const existing = (await store.listOptions()).find((o) => o.id === parsed.data.id);
      if (existing && existing.owner_id !== actor.id) {
        return { ok: false, error: '他の代理店が登録した商品は編集できません。' };
      }
    }
  }
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
  await requireCatalogEditor();
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
  await requireCatalogEditor();
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
  await requireCatalogEditor();
  const store = await getStore();
  await store.deletePreviewRule(String(formData.get('id') ?? ''));
  revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
  redirect('/admin/preview-rules?deleted=1');
}

export async function addProductImageAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();
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
  await requireCatalogEditor();
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

/** 管理者：見積へ担当代理店を割り当てる */
export async function assignQuoteDealerAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = assignDealerSchema.safeParse({
    quote_id: formData.get('quote_id'),
    dealer_id: formData.get('dealer_id'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.assignQuoteDealer(parsed.data.quote_id, parsed.data.dealer_id, admin);
    await flushNotificationsSafely();
    revalidatePath(`/admin/quotes/${parsed.data.quote_id}`);
    revalidatePath('/admin/quotes');
    return { ok: true, message: parsed.data.dealer_id ? '担当代理店を割り当てました' : '担当代理店を外しました' };
  } catch (e) {
    return errState(e);
  }
}

/**
 * 代理店：別途工事・フリー商品を入力して確定見積（次の版）を発行する。
 * 発行済みの版は書き換えず、新しい版として作り直す。
 */
export async function createDealerRevisionAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireStaff();
  const rows: unknown[] = [];
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^items\.(\d+)\.kind$/);
    if (!m) continue;
    const i = m[1];
    rows.push({
      kind: value,
      name: formData.get(`items.${i}.name`),
      description: formData.get(`items.${i}.description`),
      unit: formData.get(`items.${i}.unit`),
      remark: formData.get(`items.${i}.remark`),
      unit_price: formData.get(`items.${i}.unit_price`) || 0,
      quantity: formData.get(`items.${i}.quantity`) || 1,
    });
  }
  const parsed = dealerRevisionSchema.safeParse({
    quote_id: formData.get('quote_id'),
    items: rows,
    dealer_note: formData.get('dealer_note'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  let newId: string | null = null;
  try {
    const store = await getStore();
    const quote = await store.createDealerRevision(
      parsed.data.quote_id,
      { items: parsed.data.items, dealer_note: parsed.data.dealer_note },
      actor
    );
    newId = quote.id;
    await flushNotificationsSafely();
    revalidatePath('/admin/quotes');
    revalidatePath('/mypage');
  } catch (e) {
    return errState(e);
  }
  redirect(`/admin/quotes/${newId}?revised=1`);
}

/** 管理者：ユーザーの権限を変更する（自分自身は変更できない） */
export async function updateUserRoleAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const parsed = userRoleSchema.safeParse({
    user_id: formData.get('user_id'),
    role_code: formData.get('role_code'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    const profile = await store.updateUserRole(parsed.data.user_id, parsed.data.role_code, admin);
    revalidatePath('/admin/customers');
    return { ok: true, message: `${profile.full_name} さんの権限を「${ROLE_LABELS[profile.role_code]}」に変更しました` };
  } catch (e) {
    return errState(e);
  }
}

/** お知らせをすべて既読にする */
export async function markAllNotificationsReadAction(): Promise<void> {
  const actor = await requireStaff();
  const store = await getStore();
  await store.markAllNotificationsRead(actor);
  revalidatePath('/admin/notifications');
  revalidatePath('/admin');
  redirect('/admin/notifications?read=1');
}

/* ---------------- 商品の一括登録 ---------------- */

export interface ImportState {
  ok: boolean;
  error?: string;
  /** 取り込む前の内容確認 */
  preview?: {
    fileName: string;
    categories: number;
    products: number;
    variantGroups: number;
    variantChoices: number;
    images: number;
    imagesUploaded: number;
    warnings: string[];
    sample: { name: string; category: string; price: string; variants: string }[];
  };
  /** 取り込んだ結果 */
  applied?: {
    createdProducts: number;
    updatedProducts: number;
    variantGroups: number;
    variantChoices: number;
    imagesLinked: number;
    skipped: string[];
    warnings: string[];
  };
}

const MAX_SHEET_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_BYTES = 60 * 1024 * 1024;

/**
 * Excel（または CSV）と画像 ZIP を受け取り、商品と選択項目をまとめて登録する。
 * 「確認する」で内容を見せ、「登録する」で実際に書き込む。
 */
export async function importCatalogAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await requireCatalogEditor();
  const apply = formData.get('mode') === 'apply';

  const sheetFile = formData.get('sheet');
  if (!(sheetFile instanceof File) || sheetFile.size === 0) {
    return { ok: false, error: '商品マスターのファイルを選んでください。' };
  }
  if (sheetFile.size > MAX_SHEET_BYTES) return { ok: false, error: 'ファイルが大きすぎます（20MB まで）。' };

  const { readCsv, readXlsx, unzip } = await import('@/lib/import/archive');
  const { buildImportPlan, summarize } = await import('@/lib/import/catalog-import');

  let plan;
  try {
    const buf = Buffer.from(await sheetFile.arrayBuffer());
    if (/\.csv$/i.test(sheetFile.name)) {
      // CSV は 1 枚しかないので、シート名をファイル名から推測する
      plan = buildImportPlan([{ name: sheetFile.name.replace(/\.csv$/i, ''), rows: readCsv(buf.toString('utf8')) }]);
    } else {
      plan = buildImportPlan(readXlsx(buf));
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'ファイルを読み取れませんでした。' };
  }

  // 画像 ZIP（任意）
  const images = new Map<string, string>();
  const uploadedUrls: string[] = [];
  const zipFile = formData.get('images');
  let uploadedCount = 0;
  if (zipFile instanceof File && zipFile.size > 0) {
    if (zipFile.size > MAX_ZIP_BYTES) return { ok: false, error: '画像 ZIP が大きすぎます（60MB まで）。' };
    const store = await getStore();
    const entries = unzip(Buffer.from(await zipFile.arrayBuffer()));
    for (const entry of entries) {
      const base = entry.name.split('/').pop() ?? entry.name;
      if (!/\.(jpe?g|png|webp|avif)$/i.test(base)) continue;
      if (!apply) {
        // 確認のときはアップロードせず件数だけ数える
        images.set(base, '');
        uploadedCount++;
        continue;
      }
      const ext = base.split('.').pop()?.toLowerCase() ?? 'jpg';
      const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'avif' ? 'image/avif' : 'image/jpeg';
      try {
        const url = await store.uploadImage({ bytes: new Uint8Array(entry.data), contentType: type, fileName: base }, 'catalog');
        images.set(base, url);
        uploadedUrls.push(url);
        uploadedCount++;
      } catch {
        plan.warnings.push(`画像「${base}」を保存できませんでした。`);
      }
    }
  }

  const s = summarize(plan);

  if (!apply) {
    const groupsOf = (code: string) => [...new Set(plan.choices.filter((c) => c.productCode === code).map((c) => c.groupName))];
    return {
      ok: true,
      preview: {
        fileName: sheetFile.name,
        ...s,
        imagesUploaded: uploadedCount,
        warnings: plan.warnings,
        sample: plan.products.slice(0, 8).map((p) => ({
          name: p.manufacturer ? `${p.manufacturer} ${p.name}` : p.name,
          category: p.categoryName,
          price: p.price == null ? '別途見積' : `¥${p.price.toLocaleString('ja-JP')}`,
          variants: groupsOf(p.code).join('／') || '—',
        })),
      },
    };
  }

  let applied: NonNullable<ImportState['applied']>;
  try {
    const { applyImportPlan } = await import('@/lib/import/apply');
    applied = await applyImportPlan(plan, images);
  } catch (e) {
    if (uploadedUrls.length) {
      const store = await getStore();
      const cleanup = await Promise.allSettled(uploadedUrls.map((url) => store.deleteUploadedImage(url)));
      const failed = cleanup.filter((r) => r.status === 'rejected').length;
      const state = errState(e) as ImportState;
      if (failed) state.error = `${state.error ?? '一括登録に失敗しました。'}（未使用画像 ${failed} 件を削除できませんでした）`;
      return state;
    }
    return errState(e) as ImportState;
  }
  revalidatePath('/', 'layout');
  updateTag(CATALOG_TAG);
  return { ok: true, applied };
}
