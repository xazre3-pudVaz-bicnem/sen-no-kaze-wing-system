const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OptionMediaKind = 'gallery' | 'manufacturer';

function assertOptionId(optionId: string) {
  if (!UUID_RE.test(optionId)) throw new Error('商品IDが正しくありません。');
}

export function optionMediaPrefix(optionId: string, kind: OptionMediaKind): string {
  assertOptionId(optionId);
  return `option-${optionId}/${kind}/`;
}

function assertSafeObjectPath(path: string) {
  if (!path || path.includes('\\')) throw new Error('Storage pathが正しくありません。');
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Storage pathが正しくありません。');
  }
}

export function assertOwnedPublicStoragePath(
  url: string,
  bucket: 'product-images' | 'product-documents',
  optionId: string,
  kind: OptionMediaKind
): string {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) throw new Error('Storage URLが正しくありません。');

  const encodedPath = url.slice(at + marker.length).split(/[?#]/, 1)[0] ?? '';
  let storagePath: string;
  try {
    storagePath = encodedPath
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    throw new Error('Storage URLが正しくありません。');
  }

  assertSafeObjectPath(storagePath);
  const expectedPrefix = optionMediaPrefix(optionId, kind);
  if (!storagePath.startsWith(expectedPrefix)) {
    throw new Error('他の商品に属するStorage objectは削除できません。');
  }

  const fileName = storagePath.slice(expectedPrefix.length);
  if (!fileName || fileName.includes('/')) {
    throw new Error('Storage pathが正しくありません。');
  }
  return storagePath;
}

export function assertOwnedLocalMediaPath(url: string, optionId: string, kind: OptionMediaKind): string {
  const marker = '/api/local-files/';
  if (!url.startsWith(marker)) throw new Error('ローカル商品メディアURLが正しくありません。');

  let relative: string;
  try {
    relative = url
      .slice(marker.length)
      .split('/')
      .map((segment) => decodeURIComponent(segment))
      .join('/');
  } catch {
    throw new Error('ローカル商品メディアURLが正しくありません。');
  }

  assertSafeObjectPath(relative);
  const expectedPrefix = optionMediaPrefix(optionId, kind);
  if (!relative.startsWith(expectedPrefix)) {
    throw new Error('他の商品に属するローカルメディアは削除できません。');
  }

  const fileName = relative.slice(expectedPrefix.length);
  if (!fileName || fileName.includes('/')) {
    throw new Error('ローカル商品メディアpathが正しくありません。');
  }
  return relative;
}
