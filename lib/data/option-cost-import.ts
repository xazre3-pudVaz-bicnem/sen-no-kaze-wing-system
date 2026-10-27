import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCostRecordingAccess } from '@/lib/data/option-cost-recording';

/**
 * 既存の商品価格・選択肢の追加金額を、初期の原価 Version へ取り込む前の一覧（v2.5 PR-A3）。本部だけ。
 * 決まりは import_option_standard_costs（20261027100000）と同じ。画面で確かめた金額を、そのまま RPC に渡す。
 */

export type CostImportProductState =
  /** 取り込む（初期値で選ぶ） */
  | 'import'
  /**
   * メーカー・型番が未登録（初期値では選ばない。選べば取り込める）。
   * 2026-10-13 の先方の決まり「メーカー・型番が入っていて商品が確定しているものだけ原価として扱う」と同じ基準。
   * 8 月の初期データの仮の商品（「エアコン」など総称の商品）もここに入る
   */
  | 'no_model'
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
  maker: string | null;
  amount: number | null;
  currentAmount: number | null;
  state: CostImportProductState;
  choices: CostImportChoice[];
};

export type CostImportCandidates =
  | { available: false; reason: 'unavailable' | 'forbidden' | 'error' }
  | { available: true; products: CostImportProduct[] };

/** 商品の状態を決める（画面と単体テストで同じ決まりを使う） */
export function costImportProductState(input: {
  priceOnRequest: boolean;
  amount: number | null;
  currentAmount: number | null;
  archived: boolean;
  manufacturer: string | null;
  modelNo: string | null;
}): CostImportProductState {
  if (input.priceOnRequest) return 'por';
  if (input.amount === null || input.amount <= 0) return 'zero';
  if (input.currentAmount !== null && input.currentAmount === input.amount) return 'same';
  if (!input.manufacturer?.trim() || !input.modelNo?.trim()) return 'no_model';
  if (input.archived) return 'archived';
  return 'import';
}

export function costImportChoiceState(input: { priceOnRequest: boolean; amount: number; currentAmount: number | null }): CostImportChoiceState {
  if (input.priceOnRequest) return 'por';
  if (input.currentAmount !== null && input.currentAmount === input.amount) return 'same';
  return 'import';
}

type Db = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string } | null;

const PAGE_SIZE = 1000;

/** PostgREST は 1 回に返す行数に上限がある（既定 1,000 行）。黙って切れないよう、ページに分けて全件を読む */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`原価の取り込みの一覧の取得に失敗しました: ${error.code ?? 'unknown'}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

type OptionRow = {
  id: string;
  product_no: string | null;
  name: string;
  category_id: string;
  price: number | null;
  price_on_request: boolean | null;
  archived_at: string | null;
  manufacturer: string | null;
  model_no: string | null;
  sort_order: number | null;
};
type GroupRow = { id: string; option_id: string; name: string; sort_order: number | null };
type ChoiceRow = { id: string; group_id: string; name: string; extra_price: number | null; price_on_request: boolean | null; sort_order: number | null };

function readCandidates(db: Db) {
  return Promise.all([
    readAll<OptionRow>((from, to) =>
      db
        .from('options')
        .select('id, product_no, name, category_id, price, price_on_request, archived_at, manufacturer, model_no, sort_order')
        .eq('status', 'published')
        .order('id')
        .range(from, to)
    ),
    readAll<{ id: string; name: string }>((from, to) => db.from('option_categories').select('id, name').order('id').range(from, to)),
    readAll<GroupRow>((from, to) => db.from('option_variant_groups').select('id, option_id, name, sort_order').order('id').range(from, to)),
    readAll<ChoiceRow>((from, to) =>
      db.from('option_variant_choices').select('id, group_id, name, extra_price, price_on_request, sort_order').order('id').range(from, to)
    ),
    readAll<{ option_id: string; standard_cost: number }>((from, to) =>
      db.from('option_standard_cost_versions').select('option_id, standard_cost').is('superseded_at', null).order('option_id').range(from, to)
    ),
    readAll<{ variant_choice_id: string; cost_adjustment: number }>((from, to) =>
      db
        .from('option_variant_cost_versions')
        .select('variant_choice_id, cost_adjustment')
        .is('superseded_at', null)
        .order('variant_choice_id')
        .range(from, to)
    ),
  ]);
}

export async function loadCostImportCandidates(): Promise<CostImportCandidates> {
  const access = await getCostRecordingAccess();
  if (access.error) return { available: false, reason: 'error' };
  if (!access.available) return { available: false, reason: 'unavailable' };
  if (!access.canManage) return { available: false, reason: 'forbidden' };

  const db = await createClient();
  const [optionRows, categories, groups, choices, productVersions, choiceVersions] = await readCandidates(db);

  const optionIdSet = new Set(optionRows.map((row) => row.id));
  const groupRows = groups.filter((row) => optionIdSet.has(row.option_id));
  const groupById = new Map(groupRows.map((row) => [row.id, row]));
  const choiceRows = choices.filter((row) => groupById.has(row.group_id));
  const categoryName = new Map(categories.map((row) => [row.id, row.name]));
  const productCost = new Map(productVersions.map((row) => [row.option_id, Number(row.standard_cost)]));
  const choiceCost = new Map(choiceVersions.map((row) => [row.variant_choice_id, Number(row.cost_adjustment)]));

  const sortedOptions = [...optionRows].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name, 'ja'));
  const products: CostImportProduct[] = sortedOptions.map((row) => {
    const amount = row.price === null || row.price === undefined ? null : Number(row.price);
    const currentAmount = productCost.has(row.id) ? productCost.get(row.id)! : null;
    const productChoices = choiceRows
      .filter((choice) => groupById.get(choice.group_id)?.option_id === row.id)
      .sort((a, b) => {
        const ga = groupById.get(a.group_id);
        const gb = groupById.get(b.group_id);
        return Number(ga?.sort_order ?? 0) - Number(gb?.sort_order ?? 0) || Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
      })
      .map((choice) => {
        const choiceAmount = Number(choice.extra_price ?? 0);
        const current = choiceCost.has(choice.id) ? choiceCost.get(choice.id)! : null;
        return {
          id: choice.id,
          name: choice.name,
          groupName: groupById.get(choice.group_id)?.name ?? '',
          amount: choiceAmount,
          currentAmount: current,
          state: costImportChoiceState({ priceOnRequest: choice.price_on_request === true, amount: choiceAmount, currentAmount: current }),
        };
      });
    return {
      id: row.id,
      productNo: row.product_no ?? null,
      name: row.name,
      categoryName: categoryName.get(row.category_id) ?? '',
      maker: [row.manufacturer, row.model_no].filter((value) => value?.trim()).join(' ／ ') || null,
      amount,
      currentAmount,
      state: costImportProductState({
        priceOnRequest: row.price_on_request === true,
        amount,
        currentAmount,
        archived: Boolean(row.archived_at),
        manufacturer: row.manufacturer,
        modelNo: row.model_no,
      }),
      choices: productChoices,
    };
  });
  return { available: true, products };
}
