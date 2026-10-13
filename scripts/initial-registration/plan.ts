/**
 * 初期登録の計画（確定資料 xlsx の「行別初期登録マッピング」→ 10 組み合わせの本体マスター・標準見積）。
 *
 * 確定資料：assets/source-docs/標準見積_初期登録候補整理_初期登録確認完了_20261008.xlsx（gitignore。原価を含むため公開リポジトリに置かない）
 * 規則（統合版依頼書 §11、xlsx の「行別要確認」「要確認事項」）
 *   - 「初期登録対象」の行のうち、初期登録アクションが「初期Revisionへ登録」「初期Revisionへ登録（…）」の行だけを登録する
 *     （数量 0・率計算の経費・集計・案件見積側・分類表 ×・重複／旧価格の行は登録しない）
 *   - 業務分類「Base Master」→ 本体マスターの明細、「標準見積／内外装」「標準見積／オプション」→ 標準見積の明細
 *   - 単価は原価として登録する（2026-10-13 決定：案 A。率は初期値の販売費率 100%・経費率 15%・掛率 150%）
 *     ただし型番のない設備機器は「商品確定待ち」として価格未確定（POR）で登録し、Excel の単価を原価として確定しない（同日の先方回答）
 *   - 経費は明細にせず、Revision の経費率から DB が再計算する。Excel の 1000 円単位の値引き調整は持ち込まない
 *   - 0 円の内訳はそのまま登録し、bundle の金額を配賦しない
 *   - 登録名が空の行は、直前の明細名と補助表記をつないだ名前にする（例「・サッシ / 勝手口ドア」）
 */
import type { CellValue, Sheet } from '../lib/read-xlsx.ts';
import { RATE_RULES, baseLineMoney, lineMoney, revisionMoney, sectionMoney, toScaled } from '../../lib/domain/standard-estimate-money.ts';

export const MAPPING_SHEET = '行別初期登録マッピング';

const MODEL_SLUG: Record<string, string> = { Wing: 'wing-01', BOX: 'box', Flat: 'flat' };
const SPEC_CODE: Record<string, string> = {
  'Wing/ホテル仕様': 'hotel',
  'Wing/住居用': 'residence',
  'Wing/事務所用': 'office',
  'BOX/ホテル仕様': 'hotel',
  'BOX/水回りBOX': 'water-kit',
  'Flat/事務所用': 'office',
};
const FIRE: Record<string, 'non_fire' | 'fire'> = { 非防火: 'non_fire', 防火: 'fire' };
const ESTIMATE_SECTION: Record<string, 'interior_exterior' | 'option'> = {
  '標準見積／内外装': 'interior_exterior',
  '標準見積／オプション': 'option',
};

/**
 * 型番のない設備機器は「商品確定待ち」として価格未確定（POR）で登録する（2026-10-13 先方回答）。
 *   - メーカー・型番が入っていて商品が確定しているものは、Excel の単価を原価として登録する
 *   - 取付・造作・養生・工事など、商品ではなく工事の行は、Excel の単価を原価として登録する
 *   - 内外装・本体の行（工事・材料）は対象外（Excel の単価を原価として登録する）
 * 商品を確定して商品台帳へ登録したあと、次の Revision で正式な原価と標準状態の商品を設定する。
 */
const MODEL_NUMBER = /[A-Z]{2,}-[A-Z0-9]+(?:-[A-Z0-9]+)+/;
const WORK_LINE = /取付|造作|養生|制作|工事|施工|配線|配管/;
export const PENDING_PRODUCT_REMARK =
  '商品確定待ち：メーカー・型番が未確定のため価格未確定。商品を確定して商品台帳へ登録したあと、正式な原価と標準状態の商品を設定する。';

export function isPendingProduct(sectionCode: 'interior_exterior' | 'option', name: string): boolean {
  return sectionCode === 'option' && !MODEL_NUMBER.test(name) && !WORK_LINE.test(name);
}

export const INITIAL_RATES = {
  salesFeeRate: RATE_RULES.salesFeeRate.initial,
  expenseRate: RATE_RULES.expenseRate.initial,
  markupRate: RATE_RULES.markupRate.initial,
  taxRate: '0.10',
} as const;

export interface PlanBaseLine {
  section: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  source_row: number;
}

export interface PlanEstimateLine {
  section_code: 'interior_exterior' | 'option';
  group_label: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  /** 商品確定待ちの設備機器は por（価格未確定。原価は持たない） */
  price_mode: 'auto' | 'por';
  cost_unit_price: number | null;
  remark: string | null;
  /** 商品確定待ちの行の Excel の単価（記録用。DB へは登録しない） */
  reference_unit_price?: number;
  source_row: number;
}

export interface PlanCombo {
  key: string;
  label: string;
  source_sheet: string;
  model_slug: string;
  spec_code: string;
  size_code: string;
  fire_spec_code: 'non_fire' | 'fire';
  base_lines: PlanBaseLine[];
  estimate_lines: PlanEstimateLine[];
  /** 初期の率で DB が計算するはずの金額（画面の試算と同じ式） */
  expected: { base_cost_line_subtotal: number; subtotal: number; tax: number; total: number; cost_total: number };
}

export interface RegistrationPlan {
  rates: typeof INITIAL_RATES;
  combos: PlanCombo[];
  issues: string[];
}

const text = (value: CellValue | undefined) => (value === undefined ? '' : String(value).trim());

function sizeCode(label: string): string | null {
  const m = /([\d,]+)\s*[×x]\s*([\d,]+)/.exec(label);
  return m ? `${m[1].replace(/,/g, '')}x${m[2].replace(/,/g, '')}` : null;
}

export function buildRegistrationPlan(sheets: Sheet[]): RegistrationPlan {
  const sheet = sheets.find((s) => s.name === MAPPING_SHEET);
  if (!sheet) throw new Error(`シート「${MAPPING_SHEET}」がありません`);
  const issues: string[] = [];
  const combos = new Map<string, PlanCombo>();
  const rowNos = Object.keys(sheet.rows).map(Number).filter((n) => n > 1).sort((a, b) => a - b);

  let currentSheet = '';
  let lastItem = '';
  let lastDetail = '';
  for (const rowNo of rowNos) {
    const cells = sheet.rows[String(rowNo)];
    const at = (col: string) => cells[col];
    const sourceSheet = text(at('A'));
    if (sourceSheet !== currentSheet) {
      currentSheet = sourceSheet;
      lastItem = '';
      lastDetail = '';
    }
    if (text(at('I'))) lastItem = text(at('I'));
    if (text(at('J'))) lastDetail = text(at('J'));

    if (text(at('G')) !== '初期登録対象') continue;
    const action = text(at('T'));
    // 「初期Revisionへ登録しない（重複・旧価格）」も同じ文字で始まるため、前方一致では判定しない
    if (!/^初期Revisionへ登録(?:（[^）]*）)?$/.test(action)) continue;

    const model = text(at('C'));
    const spec = text(at('D'));
    const fireLabel = text(at('F'));
    const modelSlug = MODEL_SLUG[model];
    const specCode = SPEC_CODE[`${model}/${spec}`];
    const fire = FIRE[fireLabel];
    const size = sizeCode(text(at('E')));
    const where = `${sourceSheet}#${rowNo}`;
    if (!modelSlug || !specCode || !fire || !size) {
      issues.push(`${where}: 機種・用途・防火・サイズを判定できません（${model} / ${spec} / ${fireLabel} / ${text(at('E'))}）`);
      continue;
    }
    const key = `${modelSlug}/${specCode}/${size}/${fire}`;

    const auxiliary = text(at('K'));
    const name = text(at('L')) || (lastDetail && auxiliary ? `${lastDetail} / ${auxiliary}` : auxiliary || lastDetail);
    const quantity = at('M');
    const unitPrice = at('O');
    if (!name || name.length > 120) issues.push(`${where}: 登録名が空か 120 文字を超えています`);
    if (typeof quantity !== 'number' || quantity <= 0) {
      issues.push(`${where}: 数量が不正です（${String(quantity)}）`);
      continue;
    }
    try {
      toScaled(String(quantity));
    } catch {
      issues.push(`${where}: 数量は小数 4 桁までです（${quantity}）`);
      continue;
    }
    if (typeof unitPrice !== 'number' || !Number.isInteger(unitPrice) || unitPrice < 0) {
      issues.push(`${where}: 単価が 0 円以上の整数ではありません（${String(unitPrice)}）`);
      continue;
    }
    const unit = text(at('N')) || null;
    const category = text(at('Q'));
    // 検査を通った行だけで組み合わせを作る（不正な行だけの組み合わせを作らない）
    let combo = combos.get(key);
    if (!combo) {
      combo = {
        key,
        label: `${model} ${spec} ${text(at('E'))} ${fireLabel}`,
        source_sheet: sourceSheet,
        model_slug: modelSlug,
        spec_code: specCode,
        size_code: size,
        fire_spec_code: fire,
        base_lines: [],
        estimate_lines: [],
        expected: { base_cost_line_subtotal: 0, subtotal: 0, tax: 0, total: 0, cost_total: 0 },
      };
      combos.set(key, combo);
    }

    if (category === 'Base Master') {
      if (!lastItem) issues.push(`${where}: 本体の項目（区分の見出し）がありません`);
      combo.base_lines.push({ section: lastItem || '本体', name, quantity, unit, unit_price: unitPrice, source_row: rowNo });
    } else if (ESTIMATE_SECTION[category]) {
      const sectionCode = ESTIMATE_SECTION[category];
      const pending = isPendingProduct(sectionCode, name);
      combo.estimate_lines.push({
        section_code: sectionCode,
        group_label: lastItem || null,
        name,
        quantity,
        unit,
        price_mode: pending ? 'por' : 'auto',
        cost_unit_price: pending ? null : unitPrice,
        // 仮設定の行は、見直しが必要なことを備考に残す（統合版 §11-2）
        remark: pending
          ? PENDING_PRODUCT_REMARK
          : action.includes('仮設定')
            ? text(at('U')) || '仮設定：Wing標準値に合わせて設定。実績確認後に見直す。'
            : null,
        ...(pending ? { reference_unit_price: unitPrice } : {}),
        source_row: rowNo,
      });
    } else {
      issues.push(`${where}: 登録する行の業務分類が想定外です（${category}）`);
    }
  }

  for (const combo of combos.values()) {
    const rates = INITIAL_RATES;
    const base = sectionMoney(combo.base_lines.map((line) => baseLineMoney(line.unit_price, String(line.quantity), rates)), 'rate', rates);
    const section = (code: 'interior_exterior' | 'option') =>
      sectionMoney(
        combo.estimate_lines
          .filter((line) => line.section_code === code)
          .map((line) => lineMoney({ mode: line.price_mode, quantity: String(line.quantity), costUnitPrice: line.cost_unit_price }, rates)),
        'rate',
        rates
      );
    const money = revisionMoney([base, section('interior_exterior'), section('option'), sectionMoney([], 'none', rates)], 0, rates);
    combo.expected = {
      base_cost_line_subtotal: base.costLineSubtotal,
      subtotal: money.subtotal,
      tax: money.tax,
      total: money.total,
      cost_total: money.costTotal,
    };
    if (combo.base_lines.length === 0) issues.push(`${combo.label}: 本体の明細がありません`);
  }

  return { rates: INITIAL_RATES, combos: [...combos.values()].sort((a, b) => a.key.localeCompare(b.key)), issues };
}
