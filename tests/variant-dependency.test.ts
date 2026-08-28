import { describe, expect, it } from 'vitest';
import { defaultVariantIdsFor, pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { seedVariantChoices, seedVariantGroups } from '@/lib/seed/catalog';
import type { OptionVariantChoice, OptionVariantGroup } from '@/lib/domain/types';

const g = (p: Partial<OptionVariantGroup> & Pick<OptionVariantGroup, 'id' | 'option_id' | 'code' | 'name'>): OptionVariantGroup => ({
  note: null,
  sort_order: 0,
  is_required: true,
  status: 'published',
  ...p,
});
const c = (p: Partial<OptionVariantChoice> & Pick<OptionVariantChoice, 'id' | 'group_id' | 'code' | 'name'>): OptionVariantChoice => ({
  kind: 'option',
  extra_price: 0,
  price_on_request: false,
  image_url: null,
  note: null,
  sort_order: 0,
  status: 'published',
  ...p,
});

/** 壁プラン（標準=全面ホワイト）→ 壁色（アクセント選択時のみ表示）の最小構成 */
const groups = [
  g({ id: 'gp', option_id: 'o1', code: 'wall-plan', name: '壁プラン', sort_order: 1 }),
  g({ id: 'gc', option_id: 'o1', code: 'wall-color', name: '壁色', sort_order: 2, depends_on_group_code: 'wall-plan', depends_on_choice_codes: ['accent', 'accent-2'] }),
];
const choices = [
  c({ id: 'white', group_id: 'gp', code: 'full-white', name: '全面ホワイト', kind: 'standard' }),
  c({ id: 'a1', group_id: 'gp', code: 'accent', name: 'アクセント1面' }),
  c({ id: 'a2', group_id: 'gp', code: 'accent-2', name: 'アクセント2面' }),
  c({ id: 'beige', group_id: 'gc', code: 'emboss-beige', name: 'エンボスベージュ', kind: 'standard' }),
  c({ id: 'oak', group_id: 'gc', code: 'oak-greige', name: 'オークグレージュ' }),
];

describe('選択項目の表示条件（壁プラン → 壁色）', () => {
  it('全面ホワイトのときは壁色が表示されない', () => {
    const visible = visibleVariantGroups(groups, choices, ['white']);
    expect(visible.map((x) => x.code)).toEqual(['wall-plan']);
  });

  it('アクセント1面・2面を選ぶと壁色が表示される', () => {
    expect(visibleVariantGroups(groups, choices, ['a1']).map((x) => x.code)).toEqual(['wall-plan', 'wall-color']);
    expect(visibleVariantGroups(groups, choices, ['a2']).map((x) => x.code)).toEqual(['wall-plan', 'wall-color']);
  });

  it('全面ホワイトに戻すと、選ばれていた壁色は自動で外れる', () => {
    expect(pruneHiddenVariantChoices(groups, choices, ['white', 'oak'])).toEqual(['white']);
    expect(pruneHiddenVariantChoices(groups, choices, ['a1', 'oak'])).toEqual(['a1', 'oak']);
  });

  it('既定選択は表示条件を満たす項目だけ（壁色の標準は入らない）', () => {
    expect(defaultVariantIdsFor(groups, choices, ['o1'])).toEqual(['white']);
  });

  it('依存の指定がない項目は常に表示される', () => {
    const free = [g({ id: 'gx', option_id: 'o1', code: 'light', name: '照明' })];
    expect(visibleVariantGroups(free, [], []).length).toBe(1);
  });
});

describe('シードの表示条件', () => {
  it('浴室の壁色は壁プラン（accent / accent-2）に依存する', () => {
    const wallColors = seedVariantGroups.filter((x) => x.code === 'wall-color');
    expect(wallColors.length).toBeGreaterThan(0);
    for (const wc of wallColors) {
      expect(wc.depends_on_group_code).toBe('wall-plan');
      expect(wc.depends_on_choice_codes).toEqual(['accent', 'accent-2']);
      // 依存先の選択肢コードが実在する
      const plan = seedVariantGroups.find((x) => x.option_id === wc.option_id && x.code === 'wall-plan')!;
      const codes = seedVariantChoices.filter((ch) => ch.group_id === plan.id).map((ch) => ch.code);
      expect(codes).toEqual(expect.arrayContaining(['accent', 'accent-2']));
    }
  });
});
