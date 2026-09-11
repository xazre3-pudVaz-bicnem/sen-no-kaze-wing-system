import { describe, expect, it } from 'vitest';
import { BASE_ESTIMATE_SPEC_CODE, estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { MODEL_BOX_ID, MODEL_WING01_ID, seedModels } from '@/lib/seed/catalog';

describe('標準見積の表示候補', () => {
  const wing = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
  const box = seedModels.find((m) => m.id === MODEL_BOX_ID)!;

  it('Wing は本体のみを用途別 preset と独立した先頭候補にする', () => {
    expect(estimateTemplatesFor(wing).map((x) => x.code)).toEqual([
      BASE_ESTIMATE_SPEC_CODE,
      'hotel',
      'residence',
      'office',
    ]);
    expect(estimateTemplatesFor(wing)[0].preset).toBeNull();
  });

  it('BOX は旧 preset ではなく実物Excelの3標準見積を候補にする', () => {
    const choices = estimateTemplatesFor(box);
    expect(choices.map((x) => x.code)).toEqual([
      BASE_ESTIMATE_SPEC_CODE,
      'hotel-single',
      'water-kit',
    ]);
    expect(choices.map((x) => x.name)).toEqual([
      '本体のみ',
      'ホテル・単身者用',
      '水回りキット',
    ]);
    expect(choices.every((x) => x.preset === null)).toBe(true);
  });
});
