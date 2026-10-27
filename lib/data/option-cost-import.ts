import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { seedOptions } from '@/lib/seed/catalog';
import { getCostRecordingAccess } from '@/lib/data/option-cost-recording';

/**
 * 既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む前の一覧（v2.5 PR-A3）。本部だけ。
 * 決まりは import_option_standard_costs（20261027100000）と同じ。画面で確かめた金額を、そのまま RPC に渡す。
 */

export type CostImportProductState =
  /** 取り込む（初期値で選ぶ） */
  | 'import'
  /** 8 月の初期データの仮の商品（初期値では選ばない。選べば取り込める） */
  | 'seed'
  /** 取扱終了（初期値では選ばない。選べば取り込める） */
  | 'archived'
  /** 記録と同じ金額（何もしない） */
  | 'same'
  /** 0 円・未設定（取り込まない。価格未確認の 0 円と区別できないため） */
  | 'zero'
  /** 別途見積（取り込まない） */
  | 'por';

export type CostImportChoiceState = 'import' | 'same' | 'por';

export type CostImportChoice = {
  id: string;
  name: string;
  groupName: string;
  amount: number;
  currentAmount: number | null;
  state: CostImportChoiceState;
};

export type CostImportProduct = {
  id: string;
  productNo: string | null;
  name: string;
  categoryName: string;
  amount: number | null;
  currentAmount: number | null;
  state: CostImportProductState;
  choices: CostImportChoice[];
};

export type CostImportCandidates =
  | { available: false; reason: 'unavailable' | 'forbidden' }
  | { available: true; products: CostImportProduct[] };

const SEED_OPTION_IDS = new Set(seedOptions.map((option) => option.id));

/** 商品の状態を決める（画面と単体テストで同じ決まりを使う） */
export function costImportProductState(input: {
  id: string;
  priceOnRequest: boolean;
  amount: number | null;
  currentAmount: number | null;
  archived: boolean;
}): CostImportProductState {
  if (input.priceOnRequest) return 'por';
  if (input.amount === null || input.amount <= 0) return 'zero';
  if (input.currentAmount !== null && input.currentAmount === input.amount) return 'same';
  if (SEED_OPTION_IDS.has(input.id)) return 'seed';
  if (input.archived) return 'archived';
  return 'import';
}

export function costImportChoiceState(input: { priceOnRequest: boolean; amount: number; currentAmount: number | null }): CostImportChoiceState {
  if (input.priceOnRequest) return 'por';
  if (input.currentAmount !== null && input.currentAmount === input.amount) return 'same';
  return 'import';
}

export async function loadCostImportCandidates(): Promise<CostImportCandidates> {
  const access = await getCostRecordingAccess();
  if (!access.available) return { available: false, reason: 'unavailable' };
  if (!access.canManage) return { available: false, reason: 'forbidden' };

  const db = await createClient();
  const [options, categories, groups] = await Promise.all([
    db
      .from('options')
      .select('id, product_no, name, category_id, price, price_on_request, archived_at, sort_order')
      .eq('status', 'published')
      .order('sort_order'),
    db.from('option_categories').select('id, name, sort_order'),
    db.from('option_variant_groups').select('id, option_id, name, sort_order'),
  ]);
  if (options.error) throw new Error(`商品の取得に失敗しました: ${options.error.code ?? 'unknown'}`);
  if (categories.error) throw new Error(`カテゴリーの取得に失敗しました: ${categories.error.code ?? 'unknown'}`);
  if (groups.error) throw new Error(`選択項目の取得に失敗しました: ${groups.error.code ?? 'unknown'}`);

  const optionRows = options.data ?? [];
  const optionIds = optionRows.map((row) => row.id as string);
  const optionIdSet = new Set(optionIds);
  const groupRows = (groups.data ?? []).filter((row) => optionIdSet.has(row.option_id as string));
  const groupIds = groupRows.map((row) => row.id as string);

  const [choices, productVersions] = await Promise.all([
    // 件数が少ない表なので、URL が長くならないよう id で絞らずに読んでから絞る
    db.from('option_variant_choices').select('id, group_id, name, extra_price, price_on_request, sort_order'),
    db.from('option_standard_cost_versions').select('option_id, standard_cost').is('superseded_at', null),
  ]);
  if (choices.error) throw new Error(`選択肢の取得に失敗しました: ${choices.error.code ?? 'unknown'}`);
  if (productVersions.error) throw new Error(`原価の記録の取得に失敗しました: ${productVersions.error.code ?? 'unknown'}`);
  const groupIdSet = new Set(groupIds);
  const choiceRows = (choices.data ?? []).filter((row) => groupIdSet.has(row.group_id as string));
  const choiceVersions = await db
    .from('option_variant_cost_versions')
    .select('variant_choice_id, cost_adjustment')
    .is('superseded_at', null);
  if (choiceVersions.error) throw new Error(`原価差額の記録の取得に失敗しました: ${choiceVersions.error.code ?? 'unknown'}`);

  const categoryName = new Map((categories.data ?? []).map((row) => [row.id as string, row.name as string]));
  const productCost = new Map((productVersions.data ?? []).map((row) => [row.option_id as string, Number(row.standard_cost)]));
  const choiceCost = new Map((choiceVersions.data ?? []).map((row) => [row.variant_choice_id as string, Number(row.cost_adjustment)]));
  const groupById = new Map(groupRows.map((row) => [row.id as string, row]));

  const products: CostImportProduct[] = optionRows.map((row) => {
    const id = row.id as string;
    const amount = row.price === null || row.price === undefined ? null : Number(row.price);
    const currentAmount = productCost.has(id) ? productCost.get(id)! : null;
    const productChoices = choiceRows
      .filter((choice) => groupById.get(choice.group_id as string)?.option_id === id)
      .sort((a, b) => {
        const ga = groupById.get(a.group_id as string);
        const gb = groupById.get(b.group_id as string);
        return Number(ga?.sort_order ?? 0) - Number(gb?.sort_order ?? 0) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      })
      .map((choice) => {
        const choiceId = choice.id as string;
        const choiceAmount = Number(choice.extra_price ?? 0);
        const current = choiceCost.has(choiceId) ? choiceCost.get(choiceId)! : null;
        return {
          id: choiceId,
          name: choice.name as string,
          groupName: (groupById.get(choice.group_id as string)?.name as string) ?? '',
          amount: choiceAmount,
          currentAmount: current,
          state: costImportChoiceState({ priceOnRequest: choice.price_on_request === true, amount: choiceAmount, currentAmount: current }),
        };
      });
    return {
      id,
      productNo: (row.product_no as string | null) ?? null,
      name: row.name as string,
      categoryName: categoryName.get(row.category_id as string) ?? '',
      amount,
      currentAmount,
      state: costImportProductState({
        id,
        priceOnRequest: row.price_on_request === true,
        amount,
        currentAmount,
        archived: Boolean(row.archived_at),
      }),
      choices: productChoices,
    };
  });
  return { available: true, products };
}
