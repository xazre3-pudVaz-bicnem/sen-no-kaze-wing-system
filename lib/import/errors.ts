import { StoreError } from '@/lib/data/store';

/**
 * 商品台帳の一括登録（Excel の取り込み）のエラーの伝え方（商品公開原子性 v6.1 の H2-B／2026-11-25 の工程の P1）。
 *
 * - 競合（DB が SQLSTATE P0001 と決まった印 IMPORT_CONFLICT: で知らせる）は、決まった文言で
 *   「最新の状態を読み込んで、もう一度」と案内する。「ほかの人が変えた」とは言い切らない
 *   （古い取り込みの内容が、今の台帳と合わないだけのこともあるため）
 * - 権限・入力の誤りなど、アプリ（DB の関数を含む）が決めた文言のエラーは、その文言を出す
 * - 想定外の DB のエラー（SQL の文が入りうる）は画面に出さず、サーバーの記録にだけ残す。
 *   今の DB は「IMPORT_OPTION 操作 商品コード: 理由」で返すので、止まった商品のコードだけを伝える
 * - どの場合も、何も反映していないことを伝える（一括登録は 1 つのトランザクション）
 */

export const IMPORT_FAILED = '商品台帳の一括登録に失敗しました（商品・選択項目・選択肢は反映されませんでした）';

/** 競合のときの決まった文言 */
export const IMPORT_CONFLICT_MESSAGE = `${IMPORT_FAILED}。取り込もうとした内容が、今の商品台帳と合わなくなりました。商品台帳を開き直して最新の状態を読み込み、もう一度お試しください。`;

/** 想定外のエラーのときに足す案内 */
export const IMPORT_UNEXPECTED = '時間をおいて、もう一度お試しください。続くときは、管理者にお知らせください。';

/** DB の競合の印（apply_catalog_import が RAISE で返す。v6.1 の設計：SQLSTATE P0001 かつ文の先頭が IMPORT_CONFLICT:） */
export function isImportConflict(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return e?.code === 'P0001' && (e.message ?? '').startsWith('IMPORT_CONFLICT:');
}

/** DB の関数が自分で書いた文（先頭の印で分かる）。これだけは画面に出してよい */
const OWN_MESSAGE_PREFIXES = ['VALIDATION:', 'CONFLICT:', 'DEPENDENCY:', 'REQUIRED:', 'SINGLE:', 'RETIRED:', 'LOCKED:'];

/** 「IMPORT_OPTION 操作 商品コード: 理由」の形なら、商品コードと理由に分ける */
function splitWrapped(message: string): { productCode: string | null; reason: string } | null {
  const m = /^IMPORT_OPTION \S+ (.{1,64}?): ([\s\S]*)$/.exec(message);
  if (!m) return null;
  const code = m[1].replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return { productCode: code && code !== '(codeなし)' ? code : null, reason: m[2] };
}

/** 理由が DB の関数の書いた文なら、画面に出す StoreError にする。そうでなければ null */
function ownReason(reason: string): StoreError | null {
  if (reason.startsWith('IMPORT_CONFLICT:')) return new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE);
  if (reason.startsWith('FORBIDDEN')) return new StoreError('FORBIDDEN', `${IMPORT_FAILED}。権限がありません。`);
  const prefix = OWN_MESSAGE_PREFIXES.find((p) => reason.startsWith(p));
  if (!prefix) return null;
  const text = reason.slice(prefix.length).trim();
  if (!text) return null;
  return new StoreError(prefix === 'LOCKED:' ? 'LOCKED' : 'VALIDATION', `${IMPORT_FAILED}。${text}`);
}

/** 一括登録の反映（apply_catalog_import）で起きたエラーを、画面に出してよい StoreError にする */
export function importFailure(error: unknown): StoreError {
  if (error instanceof StoreError && error.code === 'CONFLICT') return new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE);
  // アプリが決めた文言（権限・入力の誤り・使用中など）は、その文言を出す
  if (error instanceof StoreError && error.code !== 'INTERNAL') return new StoreError(error.code, `${IMPORT_FAILED}。${error.message}`);
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = splitWrapped(detail);
  const own = wrapped ? ownReason(wrapped.reason) : null;
  if (own) return own;
  // 想定外：DB の文はサーバーの記録にだけ残す
  console.error('[catalog-import] apply_catalog_import failed', { message: detail.slice(0, 500) });
  const where = wrapped?.productCode ? `商品コード「${wrapped.productCode}」の登録で止まりました。` : '';
  return new StoreError('INTERNAL', `${IMPORT_FAILED}。${where}${IMPORT_UNEXPECTED}`);
}
