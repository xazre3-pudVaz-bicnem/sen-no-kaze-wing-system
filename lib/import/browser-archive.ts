'use client';

export interface BrowserZipEntry {
  name: string;
  compressedSize: number;
  size: number;
  method: number;
  offset: number;
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 1000;
export const MAX_TOTAL_IMAGE_BYTES = 500 * 1024 * 1024;

const decoder = new TextDecoder();

/** ZIP の central directory だけを読み、画像を展開せずに一覧を返す。 */
export function listZipEntries(buffer: ArrayBuffer): BrowserZipEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP ファイルを読み取れませんでした。');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: BrowserZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP の目次が壊れています。');
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('ZIP の目次サイズが不正です。');
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    if (!name.endsWith('/')) entries.push({
      name,
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    });
    p = end;
  }
  return entries;
}

/** stored / deflate の単一エントリをブラウザ内で展開する。 */
export async function extractZipEntry(buffer: ArrayBuffer, entry: BrowserZipEntry): Promise<Uint8Array> {
  const view = new DataView(buffer);
  if (entry.offset < 0 || entry.offset + 30 > buffer.byteLength) throw new Error(`ZIP 内の「${entry.name}」の位置が不正です。`);
  if (view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error(`ZIP 内の「${entry.name}」を読み取れません。`);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  if (start > buffer.byteLength || entry.compressedSize < 0 || start + entry.compressedSize > buffer.byteLength) {
    throw new Error(`ZIP 内の「${entry.name}」の圧縮サイズが不正です。`);
  }
  const compressed = new Uint8Array(buffer, start, entry.compressedSize);
  if (entry.method === 0) return compressed.slice();
  if (entry.method !== 8) throw new Error(`ZIP の圧縮方式に対応していません: ${entry.name}`);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const imageEntries = (entries: BrowserZipEntry[]) => entries.filter((entry) => /\.(jpe?g|png|webp|avif)$/i.test(entry.name));

/** ZIP header の展開後サイズを使い、展開前にメモリ消費を制限する。 */
export function validateImageEntries(entries: BrowserZipEntry[]): void {
  if (entries.length > MAX_IMAGE_COUNT) throw new Error(`画像は ${MAX_IMAGE_COUNT} ファイルまでです。`);
  let total = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error(`画像「${entry.name}」の展開サイズが不正です。`);
    if (entry.size > MAX_IMAGE_BYTES) throw new Error(`画像「${entry.name}」は 10MB を超えています。`);
    total += entry.size;
    if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('画像の合計展開サイズは 500MB までです。');
  }
}

export function duplicateBasenames(entries: Pick<BrowserZipEntry, 'name'>[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const base = entry.name.split('/').pop() ?? entry.name;
    if (seen.has(base)) duplicates.add(base);
    seen.add(base);
  }
  return [...duplicates].sort();
}
