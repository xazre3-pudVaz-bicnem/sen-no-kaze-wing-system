'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireStaff } from '@/lib/auth/session';
import { getStore, StoreError, type SessionUser } from '@/lib/data/store';
import { canEditCatalog, FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { fetchRemoteMedia } from '@/lib/http/remote-media';
import type { AdminFormState } from '@/lib/actions/admin';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PRODUCT_DOCUMENT_BYTES = 20 * 1024 * 1024;

function errorState(error: unknown): AdminFormState {
  if (error instanceof StoreError) return { ok: false, error: error.message };
  if (error instanceof Error && error.message) return { ok: false, error: error.message };
  return { ok: false, error: 'URLからの登録中にエラーが発生しました。' };
}

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

function sourceUrl(formData: FormData): string {
  return String(formData.get('source_url') ?? '').trim();
}

export async function addOptionImageFromUrlAction(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) return { ok: false, error: '商品が指定されていません。' };
  const url = sourceUrl(formData);
  if (!url) return { ok: false, fieldErrors: { source_url: ['画像URLを入力してください。'] } };

  let uploadedUrl: string | null = null;
  try {
    const { store, option } = await editableOptionContext(actor, optionId);
    const remote = await fetchRemoteMedia(url, 'image', MAX_IMAGE_BYTES);
    uploadedUrl = await store.uploadOptionImage(
      { bytes: remote.bytes, contentType: remote.contentType, fileName: remote.fileName },
      optionId
    );

    const requestedSort = Number(formData.get('sort_order'));
    const sortOrder = Number.isFinite(requestedSort) && requestedSort >= 0 ? Math.trunc(requestedSort) : 0;
    await store.upsertOptionImage({
      id: null,
      option_id: optionId,
      url: uploadedUrl,
      alt: `${option.name} 追加画像`,
      caption: null,
      sort_order: sortOrder,
    });

    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: '画像URLから追加画像を保存しました。' };
  } catch (error) {
    if (uploadedUrl) {
      try {
        const store = await getStore();
        await store.deleteUploadedOptionImage(uploadedUrl, optionId);
      } catch {
        // 登録失敗時の後片付けはベストエフォート。元のエラーを優先する。
      }
    }
    return errorState(error);
  }
}

export async function uploadOptionManufacturerDocumentFromUrlAction(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  if (!optionId) return { ok: false, error: '商品が指定されていません。' };
  const url = sourceUrl(formData);
  if (!url) return { ok: false, fieldErrors: { source_url: ['PDFのURLを入力してください。'] } };

  let uploadedUrl: string | null = null;
  try {
    const { store, option } = await editableOptionContext(actor, optionId);
    const remote = await fetchRemoteMedia(url, 'pdf', MAX_PRODUCT_DOCUMENT_BYTES);
    uploadedUrl = await store.uploadProductDocument(
      { bytes: remote.bytes, contentType: remote.contentType, fileName: remote.fileName },
      optionId
    );

    const previousUrl = option.manufacturer_document_url ?? null;
    try {
      await store.setOptionManufacturerDocument(optionId, uploadedUrl);
    } catch (error) {
      await store.deleteUploadedProductDocument(uploadedUrl, optionId).catch(() => undefined);
      uploadedUrl = null;
      throw error;
    }

    if (previousUrl && previousUrl !== uploadedUrl) {
      await store.deleteUploadedProductDocument(previousUrl, optionId).catch(() => undefined);
    }

    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: 'PDFのURLからメーカー資料を保存しました。' };
  } catch (error) {
    if (uploadedUrl) {
      try {
        const store = await getStore();
        await store.deleteUploadedProductDocument(uploadedUrl, optionId);
      } catch {
        // 登録失敗時の後片付けはベストエフォート。元のエラーを優先する。
      }
    }
    return errorState(error);
  }
}
