/**
 * ブラウザに保存したプラン下書きを、現在の利用者へ復元してよいか判定する。
 * 保存済みConfigurationのIDはアカウントに紐づけ、別のログイン利用者には引き継がない。
 * 旧形式（ownerIdなし）でconfigIdがあるデータも所有者を検証できないため復元しない。
 * 未ログインで選択した未保存プランは、会員登録・ログイン後も引き継ぐ。
 */
export function canRestoreSimulatorDraft(
  draft: { ownerId?: string | null; configId?: string | null },
  viewerId: string | null
): boolean {
  if (draft.ownerId != null) return draft.ownerId === viewerId;
  return !draft.configId;
}

/**
 * 通常のシミュレーター入口は新しいプランとして開く。
 * ブラウザ内の保存済み ID を新規画面へ復元しない（既存プランは ?c= からサーバーで取得する）。
 * ログイン後の明示的な ?resume=1 は選択内容だけを復元できる。
 */
export function canRestoreSimulatorSelection(
  draft: { ownerId?: string | null; configId?: string | null },
  viewerId: string | null,
  resume: boolean
): boolean {
  return canRestoreSimulatorDraft(draft, viewerId) && (!draft.configId || resume);
}
