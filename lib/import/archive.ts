import zlib from 'node:zlib';

/**
 * ZIP と XLSX の最小リーダー。
 *
 * 先方から届くのは Excel（.xlsx）と画像の ZIP なので、CSV へ変換してもらわずに
 * そのまま取り込めるようにする。外部ライブラリを増やしたくないので自前で読む。
 * 対応するのは無圧縮（stored）と deflate だけ。実用上これで足りる。
 */

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** ZIP を展開する。ディレクトリと読めなかったエントリは除く */
export function unzip(buf: Buffer): ZipEntry[] {
  const out: ZipEntry[] = [];
  // セントラルディレクトリから読む（ローカルヘッダーはサイズが 0 のことがあるため）
  const eocd = findEocd(buf);
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + elen + clen;

    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(offset) !== 0x04034b50) continue;
    const lnlen = buf.readUInt16LE(offset + 26);
    const lelen = buf.readUInt16LE(offset + 28);
    const start = offset + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    try {
      out.push({ name, data: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw) });
    } catch {
      /* 壊れたエントリは飛ばす */
    }
  }
  return out;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** 列参照（"BC12"）を 0 始まりの列番号へ */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

/**
 * XLSX を読んでシートごとの二次元配列にする。
 * Excel / Google スプレッドシート / ライブラリ生成のいずれも読めるよう、
 * 名前空間つき（x:row 等）のタグにも対応する。
 */
export function readXlsx(buf: Buffer): Sheet[] {
  const files = new Map(unzip(buf).map((e) => [e.name, e.data]));
  const wb = files.get('xl/workbook.xml')?.toString('utf8');
  if (!wb) throw new Error('Excel ファイルとして読めませんでした（xl/workbook.xml がありません）');

  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) =>
    decodeXml([...m[1].matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((x) => x[1]).join(''))
  );

  const names = [...wb.matchAll(/<(?:\w+:)?sheet\s[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets: Sheet[] = [];

  for (let n = 1; n <= names.length; n++) {
    const xml = files.get(`xl/worksheets/sheet${n}.xml`)?.toString('utf8');
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
      const cells = [...r[1].matchAll(/<(?:\w+:)?c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)];
      const row: string[] = [];
      for (const c of cells) {
        const attrs = c[2] ?? '';
        const body = c[3] ?? '';
        const inline = body.match(/<(?:\w+:)?is>[\s\S]*?<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/)?.[1];
        const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        const value = inline != null ? decodeXml(inline) : v == null ? '' : /t="s"/.test(attrs) ? (shared[Number(v)] ?? '') : decodeXml(v);
        row[columnIndex(c[1])] = value;
      }
      rows.push(Array.from(row, (x) => (x ?? '').trim()));
    }
    sheets.push({ name: names[n - 1], rows });
  }
  return sheets;
}

/** CSV を読む。カンマ・ダブルクォート・改行つきセルに対応 */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}
