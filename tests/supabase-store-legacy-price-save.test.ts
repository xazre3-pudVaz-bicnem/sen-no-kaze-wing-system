import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-11-09 本番：商品登録の STEP1 の自動保存で「permission denied for table options」（42501）。
 * 金額の列（原価）は読めない（v2.5 PR-C1b）ため、upsert（INSERT … ON CONFLICT DO UPDATE SET 金額 = EXCLUDED.金額）で書くと
 * PostgreSQL が EXCLUDED の列にも読み取りの権限を求めて止める。金額の列を持つ表（商品・選択肢・本体モデル）は、
 * 既存の行を UPDATE、無ければ INSERT で書く（実 DB の検査 LPG-32〜34 で、この形が通り upsert の形が 42501 になることを確かめる）
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

/** from(table) の呼び出しを記録する（update → eq → select → maybeSingle、insert → select → single、upsert） */
function setupDb(updateResult: Result, insertResult: Result) {
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
                return { maybeSingle: async () => updateResult };
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
            return { single: async () => insertResult };
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

const OPTION_ID = '11111111-1111-4111-8111-111111111111';

describe('SupabaseStore：金額の列を持つ表の保存は upsert を使わない（2026-11-09 本番の 42501）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('既存の商品は UPDATE で書き（金額を含む）、金額のほかの列だけを返させ、金額はサーバーで足す', async () => {
    const { calls, store } = setupDb({ data: { id: OPTION_ID, name: '更新後' }, error: null }, { data: null, error: null });
    const saved = await store.upsertOption({ id: OPTION_ID, name: '更新後', price: 5000, status: 'draft' } as never);
    expect(saved).toMatchObject({ id: OPTION_ID, name: '更新後', price: 111 });
    expect(calls.map((call) => call.op)).toEqual(['update', 'eq', 'select']);
    expect(calls[0]).toMatchObject({ table: 'options', args: [{ name: '更新後', price: 5000, status: 'draft' }] });
    expect(calls[1].args).toEqual(['id', OPTION_ID]);
    expect(calls[2].args).toEqual([legacyTableColumns('options')]);
    expect(String(calls[2].args[0]).split(', ')).not.toContain('price');
  });

  it('ID を指定しても更新する行が無ければ、その ID で INSERT する（決定的な UUID の新しい行）', async () => {
    const { calls, store } = setupDb({ data: null, error: null }, { data: { id: OPTION_ID, name: '新しい商品' }, error: null });
    const saved = await store.upsertOption({ id: OPTION_ID, name: '新しい商品', price: 0, status: 'draft' } as never);
    expect(saved).toMatchObject({ id: OPTION_ID, price: 111 });
    expect(calls.map((call) => call.op)).toEqual(['update', 'eq', 'select', 'insert', 'select']);
    expect(calls[3].args).toEqual([{ id: OPTION_ID, name: '新しい商品', price: 0, status: 'draft' }]);
  });

  it('ID の無い新しい商品は、今までどおり INSERT だけ', async () => {
    const { calls, store } = setupDb({ data: null, error: null }, { data: { id: OPTION_ID, name: '新規' }, error: null });
    await store.upsertOption({ name: '新規', price: 0, status: 'draft' } as never);
    expect(calls.map((call) => call.op)).toEqual(['insert', 'select']);
    expect(calls[0].args).toEqual([{ name: '新規', price: 0, status: 'draft' }]);
  });

  it('選択肢（追加金額）・本体モデル（本体価格）も同じ（upsert を使わない）', async () => {
    const choice = setupDb({ data: { id: OPTION_ID, name: '黒' }, error: null }, { data: null, error: null });
    await expect(choice.store.upsertVariantChoice({ id: OPTION_ID, name: '黒', extra_price: 2000 } as never)).resolves.toMatchObject({ extra_price: 222 });
    expect(choice.calls.map((call) => `${call.table}:${call.op}`)).toEqual(['option_variant_choices:update', 'option_variant_choices:eq', 'option_variant_choices:select']);
    expect(String(choice.calls[2].args[0]).split(', ')).not.toContain('extra_price');

    const model = setupDb({ data: { id: OPTION_ID, name: 'Wing' }, error: null }, { data: null, error: null });
    await expect(model.store.upsertModel({ id: OPTION_ID, name: 'Wing', base_price: 1000000 } as never)).resolves.toMatchObject({ base_price: 333 });
    expect(model.calls.map((call) => `${call.table}:${call.op}`)).toEqual(['base_models:update', 'base_models:eq', 'base_models:select']);
    expect(String(model.calls[2].args[0]).split(', ')).not.toContain('base_price');
  });

  it('DB の拒否（権限・RLS）はそのまま利用者向けの誤りにする（金額の読み取りの制限は変えない）', async () => {
    const { store } = setupDb({ data: null, error: { code: '42501', message: 'permission denied for table options' } }, { data: null, error: null });
    await expect(store.upsertOption({ id: OPTION_ID, name: 'x', price: 1 } as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
