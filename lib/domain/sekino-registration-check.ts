import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from './types';

type ReviewOption = Pick<ProductOption, 'manufacturer' | 'name' | 'model_no'>;
type ReviewGroup = Pick<OptionVariantGroup, 'id' | 'name' | 'status'>;
type ReviewChoice = Pick<OptionVariantChoice, 'group_id' | 'name' | 'status'>;

/**
 * セキノ興産のカラー品番の「記載漏れらしさ」を知らせるための表示補助。
 * メーカーの正式な品番・許諾適合性を検証するものではない。
 */
export function sekinoRegistrationWarnings(
  option: ReviewOption,
  groups: ReviewGroup[],
  choices: ReviewChoice[]
): string[] {
  if (!option.manufacturer?.includes('セキノ興産')) return [];

  const warnings: string[] = [];
  if (!option.name.trim()) warnings.push('商品名が未入力です。');
  if (!option.model_no?.trim()) warnings.push('シリーズ・型番／品番が未入力です。');

  // 全メーカーに色番号を必須とはしない。お客様に表示するカラー選択肢だけを確認。
  for (const group of groups) {
    if (group.status !== 'published' || !/(カラー|色)/.test(group.name)) continue;
    for (const choice of choices) {
      if (choice.group_id !== group.id || choice.status !== 'published') continue;
      // U96Z・SP-51・708 等の表記が見つからない場合だけ注意を出す。
      // 正式な型番判定ではなく、誤検知の可能性があるため公開を自動停止しない。
      const text = choice.name.normalize('NFKC');
      const hasCodeLikeText = /[a-z]{1,8}[-\s]?\d[a-z\d-]*|\d{2,6}[a-z]{0,8}/i.test(text);
      if (!hasCodeLikeText) {
        warnings.push(`「${group.name}」の「${choice.name}」：色番号の記載がない可能性があります。`);
      }
    }
  }
  return warnings;
}
