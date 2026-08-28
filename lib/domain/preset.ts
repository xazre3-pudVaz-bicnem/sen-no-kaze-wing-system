import type { CatalogBundle, ModelPreset, OptionVariantChoice, OptionVariantGroup } from './types';
import { defaultSelection, toggleOption, type RuleContext } from './rules';

/**
 * 仕様（プラン）の標準構成を、選択ルール（依存・競合・必須）を通しながら組み立てる。
 * シミュレーターの初期選択と、スタッフの「新規見積作成」で共用する。
 */
export function buildPresetSelection(ctx: RuleContext, preset: ModelPreset, defaults: string[] = defaultSelection(ctx)): string[] {
  const byCode = new Map(ctx.options.map((o) => [o.code, o.id]));
  let cur: string[] = [];
  for (const code of preset.option_codes) {
    const oid = byCode.get(code);
    if (!oid) continue;
    const r = toggleOption(ctx, cur, oid);
    if (!r.rejected) cur = r.next;
  }
  // 必須カテゴリー・必須商品の不足分を既定値から補う
  for (const oid of defaults) {
    if (cur.includes(oid)) continue;
    const o = ctx.options.find((x) => x.id === oid);
    const cat = ctx.categories.find((c) => c.id === o?.category_id);
    const hasCat = cur.some((x) => ctx.options.find((y) => y.id === x)?.category_id === cat?.id);
    if (o?.is_required || (cat?.is_required && !hasCat)) {
      const r = toggleOption(ctx, cur, oid);
      if (!r.rejected) cur = r.next;
    }
  }
  return [...new Set(cur)];
}

/**
 * 表示条件を満たす選択項目だけを返す。
 * 例）壁色は、同じ商品の壁プランでアクセント1面／2面が選ばれているときだけ表示（先方指示）。
 */
export function visibleVariantGroups(
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  selectedChoiceIds: string[]
): OptionVariantGroup[] {
  const selected = new Set(selectedChoiceIds);
  return groups.filter((g) => {
    const dep = g.depends_on_group_code;
    if (!dep) return true;
    const parent = groups.find((x) => x.option_id === g.option_id && x.code === dep);
    if (!parent) return true;
    const want = new Set(g.depends_on_choice_codes ?? []);
    if (want.size === 0) return true;
    return choices.some((c) => c.group_id === parent.id && selected.has(c.id) && want.has(c.code));
  });
}

/** 表示条件を満たさなくなった選択項目の選択肢を取り除く（「表示が消えたら選択も消える」） */
export function pruneHiddenVariantChoices(
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  selectedChoiceIds: string[]
): string[] {
  let cur = [...new Set(selectedChoiceIds)];
  // 依存が連鎖しても安定するまで繰り返す（通常 1〜2 回で収束）
  for (let i = 0; i < 5; i++) {
    const visible = new Set(visibleVariantGroups(groups, choices, cur).map((g) => g.id));
    const next = cur.filter((id) => {
      const gid = choices.find((c) => c.id === id)?.group_id;
      return !gid || visible.has(gid);
    });
    if (next.length === cur.length) return next;
    cur = next;
  }
  return cur;
}

/** 選ばれている商品ごとに、標準（または先頭）の選択肢を選ぶ。表示条件を満たさない項目は選ばない */
export function defaultVariantIdsFor(
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[],
  optionIds: string[]
): string[] {
  const ids = new Set(optionIds);
  const mine = variantGroups.filter((x) => ids.has(x.option_id));
  const out: string[] = [];
  for (const g of mine) {
    const list = variantChoices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
    if (!list.length) continue;
    out.push((list.find((c) => c.kind === 'standard' || c.kind === 'fixed') ?? list[0]).id);
  }
  return pruneHiddenVariantChoices(mine, variantChoices, out);
}

/** 現在の仕様の本体内訳（見積書・シミュレーターの本体明細表示に使う） */
export function baseBreakdownFor(bundle: Pick<CatalogBundle, 'baseBreakdowns'>, specCode: string | null) {
  return (bundle.baseBreakdowns ?? []).filter((b) => b.spec_code === (specCode ?? ''));
}

/** 本体内訳の合計。内訳がなければ null（モデルの base_price を使う） */
export function baseBreakdownTotal(bundle: Pick<CatalogBundle, 'baseBreakdowns'>, specCode: string | null): number | null {
  const rows = baseBreakdownFor(bundle, specCode);
  return rows.length ? rows.reduce((s, b) => s + b.amount, 0) : null;
}
