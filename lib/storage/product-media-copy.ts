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
