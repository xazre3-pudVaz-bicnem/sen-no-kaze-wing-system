'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { requireStaff } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { StoreError, type DataStore } from '@/lib/data/store';
import { editableOptionContext } from '@/lib/actions/option-media-access';
import {
  documentFileError,
  galleryImageFileError,
  OPTION_GALLERY_CAPTION_MAX,
  OPTION_GALLERY_MAX,
  OPTION_GALLERY_SORT_MAX,
  type OptionMediaChanges,
} from '@/lib/domain/option-media-changes';

/**
 * 登録済み商品の追加画像・メーカー資料PDFの正式保存（PR #563。2026-11-04 の先方回答 C-4）。
 * 1. 新しいファイルを商品のフォルダーへ置く（3.5MB まではこのサーバーアクション、超えるものは署名付きアップロード）
 * 2. applyOptionMediaChangesAction で 1 回にまとめて反映する（DB の apply_option_media_changes。行ロック・開いた時点の状態の照合・履歴）
 * 3. 反映に失敗したら置いたファイルを消し、成功したら参照されなくなったファイルを消す（それ以外の未参照のファイルは消さない）
 */

export interface OptionMediaActionState {
  ok: boolean;
  error?: string;
  message?: string;
  url?: string;
}

function failure(e: unknown): OptionMediaActionState {
  if (e instanceof StoreError) return { ok: false, error: e.message };
  console.error('[wing] option media action error', e);
  return { ok: false, error: '処理中にエラーが発生しました。' };
}

/** 新しいファイルを商品のフォルダーへ置く（3.5MB まで。紐付けは applyOptionMediaChangesAction で行う） */
export async function uploadStagedOptionMediaAction(formData: FormData): Promise<OptionMediaActionState> {
  const actor = await requireStaff();
  const optionId = String(formData.get('option_id') ?? '').trim();
  const kind = formData.get('kind') === 'manufacturer' ? 'manufacturer' : 'gallery';
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'ファイルを選択してください。' };
  const fileError = kind === 'gallery' ? galleryImageFileError(file) : documentFileError(file);
  if (fileError) return { ok: false, error: fileError };
  try {
    const { store } = await editableOptionContext(actor, optionId);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const url =
      kind === 'gallery'
        ? await store.uploadOptionImage({ bytes, contentType: file.type, fileName: file.name }, optionId)
        : await store.uploadProductDocument({ bytes, contentType: 'application/pdf', fileName: file.name }, optionId);
    return { ok: true, url };
  } catch (e) {
    return failure(e);
  }
}

const signedUploadSchema = z.object({
  optionId: z.uuid(),
  kind: z.enum(['gallery', 'manufacturer']),
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

export type OptionMediaSignedUpload =
  | { ok: true; bucket: string; path: string; token: string; url: string }
  | { ok: false; error: string };

/** 3.5MB を超えるファイルは、ブラウザから商品のフォルダーへ直接置く（置き場所はサーバーが決める。ローカル検証モードでは使えない） */
export async function createOptionMediaSignedUploadAction(input: z.input<typeof signedUploadSchema>): Promise<OptionMediaSignedUpload> {
  const actor = await requireStaff();
  const parsed = signedUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'ファイルの指定が正しくありません。' };
  const { optionId, kind, fileName, contentType, size } = parsed.data;
  const fileError =
    kind === 'gallery' ? galleryImageFileError({ type: contentType, size }) : documentFileError({ name: fileName, type: contentType, size });
  if (fileError) return { ok: false, error: fileError };
  try {
    const { store } = await editableOptionContext(actor, optionId);
    const target = await store.createOptionMediaSignedUpload(optionId, kind, fileName);
    if (!target) return { ok: false, error: 'この環境では 3.5MB を超えるファイルを送れません。' };
    return { ok: true, ...target };
  } catch (e) {
    return { ok: false, error: failure(e).error ?? '処理中にエラーが発生しました。' };
  }
}

const caption = z.string().max(OPTION_GALLERY_CAPTION_MAX).nullable();
const sortOrder = z.number().int().min(0).max(OPTION_GALLERY_SORT_MAX);
const applySchema = z.object({
  optionId: z.uuid(),
  expected: z.object({
    gallery: z.array(z.object({ id: z.uuid(), url: z.string().max(1000), caption: z.string().nullable(), sort_order: z.number().int().min(0) })).max(500),
    manufacturer_document_url: z.string().max(1000).nullable(),
  }),
  changes: z.object({
    delete: z.array(z.uuid()).max(500),
    update: z.array(z.object({ id: z.uuid(), caption, sort_order: sortOrder })).max(500),
    add: z.array(z.object({ url: z.string().min(1).max(1000), caption, sort_order: sortOrder, alt: z.string().max(200).nullable() })).max(OPTION_GALLERY_MAX),
    document: z.discriminatedUnion('action', [
      z.object({ action: z.literal('keep') }),
      z.object({ action: z.literal('remove') }),
      z.object({ action: z.literal('replace'), url: z.string().min(1).max(1000) }),
    ]),
  }),
});

/** 変更をまとめて反映する。失敗したら、このとき置いたファイル（まだどこからも参照されていないもの）を消す */
export async function applyOptionMediaChangesAction(input: z.input<typeof applySchema>): Promise<OptionMediaActionState> {
  const actor = await requireStaff();
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: '追加画像・メーカー資料の変更の内容が正しくありません。' };
  const { optionId, expected, changes } = parsed.data;
  let store: DataStore | null = null;
  try {
    ({ store } = await editableOptionContext(actor, optionId));
    const result = await store.applyOptionMediaChanges(actor, optionId, expected, changes);
    await removeOptionMediaFiles(store, optionId, result.unreferenced_urls);
    revalidatePath(`/admin/options/${optionId}`);
    updateTag(CATALOG_TAG);
    return { ok: true, message: '追加画像・メーカー資料を反映しました。' };
  } catch (e) {
    if (store) await discardStaged(store, optionId, stagedUrlsOf(changes));
    return failure(e);
  }
}

const discardSchema = z.object({ optionId: z.uuid(), urls: z.array(z.string().max(1000)).max(OPTION_GALLERY_MAX + 1) });

/** アップロードの途中で止めたときに、紐付ける前のファイルを消す */
export async function discardStagedOptionMediaAction(input: z.input<typeof discardSchema>): Promise<void> {
  const actor = await requireStaff();
  const parsed = discardSchema.safeParse(input);
  if (!parsed.success || parsed.data.urls.length === 0) return;
  try {
    const { store } = await editableOptionContext(actor, parsed.data.optionId);
    await discardStaged(store, parsed.data.optionId, parsed.data.urls);
  } catch (error) {
    console.warn('[wing] staged option media cleanup failed', error);
  }
}

function stagedUrlsOf(changes: OptionMediaChanges): string[] {
  return [...changes.add.map((item) => item.url), ...(changes.document.action === 'replace' ? [changes.document.url] : [])];
}

/** 紐付ける前のファイルだけを消す（今その商品が参照しているファイルは、送られてきても消さない） */
async function discardStaged(store: DataStore, optionId: string, urls: string[]) {
  if (urls.length === 0) return;
  const option = await store.getOption(optionId);
  const referenced = new Set(
    [...(option?.gallery_images ?? []).map((image) => image.url), option?.manufacturer_document_url, option?.image_url].filter(
      (url): url is string => Boolean(url)
    )
  );
  await removeOptionMediaFiles(
    store,
    optionId,
    urls.filter((url) => !referenced.has(url))
  );
}

/** ファイルを消す（置き場所が商品のフォルダーでなければストアが拒否する）。失敗しても反映の結果は変えない */
async function removeOptionMediaFiles(store: DataStore, optionId: string, urls: string[]) {
  for (const url of urls) {
    try {
      if (url.includes(`option-${optionId}/manufacturer/`)) await store.deleteUploadedProductDocument(url, optionId);
      else await store.deleteUploadedOptionImage(url, optionId);
    } catch (error) {
      console.warn('[wing] option media cleanup failed', error);
    }
  }
}
