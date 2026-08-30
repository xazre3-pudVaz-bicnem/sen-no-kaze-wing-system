import { describe, expect, it } from 'vitest';
import {
  EXTERIOR_FACES,
  exteriorFaceForElevation,
  makeDefaultExteriorFaces,
  normalizeExteriorFaces,
} from '@/lib/domain/exterior-wall';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';

const option = (id: string): ProductOption => ({
  id,
  base_model_id: null,
  category_id: 'wall-cat',
  code: id,
  name: id,
  description: null,
  price: 0,
  image_url: null,
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: true,
  spec_codes: [],
  owner_id: null,
  manufacturer: null,
  model_no: null,
  size_note: null,
  list_price: null,
  highlight: null,
  preview_key: null,
  affects_views: [],
  sort_order: 0,
  status: 'published',
  created_at: '',
  updated_at: '',
});

const group: OptionVariantGroup = {
  id: 'g1', option_id: 'wall-a', code: 'color', name: '色', note: null,
  sort_order: 0, is_required: true, status: 'published',
};
const choice: OptionVariantChoice = {
  id: 'black', group_id: 'g1', code: 'black', name: '黒', kind: 'standard',
  extra_price: 0, price_on_request: true, image_url: null, note: null, sort_order: 0, status: 'published',
};

describe('外壁4面', () => {
  it('立面図ラベルから4面を判定する', () => {
    expect(exteriorFaceForElevation('南立面図', 0)).toBe('front');
    expect(exteriorFaceForElevation('東立面図', 1)).toBe('right');
    expect(exteriorFaceForElevation('北立面図', 2)).toBe('back');
    expect(exteriorFaceForElevation('西立面図', 3)).toBe('left');
  });

  it('従来の1面選択から4面同一の初期値を作れる', () => {
    const faces = makeDefaultExteriorFaces([option('wall-a')], [group], [choice], ['wall-a'], ['black']);
    expect(faces.map((f) => f.face_code)).toEqual(EXTERIOR_FACES.map((f) => f.code));
    expect(faces.every((f) => f.option_id === 'wall-a')).toBe(true);
    expect(faces.every((f) => f.variant_choice_ids[0] === 'black')).toBe(true);
  });

  it('4面の別商品指定を保持する', () => {
    const options = [option('wall-a'), option('wall-b')];
    const input = [
      { face_code: 'front' as const, option_id: 'wall-a', variant_choice_ids: ['black'] },
      { face_code: 'right' as const, option_id: 'wall-b', variant_choice_ids: [] },
      { face_code: 'back' as const, option_id: 'wall-b', variant_choice_ids: [] },
      { face_code: 'left' as const, option_id: 'wall-a', variant_choice_ids: ['black'] },
    ];
    const faces = normalizeExteriorFaces(input, options, [group], [choice], ['wall-a'], ['black']);
    expect(faces.map((f) => f.option_id)).toEqual(['wall-a', 'wall-b', 'wall-b', 'wall-a']);
  });
});
