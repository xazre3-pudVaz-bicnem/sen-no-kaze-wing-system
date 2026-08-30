import {
  FREE_PRODUCT_CATEGORY_CODE,
  type BaseModel,
  type OptionCategory,
  type OptionVariantChoice,
  type OptionVariantGroup,
  type PricingResult,
  type ProductOption,
} from './types';
import type { ExteriorFaceSelection } from './exterior-wall';

export const TAX_RATE = 0.1;
/** 諸費用（交通費・労災・安全管理費等）: 本体・オプションそれぞれの小計に対する率（見積書テンプレートより 15%） */
export const DEFAULT_EXPENSE_RATE = 0.15;
/** 値引き等調整額: 税抜請負額を千円未満切捨てにする */
export const ROUNDING_UNIT = 1000;

export interface SelectionInput {
  option_id: string;
  quantity?: number;
  /** 選ばれたバリエーション（選択肢 ID）。商品に紐づかないものは無視される */
  variant_choice_ids?: string[];
}

const EXTERIOR_FACE_ORDER = [
  { code: 'front', label: '正面' },
  { code: 'right', label: '右側面' },
  { code: 'back', label: '背面' },
  { code: 'left', label: '左側面' },
] as const;

/**
 * 見積書テンプレート（20260821見積書テンプレート.xlsx）の計算構造を再現する。
 *
 *   本体一式 ＋ 本体諸費用(15%)                    ＝ 本体価格計
 *   オプション明細 ＋ オプション諸費用(15%)          ＝ オプション価格計
 *   別途工事（運送・設置・電気・給排水・基礎…）       ＝ 現地確認後に代理店が見積（本計算では 0 円・表示のみ）
 *   本体価格計 ＋ オプション価格計 ＋ 別途工事計       ＝ 小計
 *   値引き等調整額（千円未満切捨て）                  → 税抜請負額
 *   消費税 10%                                        → 合計（税込）
 *
 * ブラウザ表示とサーバー再計算で同じ関数を使う。未公開・他モデルのオプションは無視する。
 * exteriorFaces が4面そろっている場合、従来の外壁1件は除外し、4面を各1面として個別加算する。
 */
export function computePricing(
  model: Pick<BaseModel, 'id' | 'base_price'> & { expense_rate?: number | null },
  options: ProductOption[],
  categories: OptionCategory[],
  selections: SelectionInput[],
  taxRate: number = TAX_RATE,
  /** バリエーション（無指定なら追加価格 0 として扱う） */
  variants: { groups: OptionVariantGroup[]; choices: OptionVariantChoice[] } = { groups: [], choices: [] },
  /** 本体一式の上書き（本体内訳マスターの合計）。null / 未指定なら model.base_price */
  baseOverride: number | null = null,
  /** 外壁4面の割当。4面そろっている場合は通常の外壁1件よりこちらを優先する */
  exteriorFaces: ExteriorFaceSelection[] = []
): PricingResult {
  const groupById = new Map(variants.groups.map((g) => [g.id, g]));
  const choiceById = new Map(variants.choices.map((c) => [c.id, c]));
  const expenseRate = model.expense_rate ?? DEFAULT_EXPENSE_RATE;
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const categoryCode = new Map(categories.map((c) => [c.id, c.code]));
  const byId = new Map(options.map((o) => [o.id, o]));
  const lines: PricingResult['lines'] = [];
  const seen = new Set<string>();

  const exteriorCategory = categories.find((c) => c.code === 'exterior-wall');
  const exteriorByFace = new Map(exteriorFaces.map((face) => [face.face_code, face]));
  const hasFourExteriorFaces = Boolean(
    exteriorCategory &&
      exteriorFaces.length === EXTERIOR_FACE_ORDER.length &&
      exteriorByFace.size === EXTERIOR_FACE_ORDER.length &&
      EXTERIOR_FACE_ORDER.every(({ code }) => {
        const face = exteriorByFace.get(code);
        const opt = face ? byId.get(face.option_id) : null;
        return Boolean(
          face &&
            opt &&
            opt.category_id === exteriorCategory.id &&
            opt.status === 'published' &&
            (!opt.base_model_id || opt.base_model_id === model.id)
        );
      })
  );

  for (const sel of selections) {
    const opt = byId.get(sel.option_id);
    if (!opt || seen.has(opt.id)) continue;
    if (opt.status !== 'published') continue;
    if (opt.base_model_id && opt.base_model_id !== model.id) continue;
    const code = categoryCode.get(opt.category_id) ?? '';
    // 4面指定がある場合は、正面だけ同期されている従来の外壁1件を二重計上しない。
    if (hasFourExteriorFaces && code === 'exterior-wall') continue;
    seen.add(opt.id);
    const quantity = Math.max(1, Math.floor(sel.quantity ?? 1));
    // 選ばれたバリエーションのうち、この商品の選択項目に属するものだけを採用する
    const picked = (sel.variant_choice_ids ?? [])
      .map((cid) => choiceById.get(cid))
      .filter((c): c is OptionVariantChoice => Boolean(c && groupById.get(c.group_id)?.option_id === opt.id));
    const variantLines = picked.map((c) => ({
      group: groupById.get(c.group_id)?.name ?? '',
      choice: c.name,
      extra_price: c.price_on_request ? 0 : c.extra_price,
    }));
    const variantExtra = variantLines.reduce((sum, v) => sum + v.extra_price, 0);
    const unit = (opt.price_on_request ? 0 : opt.price) + variantExtra;
    // フリー商品は代理店の自社商品のため、技術の杜の諸費用（15%）は乗せない
    const isFree = code === FREE_PRODUCT_CATEGORY_CODE;
    lines.push({
      option_id: opt.id,
      code: opt.code,
      name: opt.name,
      category_name: categoryName.get(opt.category_id) ?? '',
      category_code: code,
      unit_price: unit,
      quantity,
      amount: unit * quantity,
      is_installation: opt.is_installation || isFree,
      is_free_product: isFree,
      variants: variantLines,
      price_on_request: opt.price_on_request,
      image_url: opt.image_url,
    });
  }

  if (hasFourExteriorFaces && exteriorCategory) {
    for (const faceInfo of EXTERIOR_FACE_ORDER) {
      const face = exteriorByFace.get(faceInfo.code)!;
      const opt = byId.get(face.option_id)!;
      const picked = (face.variant_choice_ids ?? [])
        .map((cid) => choiceById.get(cid))
        .filter((c): c is OptionVariantChoice => Boolean(c && groupById.get(c.group_id)?.option_id === opt.id));
      const variantLines = picked.map((c) => ({
        group: groupById.get(c.group_id)?.name ?? '',
        choice: c.name,
        extra_price: c.price_on_request ? 0 : c.extra_price,
      }));
      const variantExtra = variantLines.reduce((sum, v) => sum + v.extra_price, 0);
      const priceOnRequest = opt.price_on_request || picked.some((choice) => choice.price_on_request);
      const unit = (opt.price_on_request ? 0 : opt.price) + variantExtra;
      lines.push({
        option_id: opt.id,
        code: `${opt.code}__face_${faceInfo.code}`,
        name: `外壁仕様（${faceInfo.label}）：${opt.name}`,
        category_name: exteriorCategory.name,
        category_code: exteriorCategory.code,
        unit_price: unit,
        quantity: 1,
        amount: unit,
        is_installation: false,
        is_free_product: false,
        variants: variantLines,
        price_on_request: priceOnRequest,
        image_url: opt.image_url,
      });
    }
  }

  const base_price = baseOverride ?? model.base_price;
  const base_expense = Math.floor(base_price * expenseRate);
  const base_total = base_price + base_expense;

  const option_subtotal = lines.filter((l) => !l.is_installation).reduce((s, l) => s + l.amount, 0);
  const option_expense = Math.floor(option_subtotal * expenseRate);
  const option_total = option_subtotal + option_expense;

  const installation_subtotal = lines.filter((l) => l.is_installation).reduce((s, l) => s + l.amount, 0);
  const free_subtotal = lines.filter((l) => l.is_free_product).reduce((s, l) => s + l.amount, 0);

  const subtotal_raw = base_total + option_total + installation_subtotal;
  const subtotal = Math.floor(subtotal_raw / ROUNDING_UNIT) * ROUNDING_UNIT;
  const adjustment = subtotal - subtotal_raw; // 0 または負の値
  const tax = Math.floor(subtotal * taxRate);

  return {
    base_model_id: model.id,
    base_price,
    expense_rate: expenseRate,
    base_expense,
    base_total,
    lines,
    option_subtotal,
    option_expense,
    option_total,
    installation_subtotal,
    free_subtotal,
    subtotal_raw,
    adjustment,
    subtotal,
    tax_rate: taxRate,
    tax,
    total: subtotal + tax,
    has_price_on_request: lines.some((l) => l.price_on_request),
  };
}

/** 数量の表示（小数第1位まで。整数はそのまま）。先方指定「数量は小数点1」 */
export function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatYen(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}¥${Math.abs(value).toLocaleString('ja-JP')}`;
}

/** 「参考価格 ○○万円〜」表示用（本体価格計＝本体一式＋諸費用） */
export function formatManYen(value: number): string {
  const man = Math.floor(value / 10000);
  return `${man.toLocaleString('ja-JP')}万円`;
}

/** 商品一覧などで使う「本体価格計（諸費用込み・税別）」 */
export function baseTotalOf(model: Pick<BaseModel, 'base_price'> & { expense_rate?: number | null }): number {
  const rate = model.expense_rate ?? DEFAULT_EXPENSE_RATE;
  return model.base_price + Math.floor(model.base_price * rate);
}