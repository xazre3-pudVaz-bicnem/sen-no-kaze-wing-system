import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { optionSchema } from '@/lib/validation';

const baseOption = {
  id: null,
  base_model_id: null,
  category_id: '00000000-0000-4000-8000-000000000001',
  code: 'test-option',
  name: 'テスト商品',
  description: '',
  price: 0,
  image_url: '',
  selection_type: 'radio',
  is_required: false,
  is_default: false,
  is_installation: false,
  price_on_request: false,
  preview_key: '',
  affects_views: [],
  spec_codes: [],
  sort_order: 0,
  status: 'draft',
  owner_id: '',
  manufacturer: '',
  model_no: '',
  size_note: '',
  list_price: '',
};

describe('メーカー記載の特徴', () => {
  it('80文字まで保存でき、81文字は拒否する', () => {
    expect(optionSchema.safeParse({ ...baseOption, highlight: 'あ'.repeat(80) }).success).toBe(true);
    expect(optionSchema.safeParse({ ...baseOption, highlight: 'あ'.repeat(81) }).success).toBe(false);
  });

  it('商品登録画面でも80文字上限と文字数表示を設定する', () => {
    const source = readFileSync('components/admin/option-registration-ui-enhancer.tsx', 'utf8');
    expect(source).toContain('const HIGHLIGHT_MAX_LENGTH = 80;');
    expect(source).toContain('input.maxLength = HIGHLIGHT_MAX_LENGTH;');
    expect(source).toContain('${input.value.length}/${HIGHLIGHT_MAX_LENGTH}文字');
  });
});
