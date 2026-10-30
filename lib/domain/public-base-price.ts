/**
 * 「本体価格計（本体一式＋諸費用・税別）〜」の金額の決まり（商品一覧・商品ページ・SEO で共通の価格元。2026-10-29 先方回答）。
 * サイトの新価格へ切り替えた後は、旧来の固定の本体価格（base_price）ではなく、公開中の v2.5 の標準見積の版を基準にする。
 * 下書きの変更では変わらず、新しい版を公開した時点で切り替わる（公開中の版だけを読む）。
 */

import { estimateTemplatesFor } from './estimate-template';
import { saleViewSpecCode } from './standard-estimate-sale-view';
import type { BaseModel } from './types';

/** 公開中の v2.5 の標準見積の版の本体の合計（get_public_v25_base_totals の 1 行。売価だけ） */
export interface V25BaseTotalRow {
  base_model_id: string;
  spec_code: string;
  fire_spec_code: 'non_fire' | 'fire';
  /** 本体の合計（本体一式＋諸費用・税別） */
  base_total: number;
  /** 本体に価格未確定の明細がある */
  has_por: boolean;
}

/**
 * シミュレーターでお客様が選べる仕様（仕様のボタン：本体のみ・プリセット・登録済みの Excel 標準見積の仕様。simulatorEstimateChoices と同じ）を、
 * 標準見積の用途コードに寄せたもの（BOX の hotel-single は hotel）。本体価格計は、お客様が選べる仕様の版だけで決める
 */
export function offeredSaleViewSpecCodes(model: Pick<BaseModel, 'slug' | 'presets'>, templateSpecCodes: string[]): string[] {
  const codes = [...estimateTemplatesFor(model).map((choice) => choice.code), ...templateSpecCodes];
  return [...new Set(codes.map((code) => saleViewSpecCode(model.slug, code)))];
}

/**
 * モデルの「本体価格計〜」：お客様が選べる仕様の、公開中の v2.5 の版の本体の合計の最小（仕様・防火のうち一番安いもの）。
 * 本体に価格未確定の明細がある版は使わない（金額が確定していないため）。使える版が無ければ null（金額を出さない）
 */
export function v25BaseTotalFrom(rows: V25BaseTotalRow[], modelId: string, offeredSpecCodes: string[]): number | null {
  const offered = new Set(offeredSpecCodes);
  const totals = rows
    .filter((row) => row.base_model_id === modelId && offered.has(row.spec_code) && !row.has_por)
    .map((row) => Number(row.base_total))
    .filter((total) => Number.isFinite(total));
  return totals.length > 0 ? Math.min(...totals) : null;
}
