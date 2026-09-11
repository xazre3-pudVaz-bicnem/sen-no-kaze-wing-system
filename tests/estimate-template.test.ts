import { describe, expect, it } from 'vitest';
import { BASE_ESTIMATE_SPEC_CODE, estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { MODEL_BOX_ID, MODEL_WING01_ID, seedModels } from '@/lib/seed/catalog';

describe('標準見積の表示候補', () => {
  const wing = seedModels.find((m) => m.id === MODEL_WING01_ID)!;
  const box = seedModels.find((m) => m.id === MODEL_BOX_ID)!;

  it('本体のみを用途別 preset と独立した先頭候補にする', () => {
    expect(estimateTemplatesFor(wing).map((x) => x.code)).toEqual([
      BASE_ESTIMATE_SPEC_CODE,
      'hotel',
      'residence',
      'office',
    ]);
    expect(estimateTemplatesFor(wing)[0].preset).toBeNull();
  });

  it('候補生成は価格を持たず、既存 preset の名称だけを引き継ぐ', () => {
    const choices = estimateTemplatesFor(box);
    expect(choices.map((x) => x.name)).toEqual(['本体のみ', 'ホテル仕様', '住宅仕様', '事務所・店舗用']);
    expect(choices.find((x) => x.code === 'hotel')?.preset?.option_codes.length).toBeGreaterThan(0);
  });
});
