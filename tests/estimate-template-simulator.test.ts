import { describe, expect, it } from 'vitest';
import {
  estimateBaselineOptionCodes,
  estimateTemplatesFor,
  finishLevelForEstimateSpec,
  simulatorEstimateChoices,
} from '@/lib/domain/estimate-template';
import type { EstimateTemplateBundle } from '@/lib/domain/types';
import { seedModels } from '@/lib/seed/catalog';

function estimateBundle(
  baseModelId: string,
  specCode: string,
  name: string,
  sourceSheetName: string
): EstimateTemplateBundle {
  return {
    template: {
      id: `template-${specCode}`,
      base_model_id: baseModelId,
      spec_code: specCode,
      name,
      source_file_name: 'standard.xlsx',
      source_sheet_name: sourceSheetName,
      source_sha256: 'test',
      baseline_option_ids: [],
      tax_rate: 0.1,
      subtotal_raw: 1000000,
      adjustment: 0,
      subtotal: 1000000,
      tax: 100000,
      total: 1100000,
      imported_at: '2026-09-14T00:00:00.000Z',
      updated_at: '2026-09-14T00:00:00.000Z',
    },
    sections: [],
    lines: [],
    base_breakdown_items: [],
    baseline_option_ids: [],
  };
}

describe('シミュレーターの標準見積仕様', () => {
  // BOXはExcelの仕様体系を正本とする。
  it('本体のみはshell、用途別標準見積はfullで開始する', () => {
    expect(finishLevelForEstimateSpec('base')).toBe('shell');
    expect(finishLevelForEstimateSpec('hotel')).toBe('full');
    expect(finishLevelForEstimateSpec('water-kit')).toBe('full');
    expect(finishLevelForEstimateSpec('office')).toBe('full');
  });

  it('BOXは実物Excelに合わせて本体・ホテル単身者・水回りキットを使う', () => {
    const box = seedModels.find((model) => model.slug === 'box')!;
    expect(estimateTemplatesFor(box).map((choice) => [choice.code, choice.name])).toEqual([
      ['base', '本体のみ'],
      ['hotel-single', 'ホテル・単身者用'],
      ['water-kit', '水回りキット'],
    ]);

    expect(estimateBaselineOptionCodes(box, 'base')).toEqual([]);
    expect(estimateBaselineOptionCodes(box, 'water-kit')).toEqual([
      'interior-standard-box',
      'carpentry-box',
      'ub-1216',
      'toilet-washlet',
      'mini-kitchen',
      'gas-boiler-16',
      'aircon',
    ]);
  });

  it('管理画面で追加された新仕様もシミュレーターの仕様ボタンへ自動追加する', () => {
    const wing = seedModels.find((model) => model.slug === 'wing-01')!;
    const choices = simulatorEstimateChoices(wing, [
      estimateBundle(wing.id, 'premium-stay', 'プレミアム宿泊仕様', 'ウィング【プレミアム】'),
    ]);

    expect(choices.map((choice) => choice.code)).toEqual([
      'base',
      'hotel',
      'residence',
      'office',
      'premium-stay',
    ]);
    expect(choices.find((choice) => choice.code === 'premium-stay')).toMatchObject({
      name: 'プレミアム宿泊仕様',
      description: 'Excel標準見積：ウィング【プレミアム】',
    });
  });

  it('登録済み標準見積は既知仕様でも管理画面の名称を優先する', () => {
    const flat = seedModels.find((model) => model.slug === 'flat')!;
    const choices = simulatorEstimateChoices(flat, [
      estimateBundle(flat.id, 'base', 'Flat 本体のみ', 'フラット (本体)'),
      estimateBundle(flat.id, 'office', 'オフィス標準仕様', 'フラット (物置事務所)'),
    ]);

    expect(choices.map((choice) => [choice.code, choice.name])).toEqual([
      ['base', 'Flat 本体のみ'],
      ['office', 'オフィス標準仕様'],
    ]);
  });

  it('Flatは本体のみと事務所・店舗用を標準見積候補にする', () => {
    const flat = seedModels.find((model) => model.slug === 'flat')!;
    expect(estimateTemplatesFor(flat).map((choice) => [choice.code, choice.name])).toEqual([
      ['base', '本体のみ'],
      ['office', '事務所・店舗用'],
    ]);
    expect(estimateBaselineOptionCodes(flat, 'office')).toContain('carpentry-flat');
  });
});
