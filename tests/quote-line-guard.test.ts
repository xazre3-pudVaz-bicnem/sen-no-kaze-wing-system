import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { QUOTE_LINE_GUARD_PENDING_MESSAGE, assertQuoteLineGuardReady, quoteLineGuardState, resetQuoteLineGuardForTest } from '@/lib/data/quote-line-guard';
import { StoreError } from '@/lib/data/store';
import { porSelectionUnavailableReason } from '@/lib/domain/quote-por';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

/** rpc の結果を順に返す偽の DB（呼ばれた回数も数える） */
function fakeDb(...results: { code?: string; message?: string }[]) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      const error = results.shift();
      return { error: error ?? null };
    },
  };
}

const MISSING = { code: 'PGRST202', message: 'Could not find the function public.get_quote_por_selections(p_quote_id) in the schema cache' };
const NOT_FOUND = { code: 'P0002', message: 'NOT_FOUND' };

describe('マージ後・migration の適用前は、正式見積の発行と状態の印の保存を止める（D1 までの暫定）', () => {
  beforeEach(() => resetQuoteLineGuardForTest());

  it('DB に一覧の RPC が無ければ止める（fail closed）。確認できないときも止める', async () => {
    expect(await quoteLineGuardState(fakeDb(MISSING))).toBe('missing');
    await expect(assertQuoteLineGuardReady(fakeDb(MISSING))).rejects.toThrow(QUOTE_LINE_GUARD_PENDING_MESSAGE);
    await expect(assertQuoteLineGuardReady(fakeDb(MISSING))).rejects.toBeInstanceOf(StoreError);
    expect(await quoteLineGuardState(fakeDb({ code: '08006', message: 'connection failure' }))).toBe('unknown');
    await expect(assertQuoteLineGuardReady(fakeDb({ message: 'fetch failed' }))).rejects.toThrow('DB の状態を確認できませんでした');
  });

  it('確認の仕組みが使えないときの理由（DB の更新前・読み込めない）', () => {
    expect(porSelectionUnavailableReason({ selections: [], confirmed: false, available: true })).toBeNull();
    expect(porSelectionUnavailableReason({ selections: [], confirmed: false, available: false })).toBe('DB の更新（金額未確定の明細の確認）が済むまで発行できません');
    expect(porSelectionUnavailableReason({ selections: [], confirmed: false, available: false, loadError: true })).toContain('画面を再読み込みしてください');
  });

  it('RPC があれば（存在しない見積で NOT_FOUND）通し、その後は確かめない', async () => {
    const db = fakeDb(NOT_FOUND);
    expect(await quoteLineGuardState(db)).toBe('ready');
    await expect(assertQuoteLineGuardReady(db)).resolves.toBeUndefined();
    expect(db.calls).toEqual(['get_quote_por_selections']);
  });

  it('正式見積を作る経路と、印を保存する経路の前で確かめる', () => {
    const supabaseStore = read('lib/data/supabase-store.ts');
    const standard = read('lib/actions/standard-quotes.ts');
    const legacy = read('lib/actions/legacy-accepted-formalization.ts');
    // 改訂（確定見積）・下書きの正式保存
    expect(supabaseStore.match(/^\s+await assertQuoteLineGuardReady\(db\);$/gm)).toHaveLength(2);
    // 下書きの保存・新規登録は、印のある明細があるときだけ
    expect(supabaseStore.match(/if \(input\.items\.some\(\(item\) => isReservedLineStateRemark\(item\.remark\)\)\) await assertQuoteLineGuardReady\(db\);/g)).toHaveLength(2);
    // 標準見積から作る下書きの保存（扱いを選んだとき）と正式保存、旧形式の確定見積
    expect(standard.match(/await quoteLineGuardError\(supabase\)/g)).toHaveLength(2);
    expect(legacy).toContain('const blocked = await quoteLineGuardError(db);');
    expect(legacy.indexOf('await quoteLineGuardError(db);')).toBeLessThan(legacy.indexOf("db.rpc('confirm_quote_por_selections'"));
    // 画面も、確認の仕組みが無い間（読み込めないときも）は発行のボタンを止める。読み込めなくても画面は落とさない
    for (const form of ['components/admin/dealer-forms.tsx', 'components/admin/legacy-accepted-formalization-form.tsx']) {
      expect(read(form)).toContain('...(porSelectionUnavailableReason(porState) ? [porSelectionUnavailableReason(porState) as string] : []),');
    }
    for (const page of ['app/admin/quotes/[id]/edit/page.tsx', 'app/admin/quotes/[id]/formalize/page.tsx']) {
      expect(read(page)).toContain('store.getQuotePorSelections(quote.id, actor).catch(() => ({ ...EMPTY_POR_SELECTION_STATE, loadError: true }))');
    }
  });
});
