import { describe, expect, it } from 'vitest';
import { computeStandardEstimatePricing } from '@/lib/domain/standard-estimate-pricing';
import type { CatalogBundle, EstimateTemplateBundle } from '@/lib/domain/types';
import {
  MODEL_WING01_ID,
  seedBaseBreakdownItems,
  seedCategories,
  seedConflicts,
  seedDependencies,
  seedHotspots,
  seedModels,
  seedOptions,
  seedPreviewRules,
  seedProductImages,
  seedVariantChoices,
  seedVariantGroups,
} from '@/lib/seed/catalog';

const model = seedModels.find((row) => row.id === MODEL_WING01_ID)!;
const standardInterior = seedOptions.find((row) => row.code === 'interior-standard-wing')!;
const hotelInterior = seedOptions.find((row) => row.code === 'interior-hotel-wing')!;

const bundle: CatalogBundle = {
  model,
  images: seedProductImages.filter((row) => row.base_model_id === model.id),
  categories: seedCategories,
  options: seedOptions.filter((row) => !row.base_model_id || row.base_model_id === model.id),
  dependencies: seedDependencies,
  conflicts: seedConflicts,
  previewRules: seedPreviewRules.filter((row) => row.base_model_id === model.id),
  hotspots: seedHotspots,
  variantGroups: seedVariantGroups,
  variantChoices: seedVariantChoices,
  baseBreakdowns: seedBaseBreakdownItems.filter((row) => row.base_model_id === model.id),
};

const template: EstimateTemplateBundle = {
  template: {
    id: '81000000-0000-4000-8000-000000000001',
    base_model_id: model.id,
    spec_code: 'residence',
    name: '住宅仕様',
    source_file_name: 'standard.xlsx',
    source_sheet_name: 'ウィング【単身者用】',
    source_sha256: 'test',
    baseline_option_ids: [standardInterior.id],
    tax_rate: 0.1,
    subtotal_raw: 1_000_550,
    adjustment: -550,
    subtotal: 1_000_000,
    tax: 100_000,
    total: 1_100_000,
    imported_at: '2026-09-11T00:00:00.000Z',
    updated_at: '2026-09-11T00:00:00.000Z',
  },
  sections: [
    {
      id: '82000000-0000-4000-8000-000000000001',
      template_id: '81000000-0000-4000-8000-000000000001',
      code: 'base',
      label: '本体',
      line_subtotal: 500_000,
      expense_label: '本体諸費用',
      expense_rate: 0.15,
      expense_amount: 75_000,
      total: 575_000,
      sort_order: 1,
    },
    {
      id: '82000000-0000-4000-8000-000000000002',
      template_id: '81000000-0000-4000-8000-000000000001',
      code: 'interior_exterior',
      label: '内外装工事',
      line_subtotal: 250_000,
      expense_label: '内外装工事経費',
      expense_rate: 0.15,
      expense_amount: 37_500,
      total: 287_500,
      sort_order: 2,
    },
    {
      id: '82000000-0000-4000-8000-000000000003',
      template_id: '81000000-0000-4000-8000-000000000001',
      code: 'option',
      label: 'オプション',
      line_subtotal: 120_000,
      expense_label: 'オプション諸費用',
      expense_rate: 0.15,
      expense_amount: 18_000,
      total: 138_000,
      sort_order: 3,
    },
    {
      id: '82000000-0000-4000-8000-000000000004',
      template_id: '81000000-0000-4000-8000-000000000001',
      code: 'sitework',
      label: '別途',
      line_subtotal: 50,
      expense_label: null,
      expense_rate: null,
      expense_amount: 0,
      total: 50,
      sort_order: 4,
    },
  ],
  lines: [],
  base_breakdown_items: [],
  baseline_option_ids: [standardInterior.id],
};

describe('Excel標準見積を基準にしたシミュレーター計算', () => {
  it('標準商品のままならExcel記載の調整額・税・税込合計をそのまま返す', () => {
    const result = computeStandardEstimatePricing(
      bundle,
      template,
      [standardInterior.id],
      [],
      [],
      'full'
    );

    expect(result.has_changes).toBe(false);
    expect(result.pricing.subtotal_raw).toBe(1_000_550);
    expect(result.pricing.adjustment).toBe(-550);
    expect(result.pricing.subtotal).toBe(1_000_000);
    expect(result.pricing.tax).toBe(100_000);
    expect(result.pricing.total).toBe(1_100_000);
  });

  it('同カテゴリーの商品を変更すると商品マスターの差額と対応経費だけを標準見積へ反映する', () => {
    const result = computeStandardEstimatePricing(
      bundle,
      template,
      [hotelInterior.id],
      [],
      [],
      'full'
    );
    const interior = result.sections.find((row) => row.code === 'interior_exterior')!;

    const baselineAmount = standardInterior.price;
    const currentAmount = hotelInterior.price;
    const expectedDelta = currentAmount - baselineAmount;
    const expectedExpenseDelta =
      Math.floor(currentAmount * 0.15) - Math.floor(baselineAmount * 0.15);

    expect(result.has_changes).toBe(true);
    expect(interior.delta_line).toBe(expectedDelta);
    expect(interior.delta_expense).toBe(expectedExpenseDelta);
    expect(interior.total).toBe(287_500 + expectedDelta + expectedExpenseDelta);

    const expectedRaw = 1_000_550 + expectedDelta + expectedExpenseDelta;
    const expectedSubtotal = Math.floor(expectedRaw / 1000) * 1000;
    expect(result.pricing.subtotal_raw).toBe(expectedRaw);
    expect(result.pricing.subtotal).toBe(expectedSubtotal);
    expect(result.pricing.total).toBe(expectedSubtotal + Math.floor(expectedSubtotal * 0.1));
  });

  it('内外装の造作工事は変更差額でも内外装工事として集計する', () => {
    const carpentry = seedOptions.find((row) => row.code === 'carpentry-full-wing')!;
    const withCarpentry: EstimateTemplateBundle = {
      ...template,
      template: {
        ...template.template,
        baseline_option_ids: [standardInterior.id, carpentry.id],
      },
      baseline_option_ids: [standardInterior.id, carpentry.id],
    };

    const result = computeStandardEstimatePricing(
      bundle,
      withCarpentry,
      [standardInterior.id, carpentry.id],
      [],
      [],
      'full'
    );
    const interior = result.sections.find((row) => row.code === 'interior_exterior')!;

    expect(interior.delta_line).toBe(0);
    expect(result.has_changes).toBe(false);
  });
});
