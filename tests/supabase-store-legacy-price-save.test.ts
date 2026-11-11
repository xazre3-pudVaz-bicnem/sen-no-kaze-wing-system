import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-11-09 本番：商品登録の STEP1 の自動保存で「permission denied for table options」（42501）。
 * 金額の列（原価）は読めない（v2.5 PR-C1b）ため、upsert（INSERT … ON CONFLICT DO UPDATE SET 金額 = EXCLUDED.金額）で書くと
 * PostgreSQL が EXCLUDED の列にも読み取りの権限を求めて止める。金額の列を持つ表（商品・選択肢・本体モデル）は、
 * 既存の行を UPDATE、新しい行を INSERT で書く（実 DB の検査 LPG-32〜35 で、この形が通り upsert の形が 42501 になることを確かめる）
 */
const createClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('@/lib/data/legacy-prices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/legacy-prices')>();
  return {
    ...actual,
    getLegacyPriceScope: vi.fn(async () => 'all'),
    // 金額は service_role で読んで足す（ここでは足したことが分かる値にする）
    withLegacyOptionPrices: vi.fn(async (rows: { id: string }[]) => rows.map((row) => ({ ...row, price: 111 }))),
    withLegacyChoicePrices: vi.fn(async (rows: { id: string }[]) => rows.map((row) => ({ ...row, extra_price: 222 }))),
    withLegacyModelPrices: vi.fn(async (rows: { id: string }[]) => rows.map((row) => ({ ...row, base_price: 333 }))),
  };
});

import { legacyTableColumns } from '@/lib/data/legacy-prices';
import { SupabaseStore } from '@/lib/data/supabase-store';

type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** from(table) の呼び出しを記録する（update → eq → select → maybeSingle、insert → select → single、upsert）。結果は呼ばれた順に返す */
function setupDb(updateResults: Result[], insertResults: Result[] = []) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const db = {
    from: vi.fn((table: string) => ({
      update: (payload: unknown) => {
        calls.push({ table, op: 'update', args: [payload] });
        return {
          eq: (column: string, value: unknown) => {
            calls.push({ table, op: 'eq', args: [column, value] });
            return {
              select: (columns: string) => {
                calls.push({ table, op: 'select', args: [columns] });
                return { maybeSingle: async () => updateResults.shift() ?? { data: null, error: null } };
              },
            };
          },
        };
      },
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', args: [payload] });
        return {
          select: (columns: string) => {
            calls.push({ table, op: 'select', args: [columns] });
            return { single: async () => insertResults.shift() ?? { data: null, error: null } };
          },
        };
      },
      upsert: (...args: unknown[]) => {
        calls.push({ table, op: 'upsert', args });
        throw new Error('upsert must not be used for tables with legacy price columns');
      },
    })),
  };
  createClient.mockResolvedValue(db);
  return { calls, store: new SupabaseStore() };
}

const ROW_ID = '11111111-1111-4111-8111-111111111111';
const ops = (calls: { table: string; op: string }[]) => calls.map((call) => `${call.table}:${call.op}`);

describe('SupabaseStore：金額の列を持つ表の保存は upsert を使わない（2026-11-09 本番の 42501）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('既存の商品は UPDATE で書き（金額を含む）、金額のほかの列だけを返させ、金額はサーバーで足す', async () => {
    const { calls, store } = setupDb([{ data: { id: ROW_ID, name: '更新後' }, error: null }]);
    const saved = await store.upsertOption({ id: ROW_ID, name: '更新後', price: 5000, status: 'draft' } as never);
    expect(saved).toMatchObject({ id: ROW_ID, name: '更新後', price: 111 });
    expect(ops(calls)).toEqual(['options:update', 'options:eq', 'options:select']);
    expect(calls[0].args).toEqual([{ name: '更新後', price: 5000, status: 'draft' }]);
    expect(calls[1].args).toEqual(['id', ROW_ID]);
    expect(calls[2].args).toEqual([legacyTableColumns('options')]);
    expect(String(calls[2].args[0]).split(', ')).not.toContain('price');
  });

  it('ID の商品が無い（削除された・更新する権限が無くて見えない）ときは止め、作り直さない', async () => {
    const { calls, store } = setupDb([{ data: null, error: null }]);
    await expect(store.upsertOption({ id: ROW_ID, name: '削除済み', price: 0, status: 'draft' } as never)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ops(calls)).toEqual(['options:update', 'options:eq', 'options:select']);
  });

  it('ID の無い新しい商品は、今までどおり INSERT だけ', async () => {
    const { calls, store } = setupDb([], [{ data: { id: ROW_ID, name: '新規' }, error: null }]);
    await expect(store.upsertOption({ name: '新規', price: 0, status: 'draft' } as never)).resolves.toMatchObject({ id: ROW_ID, price: 111 });
    expect(ops(calls)).toEqual(['options:insert', 'options:select']);
    expect(calls[0].args).toEqual([{ name: '新規', price: 0, status: 'draft' }]);
  });

  it('本体モデルも既存の行の UPDATE だけ（本体価格を返す列に含めない。行が無ければ止める）', async () => {
    const found = setupDb([{ data: { id: ROW_ID, name: 'Wing' }, error: null }]);
    await expect(found.store.upsertModel({ id: ROW_ID, name: 'Wing', base_price: 1000000 } as never)).resolves.toMatchObject({ base_price: 333 });
    expect(ops(found.calls)).toEqual(['base_models:update', 'base_models:eq', 'base_models:select']);
    expect(String(found.calls[2].args[0]).split(', ')).not.toContain('base_price');
    const missing = setupDb([{ data: null, error: null }]);
    await expect(missing.store.upsertModel({ id: ROW_ID, name: 'Wing', base_price: 1 } as never)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(ops(missing.calls)).not.toContain('base_models:insert');
  });

  it('選択肢：既存の行は UPDATE。ID を先に決めた新しい選択肢は、行が無ければその ID で INSERT（返す列に追加金額を含めない）', async () => {
    const edit = setupDb([{ data: { id: ROW_ID, name: '黒' }, error: null }]);
    await expect(edit.store.upsertVariantChoice({ id: ROW_ID, name: '黒', extra_price: 2000 } as never)).resolves.toMatchObject({ extra_price: 222 });
    expect(ops(edit.calls)).toEqual(['option_variant_choices:update', 'option_variant_choices:eq', 'option_variant_choices:select']);
    expect(String(edit.calls[2].args[0]).split(', ')).not.toContain('extra_price');

    const add = setupDb([{ data: null, error: null }], [{ data: { id: ROW_ID, name: '白' }, error: null }]);
    await expect(add.store.upsertVariantChoice({ id: ROW_ID, name: '白', extra_price: 100 } as never)).resolves.toMatchObject({ id: ROW_ID, extra_price: 222 });
    expect(ops(add.calls)).toEqual([
      'option_variant_choices:update', 'option_variant_choices:eq', 'option_variant_choices:select',
      'option_variant_choices:insert', 'option_variant_choices:select',
    ]);
    expect(add.calls[3].args).toEqual([{ id: ROW_ID, name: '白', extra_price: 100 }]);
  });

  it('選択肢：同じ ID の行が同時に足されていた（INSERT が 23505）ときは更新し直す。それでも行が無ければ権限の誤り', async () => {
    const raced = setupDb(
      [{ data: null, error: null }, { data: { id: ROW_ID, name: '白' }, error: null }],
      [{ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }]
    );
    await expect(raced.store.upsertVariantChoice({ id: ROW_ID, name: '白', extra_price: 100 } as never)).resolves.toMatchObject({ id: ROW_ID });
    expect(ops(raced.calls).filter((op) => op.endsWith(':update'))).toHaveLength(2);

    const hidden = setupDb([{ data: null, error: null }, { data: null, error: null }], [{ data: null, error: { code: '23505', message: 'duplicate key' } }]);
    await expect(hidden.store.upsertVariantChoice({ id: ROW_ID, name: '白', extra_price: 100 } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('DB の拒否（権限・金額の保護のトリガー）はそのまま利用者向けの誤りにする（金額の読み取りの制限は変えない）', async () => {
    const { store } = setupDb([{ data: null, error: { code: '42501', message: 'FORBIDDEN: 本部商品の商品標準原価（商品価格）は本部だけが変更できます' } }]);
    await expect(store.upsertOption({ id: ROW_ID, name: 'x', price: 1 } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('金額の列を持つほかの表（本体内訳など）は、汎用の保存（upsert）に通さない', async () => {
    const { calls, store } = setupDb([]);
    const upsert = (store as unknown as { upsert: (table: string, input: Record<string, unknown>) => Promise<unknown> }).upsert.bind(store);
    await expect(upsert('base_breakdown_items', { id: ROW_ID, unit_price: 1 })).rejects.toThrow('金額の列を持つため');
    await expect(upsert('options', { id: ROW_ID, price: 1 })).rejects.toThrow('金額の列を持つため');
    expect(calls).toEqual([]);
  });
});
