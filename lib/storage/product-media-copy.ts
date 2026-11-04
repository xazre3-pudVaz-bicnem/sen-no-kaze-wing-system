/**
 * 商品複製のための Storage URL 判定。
 * 外部 URL や別 project の URL は一切取得しない（SSRF / 誤削除防止）。
 */
export type ProductMediaCopySummary = {
  copiedMain: boolean;
  copiedGallery: number;
  copiedPdf: boolean;
  skipped: string[];
};

function safePath(encoded: string): string | null {
  try {
    const segments = encoded.split('/').map(decodeURIComponent);
    if (
      !segments.length ||
      segments.some((part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        part.includes('/') ||
        part.includes('\\') ||
        part.includes('%') ||
        /[\x00-\x1f]/.test(part)
      )
    ) return null;
    return segments.join('/');
  } catch {
    return null;
  }
}

/** publicUrlForProbe は同じ bucket の getPublicUrl('__clone_probe__') から取得する。 */
export function managedPublicObjectPath(url: string, publicUrlForProbe: string): string | null {
  // WHATWG URL は ../ や %2e%2e を正規化してしまうため、パース前に拒否する。
  if (/%(?:2e|2f|5c)/i.test(url) || url.includes('/../') || url.includes('/./') || url.endsWith('/..') || url.endsWith('/.')) return null;
  try {
    const source = new URL(url);
    const probe = new URL(publicUrlForProbe);
    const probeName = '__clone_probe__';
    if (!probe.pathname.endsWith(probeName) || source.origin !== probe.origin) return null;
    if (source.username || source.password || source.search || source.hash) return null;
    const prefix = probe.pathname.slice(0, -probeName.length);
    if (!source.pathname.startsWith(prefix)) return null;
    return safePath(source.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

export function managedLocalObjectPath(url: string): string | null {
  const prefix = '/api/local-files/';
  if (!url.startsWith(prefix) || url.includes('?') || url.includes('#')) return null;
  return safePath(url.slice(prefix.length));
}

/** 既存の画像・PDF以外のオブジェクトは勝手にコピーしない。 */
export function safeCloneExtension(storagePath: string, kind: 'image' | 'pdf'): string | null {
  const name = storagePath.split('/').at(-1) ?? '';
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (kind === 'pdf') return ext === 'pdf' ? 'pdf' : null;
  return ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'].includes(ext) ? ext : null;
}

/** 複製する追加画像の上限（超えた分は複製せず「複製できなかったメディア」に出す。登録側に上限は無い） */
export const MAX_CLONE_GALLERY_IMAGES = 30;

const KEEP_COPIED_DRAFT = Symbol.for('wing.keepCopiedDraft');

/** 複製の取り消し（DB）に失敗したとき：確認のため新しい下書きと複製したファイルを残す（呼び出し側は下書きを消さない） */
export function markKeepCopiedDraft<T extends Error>(error: T): T {
  return Object.assign(error, { [KEEP_COPIED_DRAFT]: true });
}

export function shouldKeepCopiedDraft(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[KEEP_COPIED_DRAFT] === true;
}
