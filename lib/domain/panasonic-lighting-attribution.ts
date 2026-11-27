/**
 * 表示上の提供元名の判定。画像の使用許諾・権利確認そのものは別途行う。
 * 既存台帳の略称と正式社名の両方に対応し、照明以外には適用しない。
 */
export function hasPanasonicLightingAttribution(
  categoryCode: string,
  manufacturer: string | null | undefined,
  imageCount: number
): boolean {
  const normalized = manufacturer?.normalize('NFKC').replace(/\s+/g, '') ?? '';
  return categoryCode === 'lighting' && imageCount > 0 && (
    normalized === 'パナソニック' ||
    normalized === 'パナソニックエレクトリックワークス株式会社'
  );
}
