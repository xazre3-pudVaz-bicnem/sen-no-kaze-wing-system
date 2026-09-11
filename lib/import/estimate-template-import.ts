import type { Sheet } from './archive';
import type { EstimateSectionCode } from '@/lib/domain/types';

export const STANDARD_ESTIMATE_SECTIONS: {
  code: EstimateSectionCode;
  label: string;
  startLabel: string;
  subtotalLabel: string;
}[] = [
  { code: 'base', label: '本体', startLabel: '本体', subtotalLabel: '【本体価格計】' },
  { code: 'interior_exterior', label: '内外装工事', startLabel: '内外装', subtotalLabel: '【内外装価格計】' },
  { code: 'option', label: 'オプション', startLabel: 'ｵﾌﾟｼｮﾝ', subtotalLabel: '【オプション価格計】' },
  { code: 'sitework', label: '別途', startLabel: '別途', subtotalLabel: '【別途工事計】' },
];

interface StandardEstimateSheetDef {
  sheetName: string;
  modelSlug: string;
  specCode: string;
  name: string;
  /** Excel上の見出しが共通形式と異なる場合だけ指定する。 */
  sectionMarkers?: Partial<Record<EstimateSectionCode, { label: string; occurrence?: number }>>;
  /** Flatの旧Excelでは内外装経費が「本体諸費用」と表記されるため、取込時に正規化する。 */
  normalizeInteriorExpenseFromBase?: boolean;
  /** 旧Excelでオプションに置かれた室内造作を、現行ルールの内外装工事へ移す。 */
  normalizeCarpentryIntoInterior?: boolean;
}

export const STANDARD_ESTIMATE_SHEETS: StandardEstimateSheetDef[] = [
  // Wing: 実物Excelに存在する4つの標準見積
  { sheetName: 'ウィング【本体】', modelSlug: 'wing-01', specCode: 'base', name: '本体のみ' },
  { sheetName: 'ウィング【ホテルUB】', modelSlug: 'wing-01', specCode: 'hotel', name: 'ホテル仕様' },
  { sheetName: 'ウィング【単身者用】', modelSlug: 'wing-01', specCode: 'residence', name: '住宅仕様' },
  { sheetName: 'ウィング【事務所】', modelSlug: 'wing-01', specCode: 'office', name: '事務所・店舗用' },

  // BOX: 旧 preset ではなく、実物Excelに存在する標準見積体系を正本とする
  { sheetName: 'BOX（本体）', modelSlug: 'box', specCode: 'base', name: '本体のみ', normalizeCarpentryIntoInterior: true },
  { sheetName: 'BOX（ホテル単身者）', modelSlug: 'box', specCode: 'hotel-single', name: 'ホテル・単身者用', normalizeCarpentryIntoInterior: true },
  { sheetName: 'BOX（水回りキット）', modelSlug: 'box', specCode: 'water-kit', name: '水回りキット', normalizeCarpentryIntoInterior: true },

  // Flat: Excel上は内外装の合計見出しも「【本体価格計】」だが、
  // システムではWingと同じ4分類（本体 / 内外装工事 / オプション / 別途）へ正規化する。
  {
    sheetName: 'フラット (本体)',
    modelSlug: 'flat',
    specCode: 'base',
    name: '本体のみ',
    sectionMarkers: { interior_exterior: { label: '【本体価格計】', occurrence: 2 } },
    normalizeInteriorExpenseFromBase: true,
    normalizeCarpentryIntoInterior: true,
  },
  {
    sheetName: 'フラット (物置事務所)',
    modelSlug: 'flat',
    specCode: 'office',
    name: '事務所・店舗用',
    sectionMarkers: { interior_exterior: { label: '【本体価格計】', occurrence: 2 } },
    normalizeInteriorExpenseFromBase: true,
    normalizeCarpentryIntoInterior: true,
  },
];

export interface ParsedEstimateLine {
  section_code: Exclude<EstimateSectionCode, 'base'>;
  group_label: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  remark: string | null;
  sort_order: number;
}

export interface ParsedBaseBreakdownItem {
  section: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  remark: string | null;
  sort_order: number;
}

export interface ParsedEstimateSection {
  code: EstimateSectionCode;
  label: string;
  line_subtotal: number;
  expense_label: string | null;
  expense_rate: number | null;
  expense_amount: number;
  total: number;
  sort_order: number;
}

export interface ParsedEstimateTemplate {
  model_slug: string;
  spec_code: string;
  name: string;
  source_sheet_name: string;
  sections: ParsedEstimateSection[];
  /** 本体明細は base_breakdown_items の唯一の正本として保存する。 */
  base_breakdown_items: ParsedBaseBreakdownItem[];
  /** 本体以外の3分類だけを保持する。 */
  lines: ParsedEstimateLine[];
  tax_rate: number;
  subtotal_raw: number;
  adjustment: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface ParsedEstimateWorkbook {
  templates: ParsedEstimateTemplate[];
  ignoredSheets: string[];
}

const C = {
  leftSection: 1, // B
  leftGroup: 2, // C
  leftName: 4, // E
  leftSubName: 5, // F
  leftRemark: 11, // L
  section: 12, // M
  group: 13, // N
  name: 15, // P
  quantity: 18, // S
  unit: 19, // T
  unitPrice: 20, // U
  amount: 21, // V
  remark: 22, // W
} as const;

function cell(row: string[], index: number): string {
  return String(row[index] ?? '').trim();
}

function text(row: string[], index: number): string {
  const value = cell(row, index);
  return value === '0' ? '' : value;
}

function numberValue(row: string[], index: number): number | null {
  const raw = cell(row, index).replace(/[¥￥,]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Excel に保存されている金額をそのまま使う。0.1円等も標準見積の正本として保持する。 */
function money(row: string[], index: number): number {
  return numberValue(row, index) ?? 0;
}

function sameMoney(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.0001;
}

function normalizeLabel(value: string): string {
  return value.replace(/[\s　]/g, '');
}

function isNumberedGroup(value: string): boolean {
  return /^[0-9０-９]+[．.]/.test(value.trim());
}

function findRow(rows: string[][], predicate: (row: string[]) => boolean, from = 0): number {
  for (let i = from; i < rows.length; i++) if (predicate(rows[i])) return i;
  return -1;
}

function findNthRow(
  rows: string[][],
  predicate: (row: string[]) => boolean,
  occurrence = 1,
  from = 0
): number {
  let matched = 0;
  for (let i = from; i < rows.length; i++) {
    if (!predicate(rows[i])) continue;
    matched += 1;
    if (matched === occurrence) return i;
  }
  return -1;
}

function lineName(row: string[]): string {
  const customer = text(row, C.name);
  if (customer) return customer;
  const left = [text(row, C.leftName), text(row, C.leftSubName)].filter(Boolean).join(' ').trim();
  if (left) return left;
  const group = text(row, C.leftGroup);
  return isNumberedGroup(group) ? group : '';
}

function expenseLabel(
  row: string[],
  code: EstimateSectionCode,
  normalizeInteriorExpenseFromBase = false
): string | null {
  const customer = text(row, C.section);
  const leftSection = text(row, C.leftSection);
  const leftGroup = text(row, C.leftGroup);
  if (code === 'base' && (customer.includes('諸費用') || leftSection.includes('本体諸費用'))) {
    return customer || leftSection;
  }
  if (
    code === 'interior_exterior' &&
    (customer.includes('工事経費') || leftSection.includes('内外装工事経費'))
  ) {
    return customer || leftSection;
  }
  if (
    code === 'interior_exterior' &&
    normalizeInteriorExpenseFromBase &&
    (customer.includes('本体諸費用') || leftSection.includes('本体諸費用'))
  ) {
    return '内外装工事経費';
  }
  if (code === 'option' && leftGroup.includes('オプション諸費用')) return leftGroup;
  return null;
}

function parseSection(
  rows: string[][],
  sectionIndex: number,
  start: number,
  end: number,
  globalExpenseRate: number | null,
  normalizeInteriorExpenseFromBase = false
): {
  section: ParsedEstimateSection;
  baseItems: ParsedBaseBreakdownItem[];
  lines: ParsedEstimateLine[];
} {
  const def = STANDARD_ESTIMATE_SECTIONS[sectionIndex];
  const baseItems: ParsedBaseBreakdownItem[] = [];
  const lines: ParsedEstimateLine[] = [];
  let currentGroup = def.label;
  let expense = 0;
  let expenseName: string | null = null;
  let sort = 0;

  for (let i = start; i < end; i++) {
    const row = rows[i];
    const leftGroup = text(row, C.leftGroup);
    const customerGroup = text(row, C.group);
    const candidateGroup = isNumberedGroup(customerGroup)
      ? customerGroup
      : isNumberedGroup(leftGroup)
        ? leftGroup
        : '';
    if (candidateGroup) currentGroup = candidateGroup;

    const expLabel = expenseLabel(row, def.code, normalizeInteriorExpenseFromBase);
    if (expLabel) {
      expenseName = expLabel;
      expense = money(row, C.amount);
      continue;
    }

    const name = lineName(row);
    if (!name) continue;
    const quantity = numberValue(row, C.quantity);
    const unitPriceRaw = numberValue(row, C.unitPrice);
    const item = {
      group_label: currentGroup || null,
      name,
      quantity,
      unit: text(row, C.unit) || null,
      unit_price: unitPriceRaw,
      amount: money(row, C.amount),
      remark: text(row, C.remark) || text(row, C.leftRemark) || null,
      sort_order: ++sort,
    };

    if (def.code === 'base') {
      if (quantity == null || quantity <= 0 || item.unit_price == null) {
        throw new Error(`${def.label}: 本体明細「${name}」の数量または単価を読み取れませんでした`);
      }
      // 既存 base_breakdown_items は単価・金額が1円単位の integer。
      // 小数を暗黙変換するとExcel正本と食い違うため、丸めず明示的に止める。
      if (!Number.isInteger(item.unit_price) || !Number.isInteger(item.amount)) {
        throw new Error(
          `${def.label}: 本体明細「${name}」に1円未満の単価・金額があります。Excel記載値を保持できないため登録を中止しました`
        );
      }
      baseItems.push({
        section: currentGroup || def.label,
        name,
        quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        amount: item.amount,
        remark: item.remark,
        sort_order: item.sort_order,
      });
    } else {
      lines.push({ ...item, section_code: def.code });
    }
  }

  const lineSubtotal =
    def.code === 'base'
      ? baseItems.reduce((sum, row) => sum + row.amount, 0)
      : lines.reduce((sum, row) => sum + row.amount, 0);
  const total = money(rows[end], C.amount);
  if (!sameMoney(lineSubtotal + expense, total)) {
    throw new Error(
      `${def.label}: 検算が合いません（明細 ${lineSubtotal.toLocaleString('ja-JP')} + 経費 ${expense.toLocaleString('ja-JP')} ≠ ${total.toLocaleString('ja-JP')}）`
    );
  }
  return {
    section: {
      code: def.code,
      label: def.label,
      line_subtotal: lineSubtotal,
      expense_label: expenseName,
      expense_rate: expense > 0 ? globalExpenseRate : null,
      expense_amount: expense,
      total,
      sort_order: sectionIndex + 1,
    },
    baseItems,
    lines,
  };
}


function normalizeLegacyCarpentry(
  def: StandardEstimateSheetDef,
  sections: ParsedEstimateSection[],
  lines: ParsedEstimateLine[],
  globalExpenseRate: number | null
): void {
  if (!def.normalizeCarpentryIntoInterior) return;

  const moved = lines.filter(
    (line) =>
      line.section_code === 'option' &&
      (line.group_label?.includes('造作工事') || line.name.includes('室内造作'))
  );
  if (!moved.length) return;

  const movedAmount = moved.reduce((sum, line) => sum + line.amount, 0);
  for (const line of moved) {
    line.section_code = 'interior_exterior';
    line.group_label = '造作工事';
  }

  const interior = sections.find((section) => section.code === 'interior_exterior');
  const option = sections.find((section) => section.code === 'option');
  if (!interior || !option) return;

  const rate = globalExpenseRate ?? interior.expense_rate ?? option.expense_rate ?? 0;
  // 古いExcelは内外装・オプションとも同じ経費率で計算している。
  // 造作工事の金額に対応する経費だけを分類間で移し、見積全体の金額は変えない。
  const expenseShift = Math.min(option.expense_amount, Math.floor(movedAmount * rate));

  interior.line_subtotal += movedAmount;
  option.line_subtotal -= movedAmount;
  interior.expense_amount += expenseShift;
  option.expense_amount -= expenseShift;
  interior.total += movedAmount + expenseShift;
  option.total -= movedAmount + expenseShift;

  interior.expense_label = '内外装工事経費';
  interior.expense_rate = rate || interior.expense_rate;
  if (option.expense_amount <= 0) {
    option.expense_amount = 0;
    option.expense_rate = null;
  }
}

function parseTemplate(sheet: Sheet, def: StandardEstimateSheetDef): ParsedEstimateTemplate {
  const rows = sheet.rows;
  const markerRows = new Map<EstimateSectionCode, number>();
  for (const section of STANDARD_ESTIMATE_SECTIONS) {
    const marker = def.sectionMarkers?.[section.code] ?? {
      label: section.subtotalLabel,
      occurrence: 1,
    };
    const row = findNthRow(
      rows,
      (r) => text(r, C.section) === marker.label,
      marker.occurrence ?? 1
    );
    if (row < 0) throw new Error(`${sheet.name}: ${marker.label} が見つかりません`);
    markerRows.set(section.code, row);
  }

  const globalExpenseRate = numberValue(rows[0] ?? [], 9); // J1
  const sections: ParsedEstimateSection[] = [];
  const baseItems: ParsedBaseBreakdownItem[] = [];
  const lines: ParsedEstimateLine[] = [];
  let previousEnd = 13; // 14行目のヘッダー直後

  STANDARD_ESTIMATE_SECTIONS.forEach((sectionDef, index) => {
    const end = markerRows.get(sectionDef.code)!;
    const startFound = findRow(
      rows,
      (r) => text(r, C.section) === sectionDef.startLabel,
      previousEnd
    );
    const start = startFound >= 0 && startFound < end ? startFound : previousEnd;
    const parsed = parseSection(
      rows,
      index,
      start,
      end,
      globalExpenseRate,
      def.normalizeInteriorExpenseFromBase ?? false
    );
    sections.push(parsed.section);
    baseItems.push(...parsed.baseItems);
    lines.push(...parsed.lines);
    previousEnd = end + 1;
  });

  normalizeLegacyCarpentry(def, sections, lines, globalExpenseRate);

  const summary: Record<'raw' | 'adjustment' | 'tax' | 'total', number> = {
    raw: -1,
    adjustment: -1,
    tax: -1,
    total: -1,
  };
  for (let i = previousEnd; i < rows.length; i++) {
    const label = normalizeLabel(text(rows[i], C.quantity));
    if (label === '小計') summary.raw = i;
    else if (label === '値引き等調整額') summary.adjustment = i;
    else if (label === '消費税') summary.tax = i;
    else if (label === '合計') summary.total = i;
  }
  for (const [key, row] of Object.entries(summary)) {
    if (row < 0) throw new Error(`${sheet.name}: 見積集計（${key}）を読み取れませんでした`);
  }

  const subtotalRaw = money(rows[summary.raw], C.amount);
  const adjustment = money(rows[summary.adjustment], C.amount);
  const subtotalFromExcel = numberValue(rows[summary.adjustment], C.remark);
  const subtotal = subtotalFromExcel == null ? subtotalRaw + adjustment : subtotalFromExcel;
  const taxRate = numberValue(rows[summary.tax], C.unitPrice) ?? 0.1;
  const tax = money(rows[summary.tax], C.amount);
  const total = money(rows[summary.total], C.amount);

  const sectionTotal = sections.reduce((sum, section) => sum + section.total, 0);
  if (!sameMoney(sectionTotal, subtotalRaw)) {
    throw new Error(
      `${sheet.name}: 4分類の合計が小計と一致しません（${sectionTotal.toLocaleString('ja-JP')} ≠ ${subtotalRaw.toLocaleString('ja-JP')}）`
    );
  }
  if (!sameMoney(subtotalRaw + adjustment, subtotal)) {
    throw new Error(`${sheet.name}: 値引き等調整額の検算が合いません`);
  }
  // 税額もExcel記載値を正本とする。数式は異常検知だけに使い、1円未満の丸め差は許容する。
  if (Math.abs(subtotal * taxRate - tax) >= 1) {
    throw new Error(`${sheet.name}: 消費税の検算が合いません`);
  }
  if (!sameMoney(subtotal + tax, total)) {
    throw new Error(`${sheet.name}: 合計金額の検算が合いません`);
  }

  return {
    model_slug: def.modelSlug,
    spec_code: def.specCode,
    name: def.name,
    source_sheet_name: sheet.name,
    sections,
    base_breakdown_items: baseItems,
    lines,
    tax_rate: taxRate,
    subtotal_raw: subtotalRaw,
    adjustment,
    subtotal,
    tax,
    total,
  };
}

/**
 * 実物の分類表見積Excelを標準見積へ変換する。
 * 防火シートは今回の対象外。preset や商品価格は一切参照せず、Excelを唯一の価格源として検算する。
 */
export function parseStandardEstimateWorkbook(sheets: Sheet[]): ParsedEstimateWorkbook {
  const defs = new Map(STANDARD_ESTIMATE_SHEETS.map((row) => [row.sheetName, row]));
  const templates: ParsedEstimateTemplate[] = [];
  const ignoredSheets: string[] = [];

  for (const sheet of sheets) {
    if (sheet.name.startsWith('【防火】')) {
      ignoredSheets.push(sheet.name);
      continue;
    }
    const def = defs.get(sheet.name);
    if (!def) {
      ignoredSheets.push(sheet.name);
      continue;
    }
    templates.push(parseTemplate(sheet, def));
  }

  if (!templates.length) throw new Error('標準見積として取り込めるシートが見つかりませんでした。');
  return { templates, ignoredSheets };
}
