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

/** 選ばれている商品ごとに、標準（または先頭）の選択肢を選ぶ */
export function defaultVariantIdsFor(
  variantGroups: OptionVariantGroup[],
  variantChoices: OptionVariantChoice[],
  optionIds: string[]
): string[] {
  const ids = new Set(optionIds);
  const out: string[] = [];
  for (const g of variantGroups.filter((x) => ids.has(x.option_id))) {
    const list = variantChoices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
    if (!list.length) continue;
    out.push((list.find((c) => c.kind === 'standard' || c.kind === 'fixed') ?? list[0]).id);
  }
  return out;
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
