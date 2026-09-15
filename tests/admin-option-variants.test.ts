import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { variantChoiceSchema, variantGroupSchema } from '@/lib/validation';

const manager = fs.readFileSync(
  path.resolve(process.cwd(), 'components/admin/option-variant-manager.tsx'),
  'utf8'
);
const actions = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/actions/admin.ts'),
  'utf8'
);
const editPage = fs.readFileSync(
  path.resolve(process.cwd(), 'app/admin/options/[id]/page.tsx'),
  'utf8'
);

describe('管理画面の色・仕様管理', () => {
  it('選択項目の入力を検証する', () => {
    const parsed = variantGroupSchema.safeParse({
      id: null,
      option_id: '11111111-1111-4111-8111-111111111111',
      code: 'wall-color',
      name: '壁色',
      note: '',
      depends_on_group_code: '',
      depends_on_choice_codes: [],
      sort_order: 0,
      is_required: 'on',
      status: 'published',
    });
    expect(parsed.success).toBe(true);

    const invalid = variantGroupSchema.safeParse({
      id: null,
      option_id: '11111111-1111-4111-8111-111111111111',
      code: '壁色',
      name: '壁色',
      note: '',
      depends_on_group_code: '',
      depends_on_choice_codes: [],
      sort_order: 0,
      is_required: 'on',
      status: 'published',
    });
    expect(invalid.success).toBe(false);
  });

  it('選択肢の追加金額は0円以上に限定する', () => {
    const base = {
      id: null,
      option_id: '11111111-1111-4111-8111-111111111111',
      group_id: '22222222-2222-4222-8222-222222222222',
      code: 'white',
      name: 'ホワイト',
      kind: 'standard',
      price_on_request: false,
      image_url: '',
      note: '',
      sort_order: 0,
      status: 'published',
    };
    expect(variantChoiceSchema.safeParse({ ...base, extra_price: 0 }).success).toBe(true);
    expect(variantChoiceSchema.safeParse({ ...base, extra_price: -1 }).success).toBe(false);
  });

  it('商品編集画面から色・仕様管理へ接続する', () => {
    expect(editPage).toContain('OptionVariantManager');
    expect(editPage).toContain('store.getOptionVariants(id)');
    expect(manager).toContain('2. お客様表示・選択');
    expect(manager).toContain('追加金額（税別・円）');
    expect(manager).toContain('表示条件（必要な場合だけ）');
  });

  it('履歴保護のため物理削除ではなく非公開を使う', () => {
    expect(manager).toContain('物理削除を行いません');
    expect(manager).toContain('<option value="draft">非公開</option>');
    expect(actions).not.toContain('deleteVariantChoiceAction');
    expect(actions).not.toContain('deleteVariantGroupAction');
  });

  it('登録後のコード変更と複数標準をサーバー側でも防ぐ', () => {
    expect(actions).toContain('登録後のコードは変更できません');
    expect(actions).toContain('標準の選択肢は1項目につき1つだけです');
    expect(actions).toContain('表示条件に使われているため');
  });
});
