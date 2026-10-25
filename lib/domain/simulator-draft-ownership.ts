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
