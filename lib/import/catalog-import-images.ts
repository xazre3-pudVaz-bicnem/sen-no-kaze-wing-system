const SUPABASE_PRODUCT_IMAGES_MARKER = '/storage/v1/object/public/product-images/';
const LOCAL_PRODUCT_IMAGES_PREFIX = '/api/local-files/';
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function catalogImportPathFromImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string | null = null;
  const supabaseAt = url.indexOf(SUPABASE_PRODUCT_IMAGES_MARKER);
  if (supabaseAt >= 0) path = decodePath(url.slice(supabaseAt + SUPABASE_PRODUCT_IMAGES_MARKER.length));
  else if (url.startsWith(LOCAL_PRODUCT_IMAGES_PREFIX)) path = decodePath(url.slice(LOCAL_PRODUCT_IMAGES_PREFIX.length));
  if (!path || !path.startsWith('catalog-import/') || path.includes('..')) return null;
  if (path.split('/').some((part) => !part)) return null;
  return path;
}

export function isCatalogImportSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

export function isCatalogImportPathForUser(storagePath: string, userId: string): boolean {
  const parts = storagePath.split('/');
  return (
    parts.length >= 4 &&
    parts[0] === 'catalog-import' &&
    parts[1] === userId &&
    isCatalogImportSessionId(parts[2])
  );
}

export function catalogImportPathsForUser(urls: Iterable<string | null | undefined>, userId: string): string[] {
  const paths = new Set<string>();
  for (const url of urls) {
    const storagePath = catalogImportPathFromImageUrl(url);
    if (storagePath && isCatalogImportPathForUser(storagePath, userId)) paths.add(storagePath);
  }
  return [...paths];
}

export function catalogImportUrlsForUser(urls: Iterable<string | null | undefined>, userId: string): string[] {
  const byPath = new Map<string, string>();
  for (const url of urls) {
    if (!url) continue;
    const storagePath = catalogImportPathFromImageUrl(url);
    if (storagePath && isCatalogImportPathForUser(storagePath, userId)) byPath.set(storagePath, url);
  }
  return [...byPath.values()];
}

export function safeCatalogImportFileName(fileName: string, fallback = 'image.jpg'): string {
  const base = fileName.split(/[\\/]/).pop() || fallback;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || fallback;
}

export function catalogImportUploadPath(userId: string, sessionId: string, index: number, fileName: string): string {
  const safeName = safeCatalogImportFileName(fileName);
  return `catalog-import/${userId}/${sessionId}/${String(index).padStart(4, '0')}-${safeName}`;
}

export function localCatalogImportUrl(storagePath: string): string {
  return `${LOCAL_PRODUCT_IMAGES_PREFIX}${storagePath.split('/').map(encodeURIComponent).join('/')}`;
}
