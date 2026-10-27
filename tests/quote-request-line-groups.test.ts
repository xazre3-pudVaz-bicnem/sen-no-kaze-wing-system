import { describe, expect, it } from 'vitest';
import { groupQuoteRequestLines } from '../lib/domain/quote-request-line-groups';
import type { OptionCategory, PricingResult } from '../lib/domain/types';

type Line = PricingResult['lines'][number];

function category(code: string, groupCode: string, groupName: string, sort: number): OptionCategory {
  return {
    id: code, code, name: code, group_code: groupCode, group_name: groupName,
    group_sort: sort,
  } as OptionCategory;
}

function line(code: string, categoryCode: string, amount: number, priceOnRequest = false): Line {
  return {
    option_id: code, code, name: code, category_code: categoryCode,
    category_name: categoryCode, amount, price_on_request: priceOnRequest,
    is_installation: false, is_free_product: false,
  } as Line;
}

describe('見積依頼の表示専用グループ分け', () => {
  const categories = [
    category('toilet', 'equipment', '設備機器', 20),
    category('bath', 'equipment', '設備機器', 20),
    category('exterior-wall', 'finish', '内外装仕上げ', 10),
    category('sitework', 'sitework', '別途工事', 30),
  ];

  it('商品マスターの分類フォルダ名・順序を使い、商品名から分類しない', () => {
    const lines = [
      line('toilet', 'toilet', 200000),
      line('wall__face_front', 'exterior-wall', 100000),
      line('bath', 'bath', 300000),
      line('sitework', 'sitework', 50000),
    ];
    const result = groupQuoteRequestLines(lines, categories);
    expect(result.pricedGroups.map((g) => g.name)).toEqual(['内外装仕上げ', '設備機器', '別途工事']);
    expect(result.pricedGroups.map((g) => g.amount)).toEqual([100000, 500000, 50000]);
    expect(result.pricedGroups[1].lines.map((l) => l.code)).toEqual(['toilet', 'bath']);
  });

  it('0円、別途見積と金額計上済みの別途見積を混同せず、各行を一度だけ分類', () => {
    const lines = [
      line('priced', 'bath', 120000),
      line('zero', 'bath', 0),
      line('requested', 'bath', 0, true),
      line('partially-priced', 'bath', 70000, true),
    ];
    const result = groupQuoteRequestLines(lines, categories);
    expect(result.pricedGroups[0].amount).toBe(120000);
    expect(result.zeroLines.map((l) => l.code)).toEqual(['zero']);
    expect(result.priceOnRequestLines.map((l) => l.code)).toEqual(['requested', 'partially-priced']);
    expect(result.priceOnRequestLines[1].amount).toBe(70000);
    const allCodes = [
      ...result.pricedGroups.flatMap((g) => g.lines),
      ...result.zeroLines,
      ...result.priceOnRequestLines,
    ].map((l) => l.code);
    expect(allCodes.sort()).toEqual(lines.map((l) => l.code).sort());
    expect(
      result.pricedGroups.reduce((sum, g) => sum + g.amount, 0) +
      result.priceOnRequestLines.reduce((sum, l) => sum + l.amount, 0)
    ).toBe(lines.reduce((sum, l) => sum + l.amount, 0));
  });

  it('旧データに分類フォルダがない場合は既存のカテゴリー名で表示する', () => {
    const result = groupQuoteRequestLines([line('other', 'legacy-cat', 8000)], []);
    expect(result.pricedGroups).toHaveLength(1);
    expect(result.pricedGroups[0].name).toBe('legacy-cat');
    expect(result.pricedGroups[0].amount).toBe(8000);
  });
});
