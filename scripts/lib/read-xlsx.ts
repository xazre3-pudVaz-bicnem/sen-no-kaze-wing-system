/**
 * 依存なしの最小 xlsx リーダー（zip の central directory → XML を正規表現で読む）。
 * 名前空間の接頭辞（x: など）付きの XML にも対応する。初期登録の確定資料を読むためだけに使う。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export type CellValue = string | number | boolean;
export interface Sheet {
  name: string;
  /** 行番号 → 列記号 → 値（数式のセルは計算済みの値） */
  rows: Record<string, Record<string, CellValue>>;
}

function zipEntries(buf: Buffer) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('xlsx（zip）として読めません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const list: Record<string, { method: number; size: number; offset: number }> = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx の目次が壊れています');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    list[buf.toString('utf8', p + 46, p + 46 + nameLen)] = { method, size, offset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return list;
}

const NS = '(?:[A-Za-z0-9]+:)?';
const pair = (tag: string) => new RegExp(`<${NS}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}${tag}>`, 'g');
const one = (tag: string) => new RegExp(`<${NS}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${NS}${tag}>`);
const empty = (tag: string) => new RegExp(`<${NS}${tag}\\b[^>]*/?>`, 'g');
const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
const texts = (xml: string) => [...xml.matchAll(pair('t'))].map((m) => decode(m[1])).join('');

export function readXlsx(file: string): Sheet[] {
  const buf = fs.readFileSync(file);
  const entries = zipEntries(buf);
  const read = (name: string): string | null => {
    const e = entries[name];
    if (!e) return null;
    const nameLen = buf.readUInt16LE(e.offset + 26);
    const extraLen = buf.readUInt16LE(e.offset + 28);
    const start = e.offset + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.size);
    return (e.method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  };

  const shared: string[] = [];
  const sst = read('xl/sharedStrings.xml');
  if (sst) for (const si of sst.matchAll(pair('si'))) shared.push(texts(si[1]));

  const workbook = read('xl/workbook.xml') ?? '';
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const target: Record<string, string> = {};
  for (const r of rels.matchAll(empty('Relationship'))) {
    const id = /\bId="([^"]+)"/.exec(r[0])?.[1];
    const to = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
    if (id && to) target[id] = to.replace(/^\/?xl\//, '');
  }

  const rowRe = new RegExp(`<${NS}row\\b([^>]*)>([\\s\\S]*?)</${NS}row>`, 'g');
  const cellRe = new RegExp(`<${NS}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}c>)`, 'g');
  const sheets: Sheet[] = [];
  for (const s of workbook.matchAll(empty('sheet'))) {
    const name = decode(/\bname="([^"]+)"/.exec(s[0])?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(s[0])?.[1] ?? '';
    const xml = read(`xl/${target[rid]}`) ?? '';
    const rows: Sheet['rows'] = {};
    for (const row of xml.matchAll(rowRe)) {
      const rowNo = /\br="(\d+)"/.exec(row[1])?.[1];
      const cells: Record<string, CellValue> = {};
      for (const c of row[2].matchAll(cellRe)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
        const body = c[2] ?? '';
        const v = one('v').exec(body)?.[1];
        let value: CellValue | undefined;
        if (type === 's') value = shared[Number(v)];
        else if (type === 'inlineStr') value = texts(body);
        else if (type === 'str') value = v === undefined ? undefined : decode(v);
        else if (type === 'b') value = v === '1';
        else value = v === undefined ? undefined : Number(v);
        if (ref && value !== undefined && value !== '') cells[ref] = value;
      }
      if (rowNo && Object.keys(cells).length) rows[rowNo] = cells;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
