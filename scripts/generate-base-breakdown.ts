/**
 * 先方の分類表見積書（assets/source-docs/20260827分類表見積書.xlsx）から
 * 本体内訳マスターの初期データ lib/seed/base-breakdown.ts を生成する。
 *
 *   node scripts/generate-base-breakdown.ts [--file <xlsx>]
 *
 * 取り込むのは各シート右側の「お客様見積書」（売価）だけ。
 * 左側の原価表・振込先などの社外秘情報は一切出力しない。
 * 実運用での更新は管理画面の「本体内訳マスター」から行う（こちらは初期データ用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readXlsx } from '../lib/import/archive.ts';
import { arg } from './env.ts';

const file = arg('file') ?? path.join(process.cwd(), 'assets', 'source-docs', '20260827分類表見積書.xlsx');
if (!fs.existsSync(file)) {
  console.error(`ファイルが見つかりません: ${file}`);
  process.exit(1);
}

/** シート名 → モデル slug と仕様コード（BOX は 1 シートを全仕様に使う） */
const SHEET_MAP: { match: RegExp; slug: string; specs: string[] }[] = [
  { match: /ウィング【ホテルUB】/, slug: 'wing-01', specs: ['hotel'] },
  { match: /ウィング【単身者用】/, slug: 'wing-01', specs: ['residence'] },
  { match: /ウィング【事務所】\s*$/, slug: 'wing-01', specs: ['office'] },
  { match: /BOX（ホテル単身者）/, slug: 'box', specs: ['hotel', 'residence', 'office'] },
  { match: /フラット/, slug: 'flat', specs: ['office'] },
];

function stableId(key: string): string {
  const h = createHash('sha256').update(`base-breakdown:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Row {
  section: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  remark: string | null;
}

interface SheetResult {
  rows: Row[];
  linesTotal: number;
  expense: number;
  sheetTotal: number;
}

const isSection = (s: string) => /^[0-9０-９]+[．.]/.test(s.trim());
const junk = (s: string | undefined) => !s || /^[\d,.\s]*$/.test(s.trim());

/**
 * readXlsx の rows は 0 始まりの二次元配列（空セルは undefined/''）。
 * 右側（売価）の列: M=12 番号 / P=15 品名 / S=18 数量 / T=19 単位 / U=20 単価 / V=21 金額 / W=22 備考
 * 左側（品名の補完に使う）: C=2 工事区分 / E=4 品名 / F=5 品名サブ / L=11 備考
 */
function parseSheet(rows: string[][], sheetName: string): SheetResult {
  const C = 2, E = 4, F = 5, L = 11, B = 1, M = 12, P = 15, S = 18, T = 19, U = 20, V = 21, W = 22;
  const out: Row[] = [];
  let section = '';
  let expense = 0;
  let sheetTotal = 0;
  let started = false;
  for (const r of rows) {
    const cell = (i: number) => (r[i] ?? '').toString().trim();
    if (!started) {
      if (cell(B) === '番号' || cell(M) === '番号') started = true;
      continue;
    }
    const leftLabel = cell(B) || cell(M);
    if (leftLabel.includes('本体諸費用')) {
      expense = Math.round(Number(cell(V)) || 0);
      continue;
    }
    if (leftLabel.includes('本体価格計') || cell(C).includes('本体価格計')) {
      // 右側の金額列（V）に売価の本体価格計が入る
      sheetTotal = Math.round(Number(cell(V)) || 0);
      break;
    }
    if (isSection(cell(C))) section = cell(C).replace(/\s+/g, '');
    // 品名: 右側 P を優先し、数字だけ等のゴミなら左側 E＋F から補完
    let name = cell(P);
    if (junk(name)) name = [cell(E), cell(F)].filter(Boolean).join(' ');
    else if (cell(F) && !name.includes(cell(F))) name = `${name} ${cell(F)}`;
    name = name.trim();
    const qty = Number(cell(S));
    const unitPrice = cell(U) === '' ? NaN : Number(cell(U));
    const amount = cell(V) === '' ? NaN : Number(cell(V));
    if (!section || junk(name) || !Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(unitPrice) && !Number.isFinite(amount)) continue;
    const remarkRaw = !junk(cell(W)) ? cell(W) : !junk(cell(L)) ? cell(L) : null;
    out.push({
      section,
      name,
      quantity: qty,
      unit: cell(T) || null,
      unit_price: Math.round(Number.isFinite(unitPrice) ? unitPrice : 0),
      amount: Math.round(Number.isFinite(amount) ? amount : 0),
      remark: remarkRaw,
    });
  }
  const linesTotal = out.reduce((s, x) => s + x.amount, 0);
  if (!out.length) throw new Error(`${sheetName}: 明細を読み取れませんでした`);
  if (!sheetTotal) throw new Error(`${sheetName}: 【本体価格計】を読み取れませんでした`);
  // シートの本体価格計（売価）＝ 明細合計 ＋ 諸費用 になっているか検算
  if (Math.abs(linesTotal + expense - sheetTotal) > 2) {
    throw new Error(`${sheetName}: 検算が合いません（明細 ${linesTotal} + 諸費用 ${expense} ≠ 本体価格計 ${sheetTotal}）`);
  }
  // 諸費用が 15% になっているか（丸め ±2 円は許容）
  if (Math.abs(Math.floor(linesTotal * 0.15) - expense) > 2) {
    console.warn(`${sheetName}: 諸費用がちょうど 15% ではありません（${expense} vs ${Math.floor(linesTotal * 0.15)}）`);
  }
  return { rows: out, linesTotal, expense, sheetTotal };
}

const sheets = readXlsx(fs.readFileSync(file));
const items: (Row & { id: string; model_slug: string; spec_code: string; sort_order: number })[] = [];
const totals: Record<string, { lines: number; expense: number; total: number }> = {};

for (const sheet of sheets) {
  const map = SHEET_MAP.find((m) => m.match.test(sheet.name));
  if (!map) continue;
  const key0 = `${map.slug}:${map.specs[0]}`;
  if (totals[key0]) continue; // 事務所(2) など重複シートは先勝ち
  const parsed = parseSheet(sheet.rows as unknown as string[][], sheet.name);
  for (const spec of map.specs) {
    const key = `${map.slug}:${spec}`;
    if (totals[key]) continue;
    totals[key] = { lines: parsed.linesTotal, expense: parsed.expense, total: parsed.sheetTotal };
    parsed.rows.forEach((row, i) => {
      items.push({ ...row, id: stableId(`${key}:${i}`), model_slug: map.slug, spec_code: spec, sort_order: i + 1 });
    });
    console.log(`${sheet.name} → ${key}: ${parsed.rows.length} 行 / 明細 ${parsed.linesTotal.toLocaleString()} + 諸費用 ${parsed.expense.toLocaleString()} = ${parsed.sheetTotal.toLocaleString()} 円`);
  }
}

const expectKeys = ['wing-01:hotel', 'wing-01:residence', 'wing-01:office', 'box:hotel', 'box:residence', 'box:office', 'flat:office'];
for (const k of expectKeys) {
  if (!totals[k]) throw new Error(`内訳が見つかりません: ${k}`);
}

const esc = (s: string | null) => (s === null ? 'null' : JSON.stringify(s));

const lines: string[] = [];
lines.push('/**');
lines.push(' * 本体内訳マスターの初期データ（自動生成。手で編集しない）');
lines.push(' *   生成: node scripts/generate-base-breakdown.ts');
lines.push(' *   元データ: 20260827分類表見積書.xlsx の右側「お客様見積書」（売価のみ。原価は含まない）');
lines.push(' * 実運用での更新は管理画面の「本体内訳マスター」から行う。');
lines.push(' */');
lines.push('');
lines.push('export interface SeedBaseBreakdownItem {');
lines.push('  id: string;');
lines.push("  /** base_models.slug（catalog.ts で ID に解決する） */");
lines.push('  model_slug: string;');
lines.push('  spec_code: string;');
lines.push('  section: string;');
lines.push('  name: string;');
lines.push('  quantity: number;');
lines.push('  unit: string | null;');
lines.push('  unit_price: number;');
lines.push('  amount: number;');
lines.push('  remark: string | null;');
lines.push('  sort_order: number;');
lines.push('}');
lines.push('');
lines.push('export const BASE_BREAKDOWN_ITEMS: SeedBaseBreakdownItem[] = [');
for (const it of items) {
  lines.push(
    `  { id: '${it.id}', model_slug: '${it.model_slug}', spec_code: '${it.spec_code}', section: ${esc(it.section)}, name: ${esc(it.name)}, quantity: ${it.quantity}, unit: ${esc(it.unit)}, unit_price: ${it.unit_price}, amount: ${it.amount}, remark: ${esc(it.remark)}, sort_order: ${it.sort_order} },`
  );
}
lines.push('];');
lines.push('');
lines.push('/** `${model_slug}:${spec_code}` → 明細合計・諸費用(15%)・本体価格計（シートの検算値） */');
lines.push('export const BASE_BREAKDOWN_TOTALS: Record<string, { lines: number; expense: number; total: number }> = {');
for (const [k, v] of Object.entries(totals)) {
  lines.push(`  '${k}': { lines: ${v.lines}, expense: ${v.expense}, total: ${v.total} },`);
}
lines.push('};');
lines.push('');
lines.push('/** モデルの既定仕様の明細合計（base_models.base_price の初期値に使う） */');
lines.push('export function baseBreakdownLinesTotal(modelSlug: string, specCode: string): number | null {');
lines.push('  return BASE_BREAKDOWN_TOTALS[`${modelSlug}:${specCode}`]?.lines ?? null;');
lines.push('}');
lines.push('');

fs.writeFileSync(path.join(process.cwd(), 'lib', 'seed', 'base-breakdown.ts'), lines.join('\n'), 'utf8');
console.log(`lib/seed/base-breakdown.ts: ${items.length} 行を書き出しました`);
