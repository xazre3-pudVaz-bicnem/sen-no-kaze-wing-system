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
const supabaseStore = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/data/supabase-store.ts'),
  'utf8'
);
const localStore = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/data/local-store.ts'),
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

  it('商品編集画面から分かりやすい色・仕様管理へ接続する', () => {
    expect(editPage).toContain('OptionVariantManager');
    expect(editPage).toContain('store.getOptionVariants(id)');
    expect(manager).toContain('お客様が選べる色・仕様');
    expect(manager).toContain('＋ 色・仕様を追加');
    expect(manager).toContain('何を選びますか？');
    expect(manager).toContain('追加金額（税別・円）');
    expect(manager).toContain('標準の選択肢にする');
    expect(manager).toContain('表示条件（必要な場合だけ）');
    expect(manager).not.toContain('色・仕様ごとの追加金額');
  });

  it('未使用の色・仕様は削除でき、使用済みはサーバー側で保護する', () => {
    expect(manager).toContain('この選択肢を削除');
    expect(manager).toContain('この色・仕様を削除');
    expect(manager).toContain("allowDelete={option.status === 'draft'}");
    expect(manager).toContain('公開中の商品では選択肢を削除できません');
    expect(manager).toContain('公開中の商品では色・仕様を削除できません');
    expect(manager).toContain('公開中の商品、保存済み仕様、表示条件で使用中のものは削除できない');
    expect(manager).toContain('label="お客様に表示する"');
    expect(manager).toContain("value={customerVisible ? 'published' : 'draft'}");
    expect(actions).toContain('deleteVariantChoiceAction');
    expect(actions).toContain('deleteVariantGroupAction');
    expect(actions).toContain('await store.deleteVariantChoice(choiceId)');
    expect(actions).toContain('await store.deleteVariantGroup(groupId)');
    expect(supabaseStore).toContain(".contains('variant_choice_ids', [id])");
    expect(supabaseStore).toContain("option.data.status !== 'draft'");
    expect(supabaseStore).toContain('公開中の商品では選択肢を削除できません');
    expect(supabaseStore).toContain('選択肢が残っているため削除できません');
    expect(supabaseStore).toContain('別の選択項目の表示条件に使われているため削除できません');
    expect(localStore).toContain('item.variant_choice_ids.includes(id)');
    expect(localStore).toContain("option.status !== 'draft'");
  });

  it('色・仕様の画像プレビューは小さい固定サムネイルにする', () => {
    expect(manager).toContain('w-28 max-w-full');
    expect(manager).toContain('sm:grid-cols-[minmax(0,1fr)_7rem]');
    expect(manager).toContain('sizes="112px"');
  });

  it('技術コードを内部生成・既存保持し、複数標準もサーバー側で防ぐ', () => {
    expect(actions).toContain('code: `vg-${randomUUID()}`');
    expect(actions).toContain('code: `vc-${randomUUID()}`');
    expect(actions.match(/const internalCode = existing\?\.code \?\? parsed\.data\.code;/g)).toHaveLength(2);
    expect(actions).toContain('標準の選択肢は1項目につき1つだけです');
    expect(actions).toContain('表示条件に使われているため');
  });
});
