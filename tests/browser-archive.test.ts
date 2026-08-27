import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  duplicateBasenames,
  extractZipEntry,
  imageEntries,
  listZipEntries,
  MAX_IMAGE_BYTES,
  validateImageEntries,
} from '@/lib/import/browser-archive';

function zip(entries: { name: string; data: Uint8Array; method: 0 | 8 }[]): ArrayBuffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const compressed = entry.method === 8 ? zlib.deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(entry.method, 10);
    directory.writeUInt32LE(compressed.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...local, directory, eocd]);
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
}

describe('ブラウザ画像 ZIP', () => {
  it('ZIP一覧から画像だけを取得する', () => {
    const entries = listZipEntries(zip([
      { name: 'folder/photo.png', data: new Uint8Array([1]), method: 0 },
      { name: 'memo.txt', data: new Uint8Array([2]), method: 0 },
    ]));
    expect(entries.map((entry) => entry.name)).toEqual(['folder/photo.png', 'memo.txt']);
    expect(imageEntries(entries).map((entry) => entry.name)).toEqual(['folder/photo.png']);
  });

  it.each([0, 8] as const)('圧縮方式 %i の画像を展開する', async (method) => {
    const source = new TextEncoder().encode('wing-image-data');
    const buffer = zip([{ name: 'photo.png', data: source, method }]);
    await expect(extractZipEntry(buffer, listZipEntries(buffer)[0])).resolves.toEqual(source);
  });

  it('壊れたZIPと不正なoffsetを拒否する', async () => {
    expect(() => listZipEntries(new Uint8Array([1, 2, 3]).buffer)).toThrow('ZIP ファイルを読み取れませんでした');
    const buffer = zip([{ name: 'photo.png', data: new Uint8Array([1]), method: 0 }]);
    const entry = { ...listZipEntries(buffer)[0], offset: buffer.byteLength };
    await expect(extractZipEntry(buffer, entry)).rejects.toThrow('位置が不正です');
  });

  it('header上で10MBを超える画像を展開前に拒否する', () => {
    expect(() => validateImageEntries([{
      name: 'huge.png', size: MAX_IMAGE_BYTES + 1, compressedSize: 1, method: 8, offset: 0,
    }])).toThrow('10MB を超えています');
  });

  it('異なるフォルダの同名画像を曖昧なまま採用しない', () => {
    expect(duplicateBasenames([{ name: 'a/test.png' }, { name: 'b/test.png' }])).toEqual(['test.png']);
  });
});
