import { describe, expect, it } from 'vitest';
import {
  BASE_ESTIMATE_SPEC_CODE,
  activeEstimateSpecCode,
  estimateTemplatesFor,
  finishLevelForEstimateSpec,
} from '@/lib/domain/estimate-template';
import { MODEL_BOX_ID, MODEL_WING01_ID, seedModels } from '@/lib/seed/catalog';

describe('標準見積の種別', () => {
  const wing = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
  const box = seedModels.find((m) => m.id === MODEL_BOX_ID)!;

  it('本体のみを用途別見積とは独立した先頭の見積種別として扱う', () => {
    expect(estimateTemplatesFor(wing).map((x) => x.code)).toEqual([
      BASE_ESTIMATE_SPEC_CODE,
      'hotel',
      'residence',
      'office',
    ]);
    expect(estimateTemplatesFor(wing)[0].name).toBe('本体のみ');
  });

  it('BOXでも本体のみは用途別 preset と混ぜずに追加される', () => {
    expect(estimateTemplatesFor(box).map((x) => x.code)).toEqual([
      BASE_ESTIMATE_SPEC_CODE,
      'hotel',
      'residence',
      'office',
    ]);
  });

  it('旧 shell 保存データは本体のみ見積として解釈する', () => {
    expect(activeEstimateSpecCode('shell', 'hotel')).toBe(BASE_ESTIMATE_SPEC_CODE);
    expect(activeEstimateSpecCode('full', 'hotel')).toBe('hotel');
  });

  it('本体のみは shell、用途別見積は full として保存互換を維持する', () => {
    expect(finishLevelForEstimateSpec(BASE_ESTIMATE_SPEC_CODE)).toBe('shell');
    expect(finishLevelForEstimateSpec('hotel')).toBe('full');
    expect(finishLevelForEstimateSpec('residence')).toBe('full');
  });
});
