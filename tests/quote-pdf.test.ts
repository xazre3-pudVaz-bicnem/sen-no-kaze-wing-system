import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderQuotePdf } from '@/lib/pdf/quote-pdf';
import type { Quote, QuoteItem } from '@/lib/domain/types';

const NOW = '2026-08-23T00:00:00.000Z';

const quote = {
  id: 'q1',
  quote_no: 'Q202608-0001',
  quote_request_id: 'r1',
  configuration_id: 'c1',
  user_id: 'u1',
  status: 'issued',
  issued_at: NOW,
  valid_until: '2026-09-22T00:00:00.000Z',
  customer_no: 'C000003',
  customer_name: '織田',
  customer_company: 'テスト',
  base_model_name: 'フラット',
  finish_level: 'shell',
  base_price: 1_480_705,
  base_expense: 222_105,
  option_subtotal: 235_278,
  option_expense: 35_291,
  installation_subtotal: 0,
  adjustment: -379,
  subtotal: 1_973_000,
  tax_rate: 0.1,
  tax: 197_300,
  total: 2_170_300,
  dealer_id: null,
  dealer_note: null,
  revision: 1,
  parent_quote_id: null,
  preview_image_url: null,
  notes: '本見積書は概算です。',
  created_at: NOW,
  updated_at: NOW,
} as unknown as Quote;

const line = (n: number, kind: string, name: string, unit: number, sort: number): QuoteItem =>
  ({
    id: `i${n}`,
    quote_id: 'q1',
    kind,
    name,
    description: null,
    unit_price: unit,
    quantity: 1,
    amount: unit,
    image_url: null,
    sort_order: sort,
  }) as unknown as QuoteItem;

const items: QuoteItem[] = [
  line(1, 'base', 'フラット 本体一式', 1_480_705, 0),
  line(2, 'base_expense', '本体諸費用', 222_105, 1),
  line(3, 'option', 'サッシ 樹脂サッシ（寒冷地仕様）', 235_278, 10),
  line(4, 'option_expense', 'オプション諸費用', 35_291, 9000),
  line(5, 'installation', '運送費', 0, 20),
];

/** PDF のページ内容ストリーム（FlateDecode 済み・ほぼ ASCII のもの）を取り出す */
function pageContent(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString('latin1');
  const found: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;
    let text: string;
    try {
      text = zlib.inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
    } catch {
      text = raw.slice(start, end);
    }
    const printable = (text.match(/[\x20-\x7e\n\r]/g) ?? []).length / (text.length || 1);
    // 埋め込みフォントのストリームを除くため、印字可能文字の比率で絞る
    if (/\bBT\b/.test(text) && printable > 0.95) found.push(text);
  }
  return found.sort((a, b) => b.length - a.length)[0] ?? '';
}

/**
 * 各テキスト描画のフォントサイズと、直前の平行移動（cm）で決まるベースライン位置を返す。
 * react-pdf は 1 行を 1 つの `cm` ブロックにまとめるので、同じ行の文字は同じ y になる。
 */
function textBaselines(content: string): { size: number; y: number }[] {
  const rows: { size: number; y: number }[] = [];
  const stack: number[] = [];
  let y = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const l = rawLine.trim();
    if (l === 'q') {
      stack.push(y);
      continue;
    }
    if (l === 'Q') {
      y = stack.pop() ?? 0;
      continue;
    }
    const cm = l.match(/^([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) cm$/);
    if (cm) {
      // 上下反転（d = -1）のブロックはページ座標へ戻すためのもので、行位置には効かない
      if (Number(cm[4]) > 0) y += Number(cm[6]);
      continue;
    }
    const tf = l.match(/^\/F\d+ ([\d.]+) Tf$/);
    if (tf) rows.push({ size: Number(tf[1]), y: Number(y.toFixed(2)) });
  }
  return rows;
}

describe('見積書 PDF のレイアウト', () => {
  it(
    '「御見積金額（税込）」と金額のベースラインが揃っている',
    async () => {
      const content = pageContent(await renderQuotePdf(quote, items));
      const rows = textBaselines(content);

      const label = rows.filter((r) => r.size === 10);
      const value = rows.filter((r) => r.size === 20);
      // 解析できていない場合はここで落ちる（react-pdf の出力形式が変わったら要更新）
      expect(label.length, 'ラベル（10pt）が見つかりません').toBeGreaterThan(0);
      expect(value.length, '金額（20pt）が見つかりません').toBeGreaterThan(0);

      // 文字サイズが違っても同じ行に並ぶこと。別々の行に分かれると 10pt 以上ずれる
      const shared = value.some((v) => label.some((l) => Math.abs(l.y - v.y) < 0.01));
      expect(shared, `ラベル ${JSON.stringify(label)} と金額 ${JSON.stringify(value)} のベースラインが揃っていません`).toBe(true);
    },
    60_000
  );

  it(
    'PDF として読める形式で出力される',
    async () => {
      const bytes = await renderQuotePdf(quote, items);
      expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(10_000);
    },
    60_000
  );
});
