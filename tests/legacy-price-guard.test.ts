import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isLocalMode: vi.fn(),
  pricingEnabled: vi.fn(),
  costAccess: vi.fn(),
  inCalls: [] as { table: string; ids: string[] }[],
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock('@/lib/data/store', () => ({ isLocalMode: mocks.isLocalMode }));
vi.mock('@/lib/data/standard-estimate-sale-views', () => ({ getSimulatorStandardPricingEnabled: mocks.pricingEnabled }));
vi.mock('@/lib/data/option-cost-recording', () => ({ getCostRecordingAccess: mocks.costAccess }));
vi.mock('@/lib/supabase/admin', () => ({
  // service_role のクライアントの代わり：select(列).in(列, 値) と eq(列, 値).maybeSingle() だけを、メモリの表で返す
  createAdminClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        const pick = (row: Record<string, unknown>) =>
          Object.fromEntries(columns.split(',').map((c) => c.trim()).map((c) => [c, row[c]]));
        return {
          in: async (key: string, ids: string[]) => {
            mocks.inCalls.push({ table, ids });
            return { data: (mocks.tables[table] ?? []).filter((row) => ids.includes(row[key] as string)).map(pick), error: null };
          },
          eq: (key: string, value: unknown) => ({
            maybeSingle: async () => ({ data: (mocks.tables[table] ?? []).filter((row) => row[key] === value).map(pick)[0] ?? null, error: null }),
          }),
        };
      },
    }),
  }),
}));

import {
  currentChoicePriceForWriteBack,
  currentModelPriceForWriteBack,
  currentOptionPriceForWriteBack,
  getLegacyPriceScope,
  legacyTableColumns,
  withLegacyChoicePrices,
  withLegacyModelPrices,
  withLegacyOptionPrices,
  withLegacyTemplateLinePrices,
} from '@/lib/data/legacy-prices';
import legacyPriceColumns from '@/lib/data/legacy-price-columns.json';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const migration = read('supabase/migrations/20261030100000_legacy_price_column_guard.sql');
const runtime = read('scripts/db-rehearsal/runtime-legacy-price-guard.sql');
const statements = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

const HQ_CATEGORY = 'cat-hq';
const FREE_CATEGORY = 'cat-free';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inCalls.length = 0;
  mocks.isLocalMode.mockReturnValue(false);
  mocks.pricingEnabled.mockResolvedValue(false);
  mocks.costAccess.mockResolvedValue({ available: true, canManage: false });
  mocks.tables = {
    option_categories: [
      { id: HQ_CATEGORY, code: 'runtime-items' },
      { id: FREE_CATEGORY, code: 'free-product' },
    ],
    options: [
      { id: 'o-hq', price: 10000, category_id: HQ_CATEGORY },
      { id: 'o-free', price: 5000, category_id: FREE_CATEGORY },
    ],
    option_variant_groups: [
      { id: 'g-hq', option_id: 'o-hq' },
      { id: 'g-free', option_id: 'o-free' },
    ],
    option_variant_choices: [
      { id: 'c-hq', extra_price: 1000, group_id: 'g-hq' },
      { id: 'c-free', extra_price: 300, group_id: 'g-free' },
    ],
    base_models: [{ id: 'm-1', base_price: 1000000 }],
    estimate_template_lines: [{ id: 'l-1', unit_price: 2000, amount: 4000 }],
  };
});

describe('旧価格の列を足す範囲（v2.5 PR-C1b）', () => {
  it('スイッチが切れている間は、だれにでも今までどおりすべての金額を足す（旧シミュレーターの売価）', async () => {
    await expect(getLegacyPriceScope()).resolves.toBe('all');
    expect(mocks.costAccess).not.toHaveBeenCalled();
  });

  it('スイッチが入った後は、本部だけがすべての金額。本部以外・権限の確認に失敗したときは本部商品の外だけ', async () => {
    mocks.pricingEnabled.mockResolvedValue(true);
    mocks.costAccess.mockResolvedValueOnce({ available: true, canManage: true });
    await expect(getLegacyPriceScope()).resolves.toBe('all');
    mocks.costAccess.mockResolvedValueOnce({ available: true, canManage: false });
    await expect(getLegacyPriceScope()).resolves.toBe('non-hq');
    mocks.costAccess.mockResolvedValueOnce({ available: true, canManage: true, error: true });
    await expect(getLegacyPriceScope()).resolves.toBe('non-hq');
  });

  it('ローカル検証モードは DB の権限が無いので、すべての金額（Supabase へ問い合わせない）', async () => {
    mocks.isLocalMode.mockReturnValue(true);
    await expect(getLegacyPriceScope()).resolves.toBe('all');
    expect(mocks.pricingEnabled).not.toHaveBeenCalled();
  });
});

describe('旧価格の列をサーバーで足す', () => {
  it('all：商品価格・追加金額・本体価格をそのまま足す', async () => {
    await expect(withLegacyOptionPrices([{ id: 'o-hq' }, { id: 'o-free' }], 'all')).resolves.toEqual([
      { id: 'o-hq', price: 10000 },
      { id: 'o-free', price: 5000 },
    ]);
    await expect(withLegacyChoicePrices([{ id: 'c-hq' }], 'all')).resolves.toEqual([{ id: 'c-hq', extra_price: 1000 }]);
    await expect(withLegacyModelPrices([{ id: 'm-1' }], 'all')).resolves.toEqual([{ id: 'm-1', base_price: 1000000 }]);
  });

  it('non-hq：本部商品の金額は 0 にし、旧フリー商品（とその選択肢）の金額だけを足す', async () => {
    await expect(withLegacyOptionPrices([{ id: 'o-hq' }, { id: 'o-free' }], 'non-hq')).resolves.toEqual([
      { id: 'o-hq', price: 0 },
      { id: 'o-free', price: 5000 },
    ]);
    await expect(withLegacyChoicePrices([{ id: 'c-hq' }, { id: 'c-free' }], 'non-hq')).resolves.toEqual([
      { id: 'c-hq', extra_price: 0 },
      { id: 'c-free', extra_price: 300 },
    ]);
  });

  it('non-hq：本体価格・旧テンプレートの金額は 0（service_role で読みにも行かない）', async () => {
    await expect(withLegacyModelPrices([{ id: 'm-1' }], 'non-hq')).resolves.toEqual([{ id: 'm-1', base_price: 0 }]);
    await expect(withLegacyTemplateLinePrices([{ id: 'l-1' }], 'non-hq')).resolves.toEqual([{ id: 'l-1', unit_price: null, amount: 0 }]);
    expect(mocks.inCalls).toEqual([]);
  });

  it('多くの行は 100 件ずつ読む（in の URL を長くしすぎない）', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: `o-${i}` }));
    await withLegacyOptionPrices(rows, 'all');
    expect(mocks.inCalls.filter((call) => call.table === 'options').map((call) => call.ids.length)).toEqual([100, 100, 50]);
  });
});

describe('本部以外の保存で今の金額を書き戻す（スイッチの後に 0 を書き戻さない）', () => {
  it('Supabase のときは、画面が受け取った金額ではなく今の DB の金額を読む', async () => {
    await expect(currentOptionPriceForWriteBack({ id: 'o-hq', price: 0 })).resolves.toBe(10000);
    await expect(currentChoicePriceForWriteBack({ id: 'c-hq', extra_price: 0 })).resolves.toBe(1000);
    await expect(currentModelPriceForWriteBack({ id: 'm-1', base_price: 0 })).resolves.toBe(1000000);
  });

  it('ローカル検証モードは受け取った値のまま（Supabase へ問い合わせない）', async () => {
    mocks.isLocalMode.mockReturnValue(true);
    await expect(currentOptionPriceForWriteBack({ id: 'o-hq', price: 123 })).resolves.toBe(123);
    expect(mocks.inCalls).toEqual([]);
  });

  it('商品・選択肢・本体の保存は書き戻す金額を読み直し、本体内訳の保存は本部だけ', () => {
    const actions = read('lib/actions/admin.ts');
    expect(actions).toContain('const keptPrice = keepExistingPrice && existingOption ? await currentOptionPriceForWriteBack(existingOption) : 0;');
    expect(actions).toContain('extra_price: keepExistingPrice ? await currentChoicePriceForWriteBack(existing) : existing.extra_price');
    expect(actions).toContain('keptBasePrice = current ? await currentModelPriceForWriteBack(current) : 0;');
    expect(actions).toContain("if (!canEditCostField(costAccess)) return { ok: false, error: '本体内訳の金額は本部だけが登録・変更できます。' };");
    expect(read('lib/import/apply.ts')).toContain('withWriteBackOptionPrices(await store.listOptions(), options.protectHqCost === true)');
  });
});

describe('旧価格の列の一覧と migration', () => {
  const priceColumns = Object.entries(legacyPriceColumns).flatMap(([table, spec]) => spec.price.map((col) => `${table}.${col}`));

  it('アプリが読む列に金額の列を入れない', () => {
    for (const [table, spec] of Object.entries(legacyPriceColumns)) {
      for (const col of spec.price) expect(spec.select, `${table}.${col}`).not.toContain(col);
      expect(legacyTableColumns(table as keyof typeof legacyPriceColumns)).toBe(spec.select.join(', '));
    }
  });

  it('migration・実行時検査の金額の列は、一覧と同じ 15 列', () => {
    const fromMigration = [...migration.matchAll(/^ {2}\('([a-z_]+)', '([a-z_]+)'\)[,;]$/gm)].map((m) => `${m[1]}.${m[2]}`);
    expect(fromMigration.sort()).toEqual([...priceColumns].sort());
    expect(priceColumns).toHaveLength(15);
    for (const column of priceColumns) {
      const [table, col] = column.split('.');
      expect(runtime, column).toContain(`('${table}', '${col}')`);
    }
  });

  it('読み取り：表の SELECT を外し、適用の時点の金額のほかの列を grant する。書き込み：本部だけのトリガー', () => {
    expect(statements).toContain("execute format('revoke select on table public.%I from anon, authenticated', r.tbl);");
    expect(statements).toContain("execute format('grant select (%s) on table public.%I to anon, authenticated', v_cols, r.tbl);");
    expect(statements).toContain("select coalesce(auth.role(), '') in ('', 'service_role')");
    expect(statements).toContain('or public.can_manage_option_hq_standard_cost();');
    for (const trigger of [
      'options_legacy_price_guard',
      'option_variant_choices_legacy_price_guard',
      'base_models_legacy_price_guard',
      'base_breakdown_items_legacy_price_guard',
      'estimate_templates_legacy_price_guard',
      'estimate_template_sections_legacy_price_guard',
      'estimate_template_lines_legacy_price_guard',
    ]) {
      expect(statements, trigger).toMatch(new RegExp(`create trigger ${trigger}\\n`));
    }
    // 一括登録・upsert（INSERT ... ON CONFLICT）は、同じ金額で登録済みなら INSERT の段階では止めない
    expect(statements).toContain('and not exists (select 1 from public.options o where (o.code = new.code or o.id = new.id) and o.price = new.price) then');
  });

  it('データは変えない（金額・行の更新をしない）', () => {
    const body = statements.replace(/create temp table _legacy_price_columns[\s\S]*?;\ninsert into _legacy_price_columns[\s\S]*?;\n/, '');
    expect(body).not.toMatch(/^\s*(insert into|update|delete from)\s+public\./im);
    expect(body).not.toMatch(/alter table/i);
  });

  it('ストアは全リクエストで共有するため、金額を足す範囲を覚えておかない（利用者ごとに確かめる）', () => {
    const store = read('lib/data/supabase-store.ts');
    expect(store).toContain('private legacyPriceScope(): Promise<LegacyPriceScope> {\n    return getLegacyPriceScope();\n  }');
    expect(store).not.toMatch(/legacyScope\s*\?\?=/);
  });

  it('アプリは旧価格の表を select(*) で読まない（金額の列は利用者のロールから読めないため）', () => {
    for (const file of ['lib/data/supabase-store.ts', 'lib/data/public-catalog.ts']) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /from\('(options|option_variant_choices|base_models|base_breakdown_items|estimate_templates|estimate_template_sections|estimate_template_lines)'\)\s*\.select\('\*'\)/
      );
    }
  });
});
