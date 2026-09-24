'use server';

import { createHash, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { requireAdmin, requireCatalogEditor, requireStaff } from '@/lib/auth/session';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE, ROLE_LABELS, type PreviewImageRule } from '@/lib/domain/types';
import { flushNotificationsSafely } from '@/lib/mail/send';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isLocalMode, StoreError, type EstimateTemplateImportInput, type SessionUser } from '@/lib/data/store';
import { catalogImportPathFromImageUrl, isCatalogImportPathForUser } from '@/lib/import/catalog-import-images';
import {
  categorySchema,
  modelSchema,
  optionSchema,
  optionImageSchema,
  variantGroupSchema,
  variantChoiceSchema,
  previewRuleSchema,
  productImageSchema,
  quoteStatusSchema,
  flattenErrors,
  type FieldErrors,
  assignDealerSchema,
  dealerRevisionSchema,
  manualQuoteSchema,
  baseBreakdownSchema,
  optionPricesSchema,
  userRoleSchema,
} from '@/lib/validation';
import { pruneToScope } from '@/lib/domain/rules';
import { buildPresetSelection, defaultVariantIdsFor } from '@/lib/domain/preset';
import { BASE_FLOORPLAN_NOTE, enforceDedicatedBaseFloorplanFields, enforcePresetFloorplanFields } from '@/lib/domain/preview-rule-meta';
import { estimateBaselineOptionCodes } from '@/lib/domain/estimate-template';
import { withPlanDisplaySize } from '@/lib/domain/plan-display';

export interface AdminFormState {
  ok: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  message?: string;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PRODUCT_DOCUMENT_BYTES = 20 * 1024 * 1024;

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

async function editableOptionContext(actor: SessionUser, optionId: string) {
  const store = await getStore();
  const option = await store.getOption(optionId);
  if (!option) throw new StoreError('NOT_FOUND', '商品が見つかりません。');
  if (canEditCatalog(actor.role)) return { store, option };

  const category = (await store.listCategories()).find((row) => row.id === option.category_id);
  if (actor.role !== 'customer' && option.owner_id === actor.id && category?.code === FREE_PRODUCT_CATEGORY_CODE) {
    return { store, option };
  }
  throw new StoreError('FORBIDDEN', 'この商品のメディアは編集できません。');
}

export async function saveModelAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();

  let presets: unknown[];
  const presetsJson = String(formData.get('presets_json') ?? '').trim();
  try {
    presets = presetsJson
      ? JSON.parse(presetsJson)
      : lines(formData.get('presets')).map((line) => {
          const [code = '', name = '', description = '', opts = ''] = line.split('|').map((s) => s.trim());
          return { code, name, display_name: '', description, option_codes: opts.split(',').map((s) => s.trim()).filter(Boolean) };
        });
  } catch {
    return { ok: false, fieldErrors: { presets: ['プラン設定の読み取りに失敗しました。入力内容を確認してください。'] } };
  }

  const baseSpecs = pairs(formData.get('specs'), 'label', 'value') as { label: string; value: string }[];
  const planDisplaySize = String(formData.get('plan_display_size') ?? '').trim();

  const parsed = modelSchema.safeParse({
    id: nullableId(formData.get('id')),
    slug: formData.get('slug'),
    name: formData.get('name'),
    tagline: formData.get('tagline'),
    description: formData.get('description'),
    base_price: formData.get('base_price'),
    expense_rate: Number(formData.get('expense_rate') || 15) / 100,
    presets,
    status: formData.get('status'),
    sort_order: formData.get('sort_order'),
    specs: withPlanDisplaySize(baseSpecs, planDisplaySize),
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
  const optionId = nullableId(formData.get('id'));
  const store = await getStore();
  const existingOption = optionId ? await store.getOption(optionId) : null;
  if (optionId && !existingOption) return { ok: false, error: '商品が見つかりません。' };
  // options.code は既存Preset / Import互換の技術キー。登録担当者には入力させず、
  // 既存商品では必ず保持し、新規手入力商品だけ内部で一意な値を作る。
  const internalCode = existingOption?.code ?? `opt-${randomUUID()}`;
  let image_url: string;
  try {
    image_url = await resolveImageUrl(formData, 'options', 'image_url', 'image_file');
  } catch (e) {
    return errState(e);
  }
  const parsed = optionSchema.safeParse({
    id: optionId,
    base_model_id: formData.get('base_model_id'),
    category_id: formData.get('category_id'),
    code: internalCode,
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
    // 新規商品と既存の下書き商品はSTEP 1から公開できない。
    // 公開への変更はSTEP 2の publishOptionAction に限定する。
    // 既に公開中の商品は、STEP 1から下書きへ戻す操作だけ許可する。
    status: existingOption?.status === 'published' ? formData.get('status') : 'draft',
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  // 代理店はフリー商品カテゴリー以外を触れない（サーバー側で拒否）
  if (!catalogEditor) {
    const categories = await store.listCategories();
    const cat = categories.find((c) => c.id === parsed.data.category_id);
    if (cat?.code !== FREE_PRODUCT_CATEGORY_CODE) {
      return { ok: false, error: '代理店が登録できるのはフリー商品だけです。' };
    }
    if (existingOption && existingOption.owner_id !== actor.id) {
      return { ok: false, error: '他の代理店が登録した商品は編集できません。' };
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
  if (createdId) {
    const returnToRaw = String(formData.get('return_to') ?? '').trim();
    if (returnToRaw.startsWith('/admin/') && !returnToRaw.startsWith('//')) {
      const returnUrl = new URL(returnToRaw, 'https://wing.local');
      if (returnUrl.pathname.startsWith('/admin/')) {
        returnUrl.searchParams.set('created_option', createdId);
        redirect(returnUrl.pathname + returnUrl.search + returnUrl.hash);
      }
    }
    redirect('/admin/options/' + createdId + '?step=preview&saved=1');
  }
  return { ok: true, message: '保存しました' };
}

export async function publishOptionAction(formData: FormData): Promise<void> {
  const actor = await requireStaff();
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/admin/options?error=' + encodeURIComponent('商品が指定されていません。'));

  let context: Awaited<ReturnType<typeof editableOptionContext>>;
  try {
    context = await editableOptionContext(actor, id);
  } catch (e) {
    redirect(`/admin/options/${id}?step=preview&error=${encodeURIComponent(errState(e).error ?? '公開できませんでした。')}`);
  }
  const { store, option } = context;

  if (option.status !== 'published') {
    const {
      id: optionId,
      product_no: _productNo,
      gallery_images: _galleryImages,
      created_at: _createdAt,
      updated_at: _updatedAt,
      ...editable
    } = option;
    try {
      await store.upsertOption({ ...editable, id: optionId, status: 'published' });
    } catch (e) {
      redirect(`/admin/options/${id}?step=preview&error=${encodeURIComponent(errState(e).error ?? '公開できませんでした。')}`);
    }
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
  }

  redirect(`/admin/options/${id}?step=preview&published=1`);
}

export async function saveVariantGroupAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();
  const parsed = variantGroupSchema.safeParse({
    id: nullableId(formData.get('id')),
    option_id: formData.get('option_id'),
    code: formData.get('code'),
    name: formData.get('name'),
    note: formData.get('note'),
    depends_on_group_code: formData.get('depends_on_group_code'),
    depends_on_choice_codes: formData.getAll('depends_on_choice_codes').map(String).filter(Boolean),
    sort_order: formData.get('sort_order') || 0,
    is_required: formData.get('is_required'),
    status: formData.get('status') || 'published',
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };

  try {
    const store = await getStore();
    const option = await store.getOption(parsed.data.option_id);
    if (!option) return { ok: false, error: '商品が見つかりません。' };
    const variants = await store.getOptionVariants(option.id);
    const existing = parsed.data.id ? variants.groups.find((group) => group.id === parsed.data.id) : null;
    if (parsed.data.id && !existing) return { ok: false, error: '選択項目が見つかりません。' };
    if (existing && existing.code !== parsed.data.code) {
      return { ok: false, fieldErrors: { code: ['登録後のコードは変更できません。表示名を変更してください。'] } };
    }
    if (variants.groups.some((group) => group.code === parsed.data.code && group.id !== parsed.data.id)) {
      return { ok: false, fieldErrors: { code: ['この商品では同じ選択項目コードが既に使われています。'] } };
    }

    const dependencyCode = parsed.data.depends_on_group_code;
    if (dependencyCode) {
      const parent = variants.groups.find((group) => group.code === dependencyCode && group.id !== parsed.data.id);
      if (!parent) return { ok: false, fieldErrors: { depends_on_group_code: ['同じ商品の別の選択項目を指定してください。'] } };
      if (parsed.data.depends_on_choice_codes.length === 0) {
        return { ok: false, fieldErrors: { depends_on_choice_codes: ['表示する条件となる選択肢を1つ以上選んでください。'] } };
      }
      const parentChoices = variants.choices.filter((choice) => choice.group_id === parent.id);
      const validCodes = new Set(parentChoices.map((choice) => choice.code));
      if (parsed.data.depends_on_choice_codes.some((code) => !validCodes.has(code))) {
        return { ok: false, fieldErrors: { depends_on_choice_codes: ['表示条件に指定した選択肢が見つかりません。'] } };
      }
      if (parsed.data.status === 'published') {
        if (parent.status !== 'published') {
          return { ok: false, fieldErrors: { depends_on_group_code: ['公開する選択項目は、公開中の選択項目だけを表示条件にできます。'] } };
        }
        const unpublished = parentChoices.some(
          (choice) => parsed.data.depends_on_choice_codes.includes(choice.code) && choice.status !== 'published'
        );
        if (unpublished) {
          return { ok: false, fieldErrors: { depends_on_choice_codes: ['公開する選択項目の表示条件には、公開中の選択肢だけを指定してください。'] } };
        }
      }
    }

    if (existing && parsed.data.status === 'draft') {
      const publishedChild = variants.groups.find(
        (group) => group.id !== existing.id && group.status === 'published' && group.depends_on_group_code === existing.code
      );
      if (publishedChild) {
        return { ok: false, error: `「${publishedChild.name}」の表示条件に使われているため、先にその選択項目の表示条件を解除または非公開にしてください。` };
      }
    }

    await store.upsertVariantGroup({
      id: parsed.data.id ?? randomUUID(),
      option_id: option.id,
      code: parsed.data.code,
      name: parsed.data.name,
      note: parsed.data.note,
      depends_on_group_code: dependencyCode,
      depends_on_choice_codes: dependencyCode ? parsed.data.depends_on_choice_codes : [],
      sort_order: parsed.data.sort_order,
      is_required: parsed.data.is_required,
      status: parsed.data.status,
    });
    revalidatePath(`/admin/options/${option.id}`);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: parsed.data.id ? '選択項目を更新しました。' : '選択項目を追加しました。' };
  } catch (e) {
    return errState(e);
  }
}

export async function saveVariantChoiceAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();
  const optionId = String(formData.get('option_id') ?? '').trim();
  const groupId = String(formData.get('group_id') ?? '').trim();
  if (!optionId || !groupId) return { ok: false, error: '商品または選択項目が指定されていません。' };

  let uploadedUrl: string | null = null;
  try {
    const store = await getStore();
    const option = await store.getOption(optionId);
    if (!option) return { ok: false, error: '商品が見つかりません。' };
    const variants = await store.getOptionVariants(optionId);
    const group = variants.groups.find((row) => row.id === groupId);
    if (!group) return { ok: false, error: '選択項目が見つかりません。' };

    const id = nullableId(formData.get('id'));
    const existing = id ? variants.choices.find((choice) => choice.id === id && choice.group_id === group.id) : null;
    if (id && !existing) return { ok: false, error: '選択肢が見つかりません。' };

    const file = formData.get('image_file');
    const imageUrlField = String(formData.get('image_url') ?? existing?.image_url ?? '').trim();
    if (file instanceof File && file.size > 0) {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('url', imageUrlField);
      uploadedUrl = await resolveImageUrl(fd, 'variant-choices');
    }

    const parsed = variantChoiceSchema.safeParse({
      id,
      option_id: optionId,
      group_id: groupId,
      code: formData.get('code'),
      name: formData.get('name'),
      kind: formData.get('kind') || 'option',
      extra_price: formData.get('extra_price') || 0,
      price_on_request: formData.get('price_on_request'),
      image_url: uploadedUrl ?? imageUrlField,
      note: formData.get('note'),
      sort_order: formData.get('sort_order') || 0,
      status: formData.get('status') || 'published',
    });
    if (!parsed.success) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: flattenErrors(parsed.error) };
    }
    if (existing && existing.code !== parsed.data.code) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: { code: ['登録後のコードは変更できません。表示名を変更してください。'] } };
    }

    const groupChoices = variants.choices.filter((choice) => choice.group_id === group.id);
    if (groupChoices.some((choice) => choice.code === parsed.data.code && choice.id !== id)) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: { code: ['この選択項目では同じ選択肢コードが既に使われています。'] } };
    }
    if (parsed.data.kind === 'standard' && groupChoices.some((choice) => choice.id !== id && choice.kind === 'standard')) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: { kind: ['標準の選択肢は1項目につき1つだけです。先に現在の標準を変更してください。'] } };
    }
    if (parsed.data.kind === 'fixed' && groupChoices.some((choice) => choice.id !== id)) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: { kind: ['固定にできるのは、その選択項目に選択肢が1つだけの場合です。'] } };
    }
    if (parsed.data.kind !== 'fixed' && groupChoices.some((choice) => choice.id !== id && choice.kind === 'fixed')) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, fieldErrors: { kind: ['固定の選択肢があるため、先にその固定設定を変更してください。'] } };
    }
    if (!id && groupChoices.some((choice) => choice.kind === 'fixed')) {
      if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
      return { ok: false, error: '固定の選択肢があるため、この選択項目へ別の選択肢は追加できません。' };
    }

    if (existing && parsed.data.status === 'draft') {
      const publishedChild = variants.groups.find(
        (child) =>
          child.status === 'published' &&
          child.depends_on_group_code === group.code &&
          (child.depends_on_choice_codes ?? []).includes(existing.code)
      );
      if (publishedChild) {
        if (uploadedUrl) await store.deleteUploadedImage(uploadedUrl).catch(() => undefined);
        return { ok: false, error: `「${publishedChild.name}」の表示条件に使われているため、先にその表示条件を変更してください。` };
      }
    }

    await store.upsertVariantChoice({
      id: parsed.data.id ?? randomUUID(),
      group_id: group.id,
      code: parsed.data.code,
      name: parsed.data.name,
      kind: parsed.data.kind,
      extra_price: parsed.data.extra_price,
      price_on_request: parsed.data.price_on_request,
      image_url: parsed.data.image_url,
      note: parsed.data.note,
      sort_order: parsed.data.sort_order,
      status: parsed.data.status,
    });
    revalidatePath(`/admin/options/${optionId}`);
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: parsed.data.id ? '選択肢を更新しました。' : '選択肢を追加しました。' };
  } catch (e) {
    if (uploadedUrl) {
      try {
        const store = await getStore();
        await store.deleteUploadedImage(uploadedUrl);
      } catch {
        // 元のエラーを優先する
      }
    }
    return errState(e);
  }
}

export async function addOptionImageAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) return { ok: false, error: '商品が指定されていません。' };

  let uploadedUrl: string | null = null;
  try {
    const { store, option } = await editableOptionContext(actor, optionId);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, fieldErrors: { file: ['サブ画像を選択してください。'] } };
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return { ok: false, fieldErrors: { file: ['JPEG / PNG / WebP / AVIF のみアップロードできます。'] } };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, fieldErrors: { file: ['画像は 10MB 以下にしてください。'] } };
    }

    uploadedUrl = await store.uploadOptionImage(
      { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type, fileName: file.name },
      optionId
    );
    const parsed = optionImageSchema.safeParse({
      id: null,
      option_id: optionId,
      url: uploadedUrl,
      alt: String(formData.get('alt') ?? '').trim() || option.name,
      caption: nullableId(formData.get('caption')),
      sort_order: formData.get('sort_order') || option.gallery_images?.length || 0,
    });
    if (!parsed.success) {
      await store.deleteUploadedOptionImage(uploadedUrl, optionId).catch(() => undefined);
      return { ok: false, fieldErrors: flattenErrors(parsed.error) };
    }

    await store.upsertOptionImage(parsed.data);
    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: 'サブ画像を追加しました。' };
  } catch (e) {
    if (uploadedUrl) {
      try {
        const store = await getStore();
        await store.deleteUploadedOptionImage(uploadedUrl, optionId);
      } catch {
        // 元のエラーを優先する
      }
    }
    return errState(e);
  }
}

export async function updateOptionImageAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  const imageId = String(formData.get('id') ?? '').trim();
  if (!optionId || !imageId) return { ok: false, error: '商品画像が指定されていません。' };

  try {
    const { store, option } = await editableOptionContext(actor, optionId);
    const existing = option.gallery_images?.find((row) => row.id === imageId);
    if (!existing) return { ok: false, error: '商品画像が見つかりません。' };
    const parsed = optionImageSchema.safeParse({
      id: imageId,
      option_id: optionId,
      url: existing.url,
      alt: String(formData.get('alt') ?? '').trim() || option.name,
      caption: nullableId(formData.get('caption')),
      sort_order: formData.get('sort_order') || 0,
    });
    if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
    await store.upsertOptionImage(parsed.data);
    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: 'サブ画像の表示設定を更新しました。' };
  } catch (e) {
    return errState(e);
  }
}

export async function deleteOptionImageAction(formData: FormData): Promise<void> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  const imageId = String(formData.get('id') ?? '').trim();
  if (!optionId || !imageId) throw new StoreError('VALIDATION', '商品画像が指定されていません。');

  const { store, option } = await editableOptionContext(actor, optionId);
  const existing = option.gallery_images?.find((row) => row.id === imageId);
  if (!existing) throw new StoreError('NOT_FOUND', '商品画像が見つかりません。');

  const deleted = await store.deleteOptionImage(imageId);
  if (deleted) {
    try {
      await store.deleteUploadedOptionImage(deleted.url, optionId);
    } catch (error) {
      console.warn('[wing] option image storage cleanup failed', error);
    }
  }
  revalidatePath(`/admin/options/${optionId}`);
  updateTag(CATALOG_TAG);
}

export async function uploadOptionManufacturerDocumentAction(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) return { ok: false, error: '商品が指定されていません。' };

  let uploadedUrl: string | null = null;
  try {
    const { store, option } = await editableOptionContext(actor, optionId);
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, fieldErrors: { file: ['メーカー資料PDFを選択してください。'] } };
    }
    const isPdfName = file.name.toLowerCase().endsWith('.pdf');
    const isPdfType = !file.type || file.type === 'application/pdf';
    if (!isPdfName || !isPdfType) {
      return { ok: false, fieldErrors: { file: ['PDFファイルのみアップロードできます。'] } };
    }
    if (file.size > MAX_PRODUCT_DOCUMENT_BYTES) {
      return { ok: false, fieldErrors: { file: ['メーカー資料PDFは 20MB 以下にしてください。'] } };
    }

    uploadedUrl = await store.uploadProductDocument(
      { bytes: new Uint8Array(await file.arrayBuffer()), contentType: 'application/pdf', fileName: file.name },
      optionId
    );
    await store.setOptionManufacturerDocument(optionId, uploadedUrl);

    if (option.manufacturer_document_url && option.manufacturer_document_url !== uploadedUrl) {
      try {
        await store.deleteUploadedProductDocument(option.manufacturer_document_url, optionId);
      } catch (error) {
        console.warn('[wing] old product document cleanup failed', error);
      }
    }

    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: 'メーカー資料PDFを登録しました。' };
  } catch (e) {
    if (uploadedUrl) {
      try {
        const store = await getStore();
        await store.deleteUploadedProductDocument(uploadedUrl, optionId);
      } catch {
        // 元のエラーを優先する
      }
    }
    return errState(e);
  }
}

export async function deleteOptionManufacturerDocumentAction(formData: FormData): Promise<void> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) throw new StoreError('VALIDATION', '商品が指定されていません。');

  const { store, option } = await editableOptionContext(actor, optionId);
  const currentUrl = option.manufacturer_document_url ?? null;
  await store.setOptionManufacturerDocument(optionId, null);
  if (currentUrl) {
    try {
      await store.deleteUploadedProductDocument(currentUrl, optionId);
    } catch (error) {
      console.warn('[wing] product document storage cleanup failed', error);
    }
  }
  revalidatePath(`/admin/options/${optionId}`);
  updateTag(CATALOG_TAG);
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
  const id = nullableId(formData.get('id'));
  const store = await getStore();

  // 既存ルールの編集では、保存済みデータを基準に本体専用条件を保護する。
  let existingRule: PreviewImageRule | null = null;
  if (id) {
    const models = await store.listModels({ includeDraft: true });
    for (const model of models) {
      const bundle = await store.getCatalogBundle(model.id, { includeDraft: true });
      const found = bundle?.previewRules.find((rule) => rule.id === id);
      if (found) {
        existingRule = found;
        break;
      }
    }
  }

  let protectedFields = enforceDedicatedBaseFloorplanFields(
    existingRule,
    {
      base_model_id: String(formData.get('base_model_id') ?? ''),
      view: String(formData.get('view') ?? ''),
      kind: String(formData.get('kind') ?? ''),
      preview_keys: [...new Set(formData.getAll('preview_keys').map(String).filter(Boolean))].sort(),
      note: String(formData.get('note') ?? '').trim() || null,
    },
    formData.get('internal_note') === BASE_FLOORPLAN_NOTE
  );
  const presetCode = String(formData.get('preset_code') ?? '').trim();
  protectedFields = enforcePresetFloorplanFields(
    existingRule,
    protectedFields,
    /^[a-z0-9-]+$/.test(presetCode) ? presetCode : null
  );

  let url: string;
  try {
    url = await resolveImageUrl(formData, 'preview');
  } catch (e) {
    return errState(e);
  }
  const parsed = previewRuleSchema.safeParse({
    id,
    ...protectedFields,
    url,
    alt: formData.get('alt'),
    z_index: formData.get('z_index') || 0,
    status: formData.get('status') || 'published',
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
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

  const requestedBack = String(formData.get('redirect_to') ?? '').trim();
  const back =
    requestedBack.startsWith('/admin/preview-rules') || requestedBack.startsWith('/admin/models/')
      ? requestedBack
      : '/admin/preview-rules';
  redirect(`${back}${back.includes('?') ? '&' : '?'}deleted=1`);
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
  // 商品台帳など、開いていた画面へ戻れるようにする
  const back = String(formData.get('redirect_to') ?? '').trim() || `/admin/models/${String(formData.get('base_model_id') ?? '')}`;
  redirect(`${back}${back.includes('?') ? '&' : '?'}image_deleted=1`);
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
      source_item_id: formData.get(`items.${i}.source_item_id`),
      kind: value,
      name: formData.get(`items.${i}.name`),
      description: formData.get(`items.${i}.description`),
      unit: formData.get(`items.${i}.unit`),
      remark: formData.get(`items.${i}.remark`),
      unit_price: formData.get(`items.${i}.unit_price`) || 0,
      quantity: formData.get(`items.${i}.quantity`) || 1,
      image_url: formData.get(`items.${i}.image_url`) ?? '',
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
  redirect(`/admin/quotes?case=${encodeURIComponent(newId)}&tab=estimate&revised=1#case-workspace`);
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

const MAX_SHEET_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_METADATA_BYTES = 512 * 1024;
const IMAGE_NAME_RE = /\.(jpe?g|png|webp|avif)$/i;

interface ImportImageMetadata { name: string; path?: string; url?: string }

function parseImportImages(value: FormDataEntryValue | null): ImportImageMetadata[] {
  if (typeof value !== 'string' || !value) return [];
  if (Buffer.byteLength(value, 'utf8') > MAX_IMAGE_METADATA_BYTES) throw new StoreError('VALIDATION', '画像情報が大きすぎます。');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new StoreError('VALIDATION', '画像情報の形式が正しくありません。'); }
  if (!Array.isArray(parsed) || parsed.length > 5000) throw new StoreError('VALIDATION', '画像情報の件数が正しくありません。');
  return parsed.map((item) => {
    if (!item || typeof item !== 'object') throw new StoreError('VALIDATION', '画像情報の形式が正しくありません。');
    const name = String((item as { name?: unknown }).name ?? '');
    const path = (item as { path?: unknown }).path;
    const url = (item as { url?: unknown }).url;
    if (!name || name.length > 255 || !IMAGE_NAME_RE.test(name)) throw new StoreError('VALIDATION', '画像ファイル名が正しくありません。');
    return { name, path: typeof path === 'string' ? path : undefined, url: typeof url === 'string' ? url : undefined };
  });
}

/**
 * Excel（または CSV）と画像 ZIP を受け取り、商品と選択項目をまとめて登録する。
 * 「確認する」で内容を見せ、「登録する」で実際に書き込む。
 */
export async function importCatalogAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const actor = await requireCatalogEditor();
  const apply = formData.get('mode') === 'apply';

  const sheetFile = formData.get('sheet');
  if (!(sheetFile instanceof File) || sheetFile.size === 0) {
    return { ok: false, error: '商品マスターのファイルを選んでください。' };
  }
  if (sheetFile.size > MAX_SHEET_BYTES) return { ok: false, error: 'Excel / CSV が大きすぎます（3MB まで）。' };

  const { readCsv, readXlsx } = await import('@/lib/import/archive');
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

  // ZIP 本体は Vercel を通さない。ブラウザが列挙／直接 upload した小さい metadata だけを検証する。
  const images = new Map<string, string>();
  const uploadedUrls: string[] = [];
  let metadata: ImportImageMetadata[];
  try { metadata = parseImportImages(formData.get('imageMetadata')); }
  catch (e) { return errState(e) as ImportState; }
  const duplicateNames = metadata.map((item) => item.name).filter((name, i, all) => all.indexOf(name) !== i);
  if (duplicateNames.length) return { ok: false, error: `ZIP 内に同名画像があります: ${[...new Set(duplicateNames)].join('、')}` };
  for (const item of metadata) {
    if (!apply) { images.set(item.name, ''); continue; }
    if (isLocalMode()) {
      const storagePath = catalogImportPathFromImageUrl(item.url);
      if (!item.url || !storagePath || !isCatalogImportPathForUser(storagePath, actor.id)) {
        return { ok: false, error: 'ローカル画像の保存先が正しくありません。' };
      }
      images.set(item.name, item.url);
      uploadedUrls.push(item.url);
      continue;
    }
    if (!item.path || !isCatalogImportPathForUser(item.path, actor.id) || item.path.includes('..')) {
      return { ok: false, error: 'アップロード済み画像の保存先が正しくありません。' };
    }
    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${item.path.split('/').map(encodeURIComponent).join('/')}`;
    images.set(item.name, publicUrl);
    uploadedUrls.push(publicUrl);
  }

  const s = summarize(plan);

  if (!apply) {
    const groupsOf = (code: string) => [...new Set(plan.choices.filter((c) => c.productCode === code).map((c) => c.groupName))];
    return {
      ok: true,
      preview: {
        fileName: sheetFile.name,
        ...s,
        imagesUploaded: metadata.length,
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
    applied = await applyImportPlan(plan, images, { catalogImportUserId: actor.id });
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


/* ---------------- スタッフの新規見積作成 ---------------- */

/**
 * スタッフ（代理店以上）が管理画面から直接見積を作る。
 * 選んだ仕様の標準構成で保存 → 第1版（概算見積）を発行し、編集画面へ移動する。
 * 代理店・総代理店が作った見積は自動的に自分が担当になる（DB 側でも同じ判定）。
 */
export async function createManualQuoteAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await requireStaff();
  const parsed = manualQuoteSchema.safeParse({
    customer_name: formData.get('customer_name'),
    customer_company: formData.get('customer_company'),
    base_model_id: formData.get('base_model_id'),
    spec_code: formData.get('spec_code'),
    finish_level: formData.get('finish_level'),
    memo: formData.get('memo'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  let quoteId: string | null = null;
  try {
    const store = await getStore();
    const bundle = await store.getCatalogBundle(parsed.data.base_model_id);
    if (!bundle) return { ok: false, error: 'モデルが見つかりません。' };
    const preset = bundle.model.presets?.find((x) => x.code === parsed.data.spec_code) ?? bundle.model.presets?.[0];
    if (!preset) return { ok: false, error: 'このモデルには仕様（プラン）が登録されていません。' };
    const ctx = {
      options: bundle.options,
      categories: bundle.categories,
      dependencies: bundle.dependencies,
      conflicts: bundle.conflicts,
    };
    const optionIds = pruneToScope(ctx, buildPresetSelection(ctx, preset), parsed.data.finish_level);
    const cfg = await store.saveConfiguration(actor, {
      id: null,
      base_model_id: bundle.model.id,
      name: `${parsed.data.customer_name} 様向け（${preset.name}）`,
      option_ids: optionIds,
      preview_image_url: null,
      notes: parsed.data.memo,
      finish_level: parsed.data.finish_level,
      spec_code: preset.code,
      variant_choice_ids: defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, optionIds),
    });
    const quote = await store.createQuoteFromConfiguration(
      actor,
      cfg.id,
      {
        full_name: parsed.data.customer_name,
        company_name: parsed.data.customer_company,
        email: actor.email,
        phone: '',
        address: '',
        site_address: null,
      },
      parsed.data.memo
    );
    quoteId = quote.id;
    await flushNotificationsSafely();
    revalidatePath('/admin/quotes');
    revalidatePath('/mypage');
  } catch (e) {
    return errState(e);
  }
  redirect(`/admin/quotes/${quoteId}?created=1`);
}

/* ---------------- 標準見積テンプレート ---------------- */

export interface EstimateTemplateImportState {
  ok: boolean;
  error?: string;
  preview?: {
    fileName: string;
    sha256: string;
    ignoredSheets: string[];
    templates: {
      modelSlug: string;
      specCode: string;
      name: string;
      sheetName: string;
      base: number;
      interiorExterior: number;
      option: number;
      sitework: number;
      subtotal: number;
      adjustment: number;
      tax: number;
      total: number;
    }[];
  };
  applied?: { templates: number; names: string[] };
}

const MAX_ESTIMATE_TEMPLATE_BYTES = 8 * 1024 * 1024;

/**
 * 実物の分類表見積Excelを解析・検算し、標準見積として一括登録する。
 * preset / options.price は参照しない。標準見積の価格源はExcelだけに限定する。
 * base 明細は base_breakdown_items、残り3分類は estimate_template_lines に保存する。
 */
export async function importEstimateTemplatesAction(
  _prev: EstimateTemplateImportState,
  formData: FormData
): Promise<EstimateTemplateImportState> {
  await requireCatalogEditor();
  const apply = formData.get('mode') === 'apply';
  const file = formData.get('sheet');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: '分類表見積Excelを選んでください。' };
  }
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: '標準見積は .xlsx ファイルから取り込んでください。' };
  if (file.size > MAX_ESTIMATE_TEMPLATE_BYTES) return { ok: false, error: 'Excel が大きすぎます（8MB まで）。' };

  let parsed;
  let sha256 = '';
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sha256 = createHash('sha256').update(buffer).digest('hex');
    const { readXlsx } = await import('@/lib/import/archive');
    const { parseStandardEstimateWorkbook } = await import('@/lib/import/estimate-template-import');
    parsed = parseStandardEstimateWorkbook(readXlsx(buffer));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '標準見積Excelを読み取れませんでした。' };
  }

  const store = await getStore();
  const models = await store.listModels({ includeDraft: true });
  const bySlug = new Map(models.map((model) => [model.slug, model]));
  const bundleCache = new Map<string, Awaited<ReturnType<typeof store.getCatalogBundle>>>();
  const inputs: EstimateTemplateImportInput[] = [];
  for (const template of parsed.templates) {
    const model = bySlug.get(template.model_slug);
    if (!model) return { ok: false, error: `本体モデル「${template.model_slug}」が登録されていません。` };
    let bundle = bundleCache.get(model.id);
    if (bundle === undefined) {
      bundle = await store.getCatalogBundle(model.id, { includeDraft: true });
      bundleCache.set(model.id, bundle);
    }
    if (!bundle) return { ok: false, error: `本体モデル「${template.model_slug}」の商品マスターを読み込めません。` };

    const baselineCodes = estimateBaselineOptionCodes(model, template.spec_code);
    const optionByCode = new Map(bundle.options.map((option) => [option.code, option.id]));
    const missingBaselineCodes = baselineCodes.filter((code) => !optionByCode.has(code));
    if (missingBaselineCodes.length) {
      return {
        ok: false,
        error: `${template.name}: 標準商品の紐付けが不足しています（${missingBaselineCodes.join('、')}）。商品マスターを確認してください。`,
      };
    }
    const baselineOptionIds = baselineCodes.map((code) => optionByCode.get(code)!).filter(Boolean);

    inputs.push({
      base_model_id: model.id,
      spec_code: template.spec_code,
      name: template.name,
      source_file_name: file.name,
      source_sheet_name: template.source_sheet_name,
      source_sha256: sha256,
      tax_rate: template.tax_rate,
      subtotal_raw: template.subtotal_raw,
      adjustment: template.adjustment,
      subtotal: template.subtotal,
      tax: template.tax,
      total: template.total,
      sections: template.sections,
      base_breakdown_items: template.base_breakdown_items,
      lines: template.lines,
      baseline_option_ids: baselineOptionIds,
    });
  }

  const preview = {
    fileName: file.name,
    sha256,
    ignoredSheets: parsed.ignoredSheets,
    templates: parsed.templates.map((template) => {
      const section = new Map(template.sections.map((row) => [row.code, row.total]));
      return {
        modelSlug: template.model_slug,
        specCode: template.spec_code,
        name: template.name,
        sheetName: template.source_sheet_name,
        base: section.get('base') ?? 0,
        interiorExterior: section.get('interior_exterior') ?? 0,
        option: section.get('option') ?? 0,
        sitework: section.get('sitework') ?? 0,
        subtotal: template.subtotal,
        adjustment: template.adjustment,
        tax: template.tax,
        total: template.total,
      };
    }),
  };

  if (!apply) return { ok: true, preview };

  try {
    await store.replaceEstimateTemplates(inputs);
    revalidatePath('/admin/base-breakdown');
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, preview, applied: { templates: inputs.length, names: inputs.map((row) => row.name) } };
  } catch (e) {
    const failed = errState(e);
    return { ok: false, error: failed.error, preview };
  }
}

/* ---------------- 本体内訳マスター ---------------- */

/** 本体内訳マスター（分類表見積書）を丸ごと保存する（総代理店以上） */
export async function saveBaseBreakdownAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();
  const rows: unknown[] = [];
  for (const [key] of formData.entries()) {
    const m = key.match(/^items\.(\d+)\.name$/);
    if (!m) continue;
    const i = m[1];
    rows.push({
      section: formData.get(`items.${i}.section`),
      name: formData.get(`items.${i}.name`),
      quantity: formData.get(`items.${i}.quantity`) || 1,
      unit: formData.get(`items.${i}.unit`),
      unit_price: formData.get(`items.${i}.unit_price`) || 0,
      remark: formData.get(`items.${i}.remark`),
    });
  }
  const parsed = baseBreakdownSchema.safeParse({
    base_model_id: formData.get('base_model_id'),
    spec_code: formData.get('spec_code'),
    items: rows,
  });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    const locked = (await store.listEstimateTemplates(parsed.data.base_model_id)).some(
      (row) => row.spec_code === parsed.data.spec_code
    );
    if (locked) {
      return {
        ok: false,
        error: 'Excel取込済みの標準見積です。本体明細を直接変更せず、Excelを修正して再取込してください。',
      };
    }
    const saved = await store.saveBaseBreakdownItems(parsed.data.base_model_id, parsed.data.spec_code, parsed.data.items);
    revalidatePath('/admin/base-breakdown');
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    const total = saved.reduce((sum, b) => sum + b.amount, 0);
    return { ok: true, message: `保存しました（${saved.length}行・本体一式 ¥${total.toLocaleString('ja-JP')}）` };
  } catch (e) {
    return errState(e);
  }
}


/** 本体内訳マスターの一括管理表：オプション価格の一括保存（総代理店以上） */
export async function bulkUpdateOptionPricesAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  await requireCatalogEditor();
  const rows: { id: string; price: FormDataEntryValue }[] = [];
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^prices\.([0-9a-f-]{36})$/);
    if (m) rows.push({ id: m[1], price: value });
  }
  const parsed = optionPricesSchema.safeParse({ items: rows });
  if (!parsed.success) return { ok: false, fieldErrors: flattenErrors(parsed.error) };
  try {
    const store = await getStore();
    await store.updateOptionPrices(parsed.data.items);
    revalidatePath('/admin/base-breakdown');
    revalidatePath('/', 'layout');
    updateTag(CATALOG_TAG);
    return { ok: true, message: `価格を保存しました（${parsed.data.items.length} 件）。新しい見積から反映されます` };
  } catch (e) {
    return errState(e);
  }
}
