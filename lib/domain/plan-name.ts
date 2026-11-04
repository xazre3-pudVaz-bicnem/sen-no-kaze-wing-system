/** お客様のプランを区別しやすくする表示用の初期名。正式な見積番号・Revisionではない。 */
export function suggestPlanName(
  modelName: string,
  specName: string,
  fireSpec: string | null,
  date: Date
): string {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const dateLabel = `${parts.get('month')}/${parts.get('day')} ${parts.get('hour')}:${parts.get('minute')}`;
  return [modelName.trim(), specName.trim(), fireSpec?.trim(), dateLabel].filter(Boolean).join('｜').slice(0, 60);
}

/** 新規プランの従来の初期名だけ自動提案で置き換える。お客様が付けた名前・保存済みの名前には触れない。 */
export function isLegacyAutomaticPlanName(name: string, modelName: string): boolean {
  return name.trim() === `${modelName} の仕様`;
}
