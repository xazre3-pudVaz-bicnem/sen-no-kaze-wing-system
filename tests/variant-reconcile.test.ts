import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pruneHiddenVariantChoices, reconcileVariantChoices } from '@/lib/domain/preset';
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

/** 浴室（壁プラン → 壁色）と洗面（扉色）。今の商品台帳にあるのはここに並べたものだけ */
const groups = [
  g({ id: 'bath-plan', option_id: 'bath', code: 'wall-plan', name: '壁プラン', sort_order: 1 }),
  g({ id: 'bath-color', option_id: 'bath', code: 'wall-color', name: '壁色', sort_order: 2, depends_on_group_code: 'wall-plan', depends_on_choice_codes: ['accent'] }),
  g({ id: 'wash-door', option_id: 'wash', code: 'door-color', name: '扉色', sort_order: 1 }),
];
const choices = [
  c({ id: 'white', group_id: 'bath-plan', code: 'full-white', name: '全面ホワイト', kind: 'standard', sort_order: 1 }),
  c({ id: 'accent', group_id: 'bath-plan', code: 'accent', name: 'アクセント1面', sort_order: 2 }),
  c({ id: 'beige', group_id: 'bath-color', code: 'beige', name: 'ベージュ', kind: 'standard', sort_order: 1 }),
  c({ id: 'oak', group_id: 'bath-color', code: 'oak', name: 'オーク', sort_order: 2 }),
  c({ id: 'door-white', group_id: 'wash-door', code: 'white', name: 'ホワイト', kind: 'standard', sort_order: 1 }),
  c({ id: 'door-gray', group_id: 'wash-door', code: 'gray', name: 'グレー', sort_order: 2 }),
];

describe('保存しておいた選択肢を、今の商品台帳に合わせて整える', () => {
  it('今も選べる選択肢はそのまま残す', () => {
    expect(reconcileVariantChoices(groups, choices, ['bath', 'wash'], ['accent', 'oak', 'door-gray'])).toEqual(['accent', 'oak', 'door-gray']);
  });

  it('台帳から外れた選択肢は外し、その項目は標準の選択肢で補う', () => {
    // 保存したときの扉色（deleted-door）は、その後に台帳から削除された
    expect(reconcileVariantChoices(groups, choices, ['bath', 'wash'], ['accent', 'oak', 'deleted-door'])).toEqual(['accent', 'oak', 'door-white']);
  });

  it('商品ごと台帳から外れた場合は、その商品の選択肢をすべて外す', () => {
    // 洗面（wash）が削除され、選択からも外れた。選択肢 ID は台帳に残っていても、選んでいない商品のものは保存できない
    expect(reconcileVariantChoices(groups, choices, ['bath'], ['white', 'door-gray'])).toEqual(['white']);
    // 選択肢の行ごと消えている場合（商品の削除で選択項目も消える）
    const withoutWash = { groups: groups.filter((x) => x.option_id !== 'wash'), choices: choices.filter((x) => x.group_id !== 'wash-door') };
    expect(reconcileVariantChoices(withoutWash.groups, withoutWash.choices, ['bath'], ['white', 'door-gray'])).toEqual(['white']);
  });

  it('表示条件を満たさなくなった項目の選択肢は外す（壁プランが標準なら壁色は持たない）', () => {
    expect(reconcileVariantChoices(groups, choices, ['bath'], ['white', 'oak'])).toEqual(['white']);
    // 壁プランの選択肢が消えて標準へ戻った場合も、壁色は外れる
    expect(reconcileVariantChoices(groups, choices, ['bath'], ['deleted-plan', 'oak'])).toEqual(['white']);
  });

  it('選択肢が 1 つも保存されていない商品は、標準の選択肢で始める', () => {
    expect(reconcileVariantChoices(groups, choices, ['bath', 'wash'], [])).toEqual(['white', 'door-white']);
  });

  it('従来の整理（表示条件だけ）では、台帳に無い選択肢が残ってしまう', () => {
    // この差が、開き直したプランを保存できない原因だった（DB 側の検証が「選択できないバリエーション」として拒否する）
    expect(pruneHiddenVariantChoices(groups, choices, ['white', 'deleted-door'])).toEqual(['white', 'deleted-door']);
  });
});

describe('シミュレーターの開き直し', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'components/simulator/simulator-app.tsx'), 'utf8');

  it('保存したプラン・一時保存（編集できるもの）と、ブラウザの下書きの両方で選択肢を整える', () => {
    expect(source).toContain('reconcileVariantChoices(bundle.variantGroups, bundle.variantChoices, initialSelection, initial.variant_choice_ids)');
    expect(source).toMatch(/reconcileVariantChoices\(\s*bundle\.variantGroups,\s*bundle\.variantChoices,\s*restoredSelection,\s*draft\.variantIds \?\? \[\]\s*\)/);
  });

  it('見積依頼済みなどの読み取り専用の履歴は、保存された選択肢のまま表示する', () => {
    expect(source).toContain('initial && !preserveReadOnlyHistoricalSelection');
  });
});
