import 'server-only';
import legacyPriceColumns from './legacy-price-columns.json';
import { isLocalMode } from './store';

/**
 * 旧価格の列（本部商品の原価。v2.5 PR-C1b・20261030100000）。
 *
 * 商品価格・選択肢の追加金額・本体価格・本体内訳の金額・旧テンプレート（Excel の標準見積）の金額は、
 * anon・ログインした利用者（本部の管理者も）が API から直接読めない（DB の列の権限）。
 * アプリは金額の列以外を列名で指定して読み、金額が要るときだけサーバーが service_role で読んで足す。
 * 列の一覧は legacy-price-columns.json。列を足す migration では、この JSON と DB の列の権限を一緒に直す
 * （リハーサル・CI の静的検査で、DB の列と JSON・列の権限が合っているかを確かめる）。
 */
export type LegacyPriceTable = keyof typeof legacyPriceColumns;

/** 金額の列を除いた select の列 */
export function legacyTableColumns(table: LegacyPriceTable): string {
  return legacyPriceColumns[table].select.join(', ');
}

/**
 * 金額を足す範囲。
 * - all：すべての金額（スイッチが切れている間は旧シミュレーターの売価として今までどおり。本部。ローカル検証モード）
 * - non-hq：本部商品の外（旧フリー商品）の金額だけ。本部商品・本体・本体内訳・旧テンプレートの金額は 0（スイッチが入った後の本部以外）
 */
export type LegacyPriceScope = 'all' | 'non-hq';

/** ログインした利用者のリクエストで使う範囲（Cookie を読むため、unstable_cache の中では呼ばない） */
export async function getLegacyPriceScope(): Promise<LegacyPriceScope> {
  if (isLocalMode()) return 'all';
  const { getSimulatorStandardPricingEnabled } = await import('./standard-estimate-sale-views');
  if (!(await getSimulatorStandardPricingEnabled())) return 'all';
  const { getCostRecordingAccess } = await import('./option-cost-recording');
  const access = await getCostRecordingAccess();
  return access.canManage && !access.error ? 'all' : 'non-hq';
}

const IN_CHUNK = 100;

async function adminDb() {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  return createAdminClient();
}

type AdminDb = Awaited<ReturnType<typeof adminDb>>;

/** service_role で金額の列を読む（in の URL が長くなりすぎないよう 100 件ずつ） */
async function readByIds<T extends Record<string, unknown>>(db: AdminDb, table: string, key: string, ids: string[], columns: string): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const { data, error } = await db.from(table).select(columns).in(key, unique.slice(i, i + IN_CHUNK));
    if (error) throw new Error(`legacy prices ${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

async function freeProductCategoryId(db: AdminDb): Promise<string | null> {
  const { data, error } = await db.from('option_categories').select('id').eq('code', 'free-product').maybeSingle();
  if (error) throw new Error(`legacy prices option_categories: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** 商品へ商品価格を足す（non-hq では旧フリー商品だけ。ほかは 0） */
export async function withLegacyOptionPrices<T extends { id: string }>(rows: T[], scope: LegacyPriceScope): Promise<(T & { price: number })[]> {
  if (!rows.length) return rows as (T & { price: number })[];
  const db = await adminDb();
  const prices = await readByIds<{ id: string; price: number; category_id: string }>(db, 'options', 'id', rows.map((row) => row.id), 'id, price, category_id');
  const freeId = scope === 'non-hq' ? await freeProductCategoryId(db) : null;
  const byId = new Map(prices.map((row) => [row.id, row]));
  return rows.map((row) => {
    const found = byId.get(row.id);
    const visible = found && (scope === 'all' || (freeId !== null && found.category_id === freeId));
    return { ...row, price: visible ? found.price : 0 };
  });
}

/** 選択肢へ追加金額を足す（non-hq では旧フリー商品の選択肢だけ。ほかは 0） */
export async function withLegacyChoicePrices<T extends { id: string }>(rows: T[], scope: LegacyPriceScope): Promise<(T & { extra_price: number })[]> {
  if (!rows.length) return rows as (T & { extra_price: number })[];
  const db = await adminDb();
  const prices = await readByIds<{ id: string; extra_price: number; group_id: string }>(
    db,
    'option_variant_choices',
    'id',
    rows.map((row) => row.id),
    'id, extra_price, group_id'
  );
  let visibleGroups: Set<string> | null = null;
  if (scope === 'non-hq') {
    const freeId = await freeProductCategoryId(db);
    const groups = await readByIds<{ id: string; option_id: string }>(db, 'option_variant_groups', 'id', prices.map((row) => row.group_id), 'id, option_id');
    const options = freeId
      ? await readByIds<{ id: string; category_id: string }>(db, 'options', 'id', groups.map((group) => group.option_id), 'id, category_id')
      : [];
    const freeOptions = new Set(options.filter((option) => option.category_id === freeId).map((option) => option.id));
    visibleGroups = new Set(groups.filter((group) => freeOptions.has(group.option_id)).map((group) => group.id));
  }
  const byId = new Map(prices.map((row) => [row.id, row]));
  return rows.map((row) => {
    const found = byId.get(row.id);
    const visible = found && (visibleGroups === null || visibleGroups.has(found.group_id));
    return { ...row, extra_price: visible ? found.extra_price : 0 };
  });
}

/** 本体へ本体価格を足す（non-hq では 0） */
export async function withLegacyModelPrices<T extends { id: string }>(rows: T[], scope: LegacyPriceScope): Promise<(T & { base_price: number })[]> {
  if (scope !== 'all' || !rows.length) return rows.map((row) => ({ ...row, base_price: 0 }));
  const prices = await readByIds<{ id: string; base_price: number }>(await adminDb(), 'base_models', 'id', rows.map((row) => row.id), 'id, base_price');
  const byId = new Map(prices.map((row) => [row.id, row.base_price]));
  return rows.map((row) => ({ ...row, base_price: byId.get(row.id) ?? 0 }));
}

type AmountRow = { id: string };

/** 本体内訳・旧テンプレートの行へ金額の列を足す（non-hq では 0） */
async function withAmounts<T extends AmountRow, K extends string>(
  table: LegacyPriceTable,
  rows: T[],
  scope: LegacyPriceScope,
  zero: Record<K, number | null>
): Promise<(T & Record<K, number | null>)[]> {
  if (scope !== 'all' || !rows.length) return rows.map((row) => ({ ...row, ...zero }));
  const columns = legacyPriceColumns[table].price;
  const prices = await readByIds<AmountRow & Record<string, number | null>>(await adminDb(), table, 'id', rows.map((row) => row.id), ['id', ...columns].join(', '));
  const byId = new Map(prices.map((row) => [row.id, row]));
  return rows.map((row) => {
    const found = byId.get(row.id);
    const amounts = Object.fromEntries(columns.map((column) => [column, found ? (found[column] ?? null) : (zero as Record<string, number | null>)[column]]));
    return { ...row, ...(amounts as Record<K, number | null>) };
  });
}

export function withLegacyBreakdownPrices<T extends AmountRow>(rows: T[], scope: LegacyPriceScope) {
  return withAmounts('base_breakdown_items', rows, scope, { unit_price: 0, amount: 0 });
}

export function withLegacyTemplatePrices<T extends AmountRow>(rows: T[], scope: LegacyPriceScope) {
  return withAmounts('estimate_templates', rows, scope, { subtotal_raw: 0, adjustment: 0, subtotal: 0, tax: 0, total: 0 });
}

export function withLegacyTemplateSectionPrices<T extends AmountRow>(rows: T[], scope: LegacyPriceScope) {
  return withAmounts('estimate_template_sections', rows, scope, { line_subtotal: 0, expense_amount: 0, total: 0 });
}

export function withLegacyTemplateLinePrices<T extends AmountRow>(rows: T[], scope: LegacyPriceScope) {
  return withAmounts('estimate_template_lines', rows, scope, { unit_price: null, amount: 0 });
}

/**
 * 本部以外の保存で「今の金額をそのまま書き戻す」ための金額（画面には出さない）。
 * スイッチが入った後は、本部以外の読み取りでは本部商品の金額が 0 になるため、書き戻す金額だけはサーバーで読み直す
 * （0 を書き戻すと、DB のトリガーが本部商品の金額の変更として止める）
 */
export async function currentOptionPriceForWriteBack(option: { id: string; price: number }): Promise<number> {
  if (isLocalMode()) return option.price;
  return (await withLegacyOptionPrices([{ id: option.id }], 'all'))[0]?.price ?? 0;
}

export async function currentChoicePriceForWriteBack(choice: { id: string; extra_price: number }): Promise<number> {
  if (isLocalMode()) return choice.extra_price;
  return (await withLegacyChoicePrices([{ id: choice.id }], 'all'))[0]?.extra_price ?? 0;
}

export async function currentModelPriceForWriteBack(model: { id: string; base_price: number }): Promise<number> {
  if (isLocalMode()) return model.base_price;
  return (await withLegacyModelPrices([{ id: model.id }], 'all'))[0]?.base_price ?? 0;
}
