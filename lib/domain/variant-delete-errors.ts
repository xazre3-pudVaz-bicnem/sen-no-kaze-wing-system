/**
 * 下書き商品の選択項目・選択肢の安全削除（DB の delete_unused_variant_choice / group）の失敗を、画面の文にする。
 * DB は理由を P0001 の文の先頭（FORBIDDEN・LOCKED・NOT_FOUND・VALIDATION）で返すので、コードだけでなく先頭も見る。
 */
export function variantDeleteErrorMessage(error: { code?: string | null; message?: string | null }): string {
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (code === 'PGRST202') return '安全削除のDB機能が未反映です。削除されていません。';
  if (code === '42501' || message.startsWith('FORBIDDEN') || message.startsWith('UNAUTHENTICATED')) {
    return 'この選択肢を削除する権限がありません。';
  }
  if (code === '55P03' || code === '40P01' || message.startsWith('LOCKED')) {
    return 'ほかの保存処理と重なりました。削除していません。少し時間をおいてもう一度お試しください。';
  }
  if (message.startsWith('NOT_FOUND')) return '対象の選択項目・選択肢が見つかりません（すでに削除された可能性があります）。';
  if (message.startsWith('VALIDATION') && message.includes('表示条件')) {
    return '別の選択項目の表示条件に使われているため削除できません。先に表示条件を外してください。';
  }
  if (message.startsWith('VALIDATION') && message.includes('下書き商品だけ')) {
    return '下書き商品以外の選択肢は、この画面から削除できません。';
  }
  if (code === '23503' || code === 'P0001') {
    return '保存済み仕様・見積・履歴・原価の記録で使用中、または安全確認ができないため削除できません。非表示にしてください。';
  }
  return '安全確認ができないため削除されませんでした。';
}
