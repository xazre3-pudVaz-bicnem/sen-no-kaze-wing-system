import type { SimulatorCardDelta } from './simulator-card-price-delta';

export interface SimulatorCardPricePresentation {
  label: string;
  tone: 'neutral' | 'increase' | 'decrease';
}

/**
 * プランボードだけの表示文言。金額の計算・再丸め・税加算を一切しない。
 * deltaIncludingTax は現在のほかの選択を維持し、対象だけ標準へ戻した税込総額との差。
 * 各カテゴリーの影響額は足し算できるとは限らない。
 */
export function simulatorCardPricePresentation(result: SimulatorCardDelta): SimulatorCardPricePresentation {
  if (result.kind === 'standard') return { label: '基本プランに含む', tone: 'neutral' };
  if (result.kind === 'pending') return { label: '金額確認中', tone: 'neutral' };
  const delta = result.deltaIncludingTax;
  if (delta === 0) return { label: '変更しても差額なし', tone: 'neutral' };
  return {
    label: `${delta > 0 ? '＋' : '−'}${Math.abs(delta).toLocaleString('ja-JP')}円（税込）`,
    tone: delta > 0 ? 'increase' : 'decrease',
  };
}
