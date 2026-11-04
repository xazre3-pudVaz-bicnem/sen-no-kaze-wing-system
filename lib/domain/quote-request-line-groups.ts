import type { OptionCategory, PricingResult } from './types';

type PriceLine = PricingResult['lines'][number];

export interface QuoteRequestPriceGroup {
  key: string;
  name: string;
  sort: number;
  lines: PriceLine[];
  /** 商品行の表示金額を集計した税別小計。諸費用・税・端数調整は含まない。 */
  amount: number;
}

export interface QuoteRequestLineGroups {
  pricedGroups: QuoteRequestPriceGroup[];
  zeroLines: PriceLine[];
  priceOnRequestLines: PriceLine[];
}

/**
 * 見積依頼画面専用の表示分類。元の金額・行・順序（各グループ内）は変更しない。
 * 分類は商品マスターの確定した分類フォルダを使い、商品名から用途を推測しない。
 *
 * price_on_request と正の計上額が同時にある行もあり得るため、
 * 別途見積項目の計上済み金額はUIで別途明示する。
 */
export function groupQuoteRequestLines(
  lines: PricingResult['lines'],
  categories: OptionCategory[]
): QuoteRequestLineGroups {
  const categoryByCode = new Map(categories.map((category) => [category.code, category]));
  const pricedGroups = new Map<string, QuoteRequestPriceGroup>();
  const zeroLines: PriceLine[] = [];
  const priceOnRequestLines: PriceLine[] = [];

  for (const line of lines) {
    if (line.price_on_request) {
      priceOnRequestLines.push(line);
      continue;
    }
    if (line.amount === 0) {
      zeroLines.push(line);
      continue;
    }

    // 外壁4面行の category_code は元の exterior-wall のまま渡ってくる。
    const category = categoryByCode.get(line.category_code);
    const key = category?.group_code || `category:${line.category_code || line.category_name || 'other'}`;
    const name = category?.group_name || line.category_name || 'その他の選択商品';
    let group = pricedGroups.get(key);
    if (!group) {
      group = { key, name, sort: category?.group_sort ?? Number.MAX_SAFE_INTEGER, lines: [], amount: 0 };
      pricedGroups.set(key, group);
    }
    group.lines.push(line);
    group.amount += line.amount;
  }

  return {
    pricedGroups: [...pricedGroups.values()].sort((a, b) => a.sort - b.sort),
    zeroLines,
    priceOnRequestLines,
  };
}
