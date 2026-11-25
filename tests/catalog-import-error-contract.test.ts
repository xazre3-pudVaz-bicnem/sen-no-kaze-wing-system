import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 商品台帳の一括登録のエラーの伝え方（商品公開原子性 v6.1 の H2-B／2026-11-25 の工程の P1）。
 * 競合（P0001 ＋ IMPORT_CONFLICT:）は決まった文言で「最新を読み込んでやり直す」よう案内し、競合の種類を途中で失わない。
 * 想定外の DB のエラー（SQL の文が入りうる）は画面に出さない。
 */

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { StoreError } from '@/lib/data/store';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { IMPORT_CONFLICT_MESSAGE, IMPORT_FAILED, IMPORT_UNEXPECTED, importFailure, isImportConflict } from '@/lib/import/errors';

const batch = { options: [], variantGroups: [], variantChoices: [] };

function rpcFails(error: { code?: string; message?: string }) {
  const rpc = vi.fn(async () => ({ data: null, error }));
  mocks.createClient.mockResolvedValue({ rpc, from: vi.fn() });
  return rpc;
}

async function caught(promise: Promise<unknown>): Promise<StoreError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof StoreError) return e;
    throw e;
  }
  throw new Error('失敗しなかった');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('DB の競合の印', () => {
  it('SQLSTATE P0001 かつ文の先頭が IMPORT_CONFLICT: のときだけ競合とみなす', () => {
    expect(isImportConflict({ code: 'P0001', message: 'IMPORT_CONFLICT: option payload mismatch' })).toBe(true);
    expect(isImportConflict({ code: 'P0001', message: 'IMPORT_OPTION UPSERT a: x' })).toBe(false);
    expect(isImportConflict({ code: '23505', message: 'IMPORT_CONFLICT: x' })).toBe(false);
    expect(isImportConflict({ code: 'P0001', message: 'CONFLICT: 別の文' })).toBe(false);
    expect(isImportConflict(null)).toBe(false);
  });

  it('一括登録の RPC が競合を返したら、決まった文言の CONFLICT にする（DB の文は出さない）', async () => {
    const rpc = rpcFails({ code: 'P0001', message: 'IMPORT_CONFLICT: expected_option_id 1 <> 2 (select * from options)' });
    const error = await caught(new SupabaseStore().applyCatalogImport(batch));
    expect(rpc).toHaveBeenCalledWith('apply_catalog_import', { p_options: [], p_variant_groups: [], p_variant_choices: [] });
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe(IMPORT_CONFLICT_MESSAGE);
    expect(error.message).toContain('最新の状態を読み込み');
    expect(error.message).not.toMatch(/select|expected_option_id|IMPORT_CONFLICT/);
    // 「ほかの人が変えた」とは言い切らない（古い取り込みの内容が合わないだけのこともある）
    expect(error.message).not.toMatch(/他の(人|方|利用者)|ほかの(人|方)|他者/);
  });

  it('印の無い P0001・違う SQLSTATE は、今までどおり（競合にしない）', async () => {
    rpcFails({ code: 'P0001', message: 'IMPORT_OPTION UPSERT prod-1: duplicate key value violates unique constraint "options_code_key"' });
    expect((await caught(new SupabaseStore().applyCatalogImport(batch))).code).toBe('INTERNAL');
    rpcFails({ code: '23505', message: 'IMPORT_CONFLICT: x' });
    expect((await caught(new SupabaseStore().applyCatalogImport(batch))).code).toBe('VALIDATION');
  });
});

describe('一括登録の失敗を、画面に出してよい形にする', () => {
  it('競合は、どこから来ても決まった文言の CONFLICT のまま（途中で INTERNAL にしない）', () => {
    const fromStore = importFailure(new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE));
    expect(fromStore.code).toBe('CONFLICT');
    expect(fromStore.message).toBe(IMPORT_CONFLICT_MESSAGE);
    // 行の処理の中で起きて包まれて返っても（商品・選択項目・選択肢）、競合として伝える
    for (const raw of [
      'IMPORT_OPTION UPDATE prod-1: IMPORT_CONFLICT: stale payload',
      'IMPORT_VARIANT_GROUP UPSERT g-1: IMPORT_CONFLICT: stale payload',
      'IMPORT_VARIANT_CHOICE UPSERT c-1: IMPORT_CONFLICT: stale payload',
    ]) {
      const wrapped = importFailure(new StoreError('INTERNAL', raw));
      expect(wrapped.code).toBe('CONFLICT');
      expect(wrapped.message).toBe(IMPORT_CONFLICT_MESSAGE);
    }
  });

  it('DB が返した包まれた競合は、ストアから画面に出す形まで競合のまま届く', async () => {
    rpcFails({ code: 'P0001', message: 'IMPORT_VARIANT_CHOICE UPSERT c-1: IMPORT_CONFLICT: expected id mismatch' });
    const fromStore = await caught(new SupabaseStore().applyCatalogImport(batch));
    const shown = importFailure(fromStore);
    expect(shown.code).toBe('CONFLICT');
    expect(shown.message).toBe(IMPORT_CONFLICT_MESSAGE);
  });

  it('アプリや DB の関数が決めた文言（権限・入力の誤り・使用中・形式）は、どの行かと一緒に出す', () => {
    const validation = importFailure(new StoreError('VALIDATION', '同じ値が既に登録されています'));
    expect(validation.code).toBe('VALIDATION');
    expect(validation.message).toBe(`${IMPORT_FAILED}。同じ値が既に登録されています`);
    expect(importFailure(new StoreError('FORBIDDEN', '権限がありません')).message).toBe(`${IMPORT_FAILED}。権限がありません`);
    expect(importFailure(new StoreError('LOCKED', '現在ほかの処理で使用中です。')).code).toBe('LOCKED');

    const ownValidation = importFailure(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT prod-1: VALIDATION: 価格は 0 以上で入力してください'));
    expect(ownValidation.code).toBe('VALIDATION');
    expect(ownValidation.message).toBe(`${IMPORT_FAILED}。価格は 0 以上で入力してください（商品コード「prod-1」）`);
    // 権限の説明の文は出す（文が無ければ「権限がありません」）
    const ownForbidden = importFailure(
      new StoreError('INTERNAL', 'IMPORT_VARIANT_CHOICE UPSERT c-x: FORBIDDEN: 本部商品の選択肢の原価差額は本部だけが登録できます')
    );
    expect(ownForbidden.code).toBe('FORBIDDEN');
    expect(ownForbidden.message).toBe(`${IMPORT_FAILED}。本部商品の選択肢の原価差額は本部だけが登録できます（選択肢のコード「c-x」）`);
    expect(importFailure(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT prod-1: FORBIDDEN')).message).toBe(
      `${IMPORT_FAILED}。権限がありません。（商品コード「prod-1」）`
    );
    // 印だけの LOCKED は、使用中の案内
    const locked = importFailure(new StoreError('INTERNAL', 'IMPORT_VARIANT_GROUP UPSERT g-1: LOCKED'));
    expect(locked.code).toBe('LOCKED');
    expect(locked.message).toContain('使用中');
    expect(locked.message).toContain('選択項目のコード「g-1」');
    // 全体の形式の誤り（包まれていない DB の関数の文）
    const format = importFailure(new StoreError('INTERNAL', 'IMPORT_VALIDATION: 一括登録データの形式が正しくありません'));
    expect(format.code).toBe('VALIDATION');
    expect(format.message).toBe(`${IMPORT_FAILED}。一括登録データの形式が正しくありません`);
  });

  it('商品コードに「: 」が入っていても、長くても、理由の印で切り分ける（長いコードは 64 文字で切る）', () => {
    const colon = importFailure(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT 商品: A: VALIDATION: 価格が正しくありません'));
    expect(colon.code).toBe('VALIDATION');
    expect(colon.message).toBe(`${IMPORT_FAILED}。価格が正しくありません（商品コード「商品: A」）`);
    const longCode = 'p'.repeat(80);
    const long = importFailure(new StoreError('INTERNAL', `IMPORT_OPTION UPSERT ${longCode}: IMPORT_CONFLICT: stale`));
    expect(long.code).toBe('CONFLICT');
    const longValidation = importFailure(new StoreError('INTERNAL', `IMPORT_OPTION UPSERT ${longCode}: VALIDATION: x`));
    expect(longValidation.message).toContain(`商品コード「${'p'.repeat(64)}…」`);
  });

  it('Excel の値が DB の決まりに合わないときは、SQL の文を出さずに、直す行を伝える（何度やっても同じなので「時間をおいて」にしない）', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = 'IMPORT_OPTION UPSERT prod-1: duplicate key value violates unique constraint "options_code_key"';
    const error = importFailure(new StoreError('INTERNAL', raw));
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe(
      `${IMPORT_FAILED}。Excel の商品コード「prod-1」の行に、登録できない値があります（空欄・重複・形式・長さなど）。直してから、もう一度お試しください。`
    );
    expect(error.message).not.toMatch(/duplicate|constraint|options_code_key|IMPORT_OPTION/);
    expect(log).toHaveBeenCalledWith('[catalog-import] apply_catalog_import failed', { message: raw });
    // 選択肢の行・型の変換の誤り
    const cast = importFailure(new StoreError('INTERNAL', 'IMPORT_VARIANT_CHOICE UPSERT c-9: invalid input syntax for type numeric: "abc"'));
    expect(cast.code).toBe('VALIDATION');
    expect(cast.message).toContain('Excel の選択肢のコード「c-9」の行');
    expect(cast.message).not.toContain('numeric');
    // コードの無い行（(codeなし)）は、コードを出さない
    const noCode = importFailure(new StoreError('INTERNAL', 'IMPORT_OPTION UPSERT (codeなし): null value in column "code" violates not-null constraint'));
    expect(noCode.message).toContain('Excel の内容に、登録できない値があります');
    expect(noCode.message).not.toContain('(codeなし)');
  });

  it('想定外の DB のエラーは、SQL の文を出さず、止まった行と案内だけを出す（文はサーバーの記録へ）', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const raw = 'IMPORT_OPTION UPSERT prod-1: could not serialize access due to concurrent update';
    const error = importFailure(new StoreError('INTERNAL', raw));
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe(`${IMPORT_FAILED}。商品コード「prod-1」の登録で止まりました。${IMPORT_UNEXPECTED}`);
    expect(error.message).not.toMatch(/serialize|concurrent/);
    expect(log).toHaveBeenCalledWith('[catalog-import] apply_catalog_import failed', { message: raw });
    // 包み方の分からないエラー・Error でないもの
    expect(importFailure(new Error('relation "public.option_variant_groups" does not exist')).message).toBe(`${IMPORT_FAILED}。${IMPORT_UNEXPECTED}`);
    expect(importFailure('boom').message).toBe(`${IMPORT_FAILED}。${IMPORT_UNEXPECTED}`);
  });
});
