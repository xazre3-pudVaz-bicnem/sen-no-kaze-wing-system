import 'server-only';
import { isMissingNamedFunction } from './schema-compat';
import { StoreError } from './store';

/**
 * 本番 DB に 20261016111000（正式見積で金額未確定の明細を残さない止め）が入っているかの確認（D1 までの暫定）。
 *
 * main へのマージ（Vercel の自動デプロイ）から migration の適用までの間は、DB の正式見積の関数がまだ旧い。
 * その間に正式見積を発行したり、「0円確定」「対象外」の印を保存したり（適用前の確認で止まる）しないよう、
 * 発行と印の保存の前にこれを確かめる。分からないときは入っていないとみなす（fail closed）。
 * 入ったと分かったら、その後は確かめない（migration は戻さない）。
 */
type RpcResult = { error: { code?: string; message?: string } | null };
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

let guardReady = false;

/** 存在しない見積の ID（一覧の RPC が NOT_FOUND を返せば、migration は入っている） */
const PROBE_QUOTE_ID = '00000000-0000-0000-0000-000000000000';

export const QUOTE_LINE_GUARD_PENDING_MESSAGE =
  '正式見積の発行と「0円確定」「対象外」の保存は、DB の更新（金額未確定の明細の確認）が済むまで止めています。下書きの保存と Web の概算は使えます。';
const QUOTE_LINE_GUARD_UNKNOWN_MESSAGE = 'DB の状態を確認できませんでした。時間をおいて再度お試しください。';

export async function quoteLineGuardState(db: RpcClient): Promise<'ready' | 'missing' | 'unknown'> {
  if (guardReady) return 'ready';
  const { error } = await db.rpc('get_quote_por_selections', { p_quote_id: PROBE_QUOTE_ID });
  if (!error || error.code === 'P0002' || (error.message ?? '').startsWith('NOT_FOUND')) {
    guardReady = true;
    return 'ready';
  }
  if (isMissingNamedFunction(error, 'get_quote_por_selections')) return 'missing';
  return 'unknown';
}

/** 入っていなければ、発行・印の保存をせずに止める */
export async function assertQuoteLineGuardReady(db: RpcClient): Promise<void> {
  const state = await quoteLineGuardState(db);
  if (state === 'missing') throw new StoreError('VALIDATION', QUOTE_LINE_GUARD_PENDING_MESSAGE);
  if (state === 'unknown') throw new StoreError('VALIDATION', QUOTE_LINE_GUARD_UNKNOWN_MESSAGE);
}

/** テスト用：確認の結果を忘れる */
export function resetQuoteLineGuardForTest(): void {
  guardReady = false;
}
