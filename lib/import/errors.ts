import { StoreError } from '@/lib/data/store';

/**
 * 商品台帳の一括登録（Excel の取り込み）のエラーの伝え方（商品公開原子性 v6.1 の H2-B／2026-11-25 の工程の P1）。
 *
 * - 競合（DB が SQLSTATE P0001 と決まった印 IMPORT_CONFLICT: で知らせる）は、決まった文言で
 *   「最新の状態を読み込んで、もう一度」と案内する。「ほかの人が変えた」とは言い切らない
 *   （古い取り込みの内容が、今の台帳と合わないだけのこともあるため）。行の処理の中で起きて包まれて返っても、競合のまま伝える
 * - 権限・入力の誤り・使用中など、アプリや DB の関数が決めた文言のエラーは、その文言を出す
 * - Excel の値が DB の決まりに合わない（空欄・重複・形式など）ときは、どの行を直せばよいかを伝える
 * - 想定外の DB のエラー（SQL の文が入りうる）は画面に出さず、サーバーの記録にだけ残す
 * - どの場合も、何も反映していないことを伝える（一括登録は 1 つのトランザクション）
 *
 * DB の関数 apply_catalog_import（migration 0016）は、行ごとのエラーを次の形で包んで返す。
 *   IMPORT_OPTION 操作 商品コード: 理由／IMPORT_VARIANT_GROUP UPSERT 選択項目のコード: 理由／IMPORT_VARIANT_CHOICE UPSERT 選択肢のコード: 理由
 * 全体のエラーは FORBIDDEN（42501）と IMPORT_VALIDATION: 形式の誤り。
 * ローカル検証モードのストアには競合の印が無い（DB の競合の印は v6.1 の D で入る。ここは単体の試験で確かめる）
 */

export const IMPORT_FAILED = '商品台帳の一括登録に失敗しました（商品・選択項目・選択肢は反映されませんでした）';

/** 競合のときの決まった文言 */
export const IMPORT_CONFLICT_MESSAGE = `${IMPORT_FAILED}。取り込もうとした内容が、今の商品台帳と合わなくなりました。商品台帳を開き直して最新の状態を読み込み、もう一度お試しください。`;

/** 想定外のエラーのときに足す案内 */
export const IMPORT_UNEXPECTED = '時間をおいて、もう一度お試しください。続くときは、管理者にお知らせください。';

/** ほかの処理が使用中のとき */
const IMPORT_BUSY = '現在ほかの処理で使用中です。少し時間をおいて再度お試しください。';

/** DB の競合の印（apply_catalog_import が RAISE で返す。v6.1 の設計：SQLSTATE P0001 かつ文の先頭が IMPORT_CONFLICT:） */
export function isImportConflict(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return e?.code === 'P0001' && (e.message ?? '').startsWith('IMPORT_CONFLICT:');
}

/** DB の関数が自分で書いた文の印。この印で始まる理由は画面に出してよい（印の後ろの文を出す） */
const OWN_MESSAGE_PREFIXES = ['IMPORT_VALIDATION:', 'VALIDATION:', 'CONFLICT:', 'DEPENDENCY:', 'REQUIRED:', 'SINGLE:', 'RETIRED:'];
/** 包まれた理由の始まりの目印（商品コードに「: 」が入っていても切り違えないよう、これを先に探す） */
const REASON_START = /: (?=IMPORT_CONFLICT:|IMPORT_VALIDATION:|VALIDATION:|CONFLICT:|DEPENDENCY:|REQUIRED:|SINGLE:|RETIRED:|FORBIDDEN|LOCKED)/;
/** Excel の値が DB の決まりに合わないときの、Postgres の文の特徴（制約の違反・型の変換・長さ・範囲） */
const DATA_ERROR = /violates|invalid input syntax|invalid input value|value too long|out of range|malformed/i;

const WRAPPED_HEAD = /^IMPORT_(OPTION|VARIANT_GROUP|VARIANT_CHOICE) \S+ /;
const PLACE_LABEL = { OPTION: '商品コード', VARIANT_GROUP: '選択項目のコード', VARIANT_CHOICE: '選択肢のコード' } as const;

interface Wrapped {
  /** 例：商品コード「prod-1」 */
  place: string | null;
  reason: string;
}

function cleanCode(raw: string): string | null {
  const code = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!code || code === '(codeなし)') return null;
  return code.length > 64 ? `${code.slice(0, 64)}…` : code;
}

/** 行ごとのエラーの包み（IMPORT_OPTION など）なら、どの行かと理由に分ける */
function splitWrapped(message: string): Wrapped | null {
  const head = WRAPPED_HEAD.exec(message);
  if (!head) return null;
  const rest = message.slice(head[0].length);
  const known = REASON_START.exec(rest);
  const cut = known ? known.index : rest.indexOf(': ');
  if (cut < 0) return { place: null, reason: rest };
  const code = cleanCode(rest.slice(0, cut));
  const label = PLACE_LABEL[head[1] as keyof typeof PLACE_LABEL];
  return { place: code ? `${label}「${code}」` : null, reason: rest.slice(cut + 2) };
}

/** 印の後ろの文（「印:」の後ろ、または「印」の後ろ）。無ければ空 */
function afterMark(reason: string, mark: string): string {
  return reason.slice(mark.length).replace(/^:\s*/, '').trim();
}

/** 理由が決まった印で始まるなら、画面に出す StoreError にする。そうでなければ null */
function ownReason(reason: string, place: string | null): StoreError | null {
  const at = place ? `（${place}）` : '';
  if (reason.startsWith('IMPORT_CONFLICT:')) return new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE);
  if (reason.startsWith('FORBIDDEN')) {
    const text = afterMark(reason, 'FORBIDDEN');
    return new StoreError('FORBIDDEN', `${IMPORT_FAILED}。${text || '権限がありません。'}${at}`);
  }
  if (reason.startsWith('LOCKED')) {
    const text = afterMark(reason, 'LOCKED');
    return new StoreError('LOCKED', `${IMPORT_FAILED}。${text || IMPORT_BUSY}${at}`);
  }
  const prefix = OWN_MESSAGE_PREFIXES.find((p) => reason.startsWith(p));
  if (!prefix) return null;
  const text = afterMark(reason, prefix);
  if (!text) return null;
  return new StoreError('VALIDATION', `${IMPORT_FAILED}。${text}${at}`);
}

/** 一括登録の反映（apply_catalog_import）で起きたエラーを、画面に出してよい StoreError にする */
export function importFailure(error: unknown): StoreError {
  if (error instanceof StoreError && error.code === 'CONFLICT') return new StoreError('CONFLICT', IMPORT_CONFLICT_MESSAGE);
  // アプリが決めた文言（権限・入力の誤り・使用中など）は、その文言を出す
  if (error instanceof StoreError && error.code !== 'INTERNAL') return new StoreError(error.code, `${IMPORT_FAILED}。${error.message}`);
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = splitWrapped(detail);
  const place = wrapped?.place ?? null;
  const own = ownReason(wrapped ? wrapped.reason : detail, place);
  if (own) return own;
  // DB の文はサーバーの記録にだけ残す
  console.error('[catalog-import] apply_catalog_import failed', { message: detail.slice(0, 500) });
  // Excel の値が DB の決まりに合わない：何度やっても同じなので、直す行を伝える
  if (DATA_ERROR.test(wrapped ? wrapped.reason : detail)) {
    const where = place ? `Excel の${place}の行` : 'Excel の内容';
    return new StoreError('VALIDATION', `${IMPORT_FAILED}。${where}に、登録できない値があります（空欄・重複・形式・長さなど）。直してから、もう一度お試しください。`);
  }
  const where = place ? `${place}の登録で止まりました。` : '';
  return new StoreError('INTERNAL', `${IMPORT_FAILED}。${where}${IMPORT_UNEXPECTED}`);
}
