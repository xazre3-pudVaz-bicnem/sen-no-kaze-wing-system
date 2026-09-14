import { describe, expect, it } from 'vitest';
import type { ProductOption } from '@/lib/domain/types';
import {
  defaultEstimateLinkPolicy,
  estimateLineFingerprint,
  findExactEstimateProductMatch,
  inferEstimateCategoryCode,
  rankEstimateProductCandidates,
} from '@/lib/domain/estimate-product-matching';

function option(patch: Partial<ProductOption> & Pick<ProductOption, 'id' | 'category_id' | 'code' | 'name'>): ProductOption {
  return {
    base_model_id: null,
    description: null,
    price: 300000,
    image_url: null,
    selection_type: 'radio',
    is_required: false,
    is_default: false,
    is_installation: false,
    price_on_request: false,
    spec_codes: [],
    owner_id: null,
    manufacturer: null,
    model_no: null,
    size_note: null,
    list_price: null,
    highlight: null,
    preview_key: null,
    affects_views: [],
    sort_order: 1,
    status: 'published',
    created_at: '2026-09-11T00:00:00Z',
    updated_at: '2026-09-11T00:00:00Z',
    ...patch,
  };
}

describe('標準見積の商品マスター照合', () => {
  const baseLine = {
    section_code: 'option' as const,
    group_label: '１．設備機器',
    name: 'TOTO ユニットバス サザナ HTV1216 1216',
    unit: '台',
    remark: null,
  };

  it('商品種別を判定し、設備商品は既定で必須にする', () => {
    expect(inferEstimateCategoryCode(baseLine)).toBe('ub');
    expect(defaultEstimateLinkPolicy('ub', 'option')).toBe('required');
    expect(defaultEstimateLinkPolicy('sitework', 'sitework')).toBe('none');
  });

  it('カテゴリの手動修正をしても同じExcel行のfingerprintは維持する', () => {
    expect(estimateLineFingerprint(baseLine, 'ub')).toBe(estimateLineFingerprint(baseLine, 'washbasin'));
  });

  it('メーカー＋型番が一意に完全一致した場合だけ自動確定する', () => {
    const options = [
      option({
        id: '1',
        category_id: 'ub-cat',
        code: 'sazana-1216',
        name: 'サザナ Sタイプ 1216',
        manufacturer: 'TOTO',
        model_no: 'HTV1216',
        size_note: '1216',
      }),
      option({
        id: '2',
        category_id: 'ub-cat',
        code: 'other-1216',
        name: '別シリーズ 1216',
        manufacturer: 'LIXIL',
        model_no: 'LIX1216',
        size_note: '1216',
      }),
    ];

    const exact = findExactEstimateProductMatch({
      sourceText: 'TOTO サザナ HTV1216 1216',
      options,
      categoryId: 'ub-cat',
      baseModelId: 'wing',
    });
    expect(exact?.option.id).toBe('1');
    expect(exact?.reason).toBe('メーカー＋型番完全一致');

    expect(
      findExactEstimateProductMatch({
        sourceText: 'TOTO サザナ 1216',
        options,
        categoryId: 'ub-cat',
        baseModelId: 'wing',
      })
    ).toBeNull();
  });

  it('名称・メーカー・サイズ一致は候補として順位付けし、自動確定にはしない', () => {
    const options = [
      option({
        id: '1',
        category_id: 'ub-cat',
        code: 'sazana-1216',
        name: 'TOTO サザナ Sタイプ 1216',
        manufacturer: 'TOTO',
        size_note: '1216',
      }),
      option({
        id: '2',
        category_id: 'ub-cat',
        code: 'other',
        name: '別メーカー ユニットバス',
      }),
    ];

    const candidates = rankEstimateProductCandidates({
      sourceText: 'TOTO サザナ 1216',
      options,
      categoryId: 'ub-cat',
      baseModelId: 'wing',
    });
    expect(candidates[0]?.option.id).toBe('1');
    expect(candidates[0]?.reasons).toContain('メーカー一致');
  });
});
