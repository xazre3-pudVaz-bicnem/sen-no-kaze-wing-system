import { describe, expect, it } from 'vitest';
import {
  estimateBaselineOptionCodes,
  estimateTemplatesFor,
  finishLevelForEstimateSpec,
} from '@/lib/domain/estimate-template';
import { seedModels } from '@/lib/seed/catalog';

describe('シミュレーターの標準見積仕様', () => {
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

  it('Flatは本体のみと事務所・店舗用を標準見積候補にする', () => {
    const flat = seedModels.find((model) => model.slug === 'flat')!;
    expect(estimateTemplatesFor(flat).map((choice) => [choice.code, choice.name])).toEqual([
      ['base', '本体のみ'],
      ['office', '事務所・店舗用'],
    ]);
    expect(estimateBaselineOptionCodes(flat, 'office')).toContain('carpentry-flat');
  });
});
