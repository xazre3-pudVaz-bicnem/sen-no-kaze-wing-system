import type { OptionImage, ProductOption } from '@/lib/domain/types';

/**
 * 登録済み商品の追加画像・メーカー資料PDFの変更（PR #563 の正式保存。2026-11-04 の先方回答 C-4）。
 * STEP 1 の編集案はブラウザに持ち、STEP 2 の「この変更を反映」で、新しいファイルを Storage の商品のフォルダーへ置いてから、
 * DB の apply_option_media_changes（20261105110000）で 1 回にまとめて反映する。決まりは DB と同じにする
 */

/** 追加画像は 1 商品 30 枚まで（DB と同じ） */
export const OPTION_GALLERY_MAX = 30;
/** 追加画像の説明・表示順の範囲（DB と同じ） */
export const OPTION_GALLERY_CAPTION_MAX = 200;
export const OPTION_GALLERY_SORT_MAX = 100_000;
export const OPTION_GALLERY_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
/** Storage のバケットの上限と同じ（product-images 10MB・product-documents 20MB） */
export const OPTION_GALLERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const OPTION_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
/**
 * サーバーアクションで送れるファイルの大きさ（next.config の bodySizeLimit 4MB から、フォームの余白を引いた値）。
 * これを超えるファイルは、ブラウザから Storage へ直接置く（署名付きアップロード。置き場所はサーバーが決める）
 */
export const SERVER_ACTION_UPLOAD_MAX_BYTES = 3.5 * 1024 * 1024;

/** 画面を開いた時点の状態（DB は今の状態と照合し、違えば反映しない） */
export interface OptionMediaExpected {
  gallery: { id: string; url: string; caption: string | null; sort_order: number }[];
  manufacturer_document_url: string | null;
}

export type OptionDocumentChange = { action: 'keep' } | { action: 'remove' } | { action: 'replace'; url: string };

export interface OptionMediaChanges {
  delete: string[];
  update: { id: string; caption: string | null; sort_order: number }[];
  add: { url: string; caption: string | null; sort_order: number; alt: string | null }[];
  document: OptionDocumentChange;
}

export interface OptionMediaChangeResult {
  gallery: OptionImage[];
  manufacturer_document_url: string | null;
  /** 反映で参照されなくなったファイル（ほかの行が使っていないものだけ）。アプリが反映の成功後に消す */
  unreferenced_urls: string[];
}

/** STEP 1 の追加画像の編集案（説明・表示順は入力のままの文字列） */
export interface GalleryEdit {
  removed: boolean;
  caption: string;
  order: string;
}

export function optionMediaExpectedOf(option: Pick<ProductOption, 'gallery_images' | 'manufacturer_document_url'>): OptionMediaExpected {
  return {
    gallery: (option.gallery_images ?? []).map((image) => ({
      id: image.id,
      url: image.url,
      caption: image.caption ?? null,
      sort_order: image.sort_order,
    })),
    manufacturer_document_url: option.manufacturer_document_url ?? null,
  };
}

/**
 * 追加画像・メーカー資料の今の状態の短い印（反映した後に編集画面を作り直すための key に使う。
 * 追加画像だけを変えても商品の更新日時は変わらないため）
 */
export function optionMediaVersionOf(option: Pick<ProductOption, 'gallery_images' | 'manufacturer_document_url'>): string {
  const text = JSON.stringify(optionMediaExpectedOf(option));
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/** 追加画像の編集案から、削除と説明・表示順の変更を作る（変わっていない画像は含めない） */
export function galleryChangesOf(gallery: OptionImage[], edits: Record<string, GalleryEdit>): Pick<OptionMediaChanges, 'delete' | 'update'> {
  const changes: Pick<OptionMediaChanges, 'delete' | 'update'> = { delete: [], update: [] };
  for (const image of gallery) {
    const edit = edits[image.id];
    if (!edit) continue;
    if (edit.removed) {
      changes.delete.push(image.id);
      continue;
    }
    const caption = edit.caption.trim() || null;
    const sortOrder = Number(edit.order);
    if (caption !== ((image.caption ?? '').trim() || null) || sortOrder !== image.sort_order) {
      changes.update.push({ id: image.id, caption, sort_order: sortOrder });
    }
  }
  return changes;
}

export function hasOptionMediaChanges(changes: OptionMediaChanges): boolean {
  return changes.delete.length > 0 || changes.update.length > 0 || changes.add.length > 0 || changes.document.action !== 'keep';
}

/** 説明・表示順の入力の誤り（DB と同じ範囲） */
export function galleryEditError(edit: GalleryEdit): string | null {
  if (edit.removed) return null;
  if (!/^\d+$/.test(edit.order.trim()) || Number(edit.order) > OPTION_GALLERY_SORT_MAX) {
    return `追加画像の表示順は 0 以上 ${OPTION_GALLERY_SORT_MAX} 以下で入力してください。`;
  }
  if (edit.caption.trim().length > OPTION_GALLERY_CAPTION_MAX) return `追加画像の説明は ${OPTION_GALLERY_CAPTION_MAX} 文字以内で入力してください。`;
  return null;
}

/** 追加画像のファイルの誤り（サーバーでもう一度確かめる。Storage のバケットにも同じ上限がある） */
export function galleryImageFileError(file: { type: string; size: number }): string | null {
  if (!OPTION_GALLERY_IMAGE_TYPES.includes(file.type) || file.size === 0 || file.size > OPTION_GALLERY_IMAGE_MAX_BYTES) {
    return '追加画像は JPEG・PNG・WebP・AVIF、1 枚 10MB 以下を選んでください。';
  }
  return null;
}

/** メーカー資料のファイルの誤り（サーバーでもう一度確かめる） */
export function documentFileError(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type !== '' && file.type !== 'application/pdf') || file.size === 0 || file.size > OPTION_DOCUMENT_MAX_BYTES) {
    return 'メーカー資料PDFは 20MB 以下の PDF ファイルを選んでください。';
  }
  return null;
}
