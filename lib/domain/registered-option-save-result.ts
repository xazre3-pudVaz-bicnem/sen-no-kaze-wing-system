/** 保存済み商品の遷移先。エラー詳細や原価はURLに含めない。 */
export function registeredOptionLedgerUrl(optionId: string, result: { costRecordingFailed?: boolean }): string {
  const params = new URLSearchParams({ updated_option: optionId });
  if (result.costRecordingFailed) params.set('cost_recording_failed', '1');
  return `/admin/ledger?${params.toString()}`;
}
