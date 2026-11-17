/**
 * 候補を適用したと仮定した状態で正式な税込総額を再評価する。
 * 選択中カードの差額を流用しない。価格計算・保存・DBは変更しない。
 */
import {
  createSimulatorCardDeltaEvaluator,
  type SimulatorCardDelta,
  type SimulatorCardPlanSelection,
  type SimulatorCardPriceInput,
  type SimulatorCardTarget,
} from './simulator-card-price-delta';

export function simulatorCandidatePriceDelta(
  context: SimulatorCardPriceInput,
  target: SimulatorCardTarget,
  candidate: SimulatorCardPlanSelection
): SimulatorCardDelta {
  return createSimulatorCardDeltaEvaluator({ ...context, current: candidate }).evaluate(target);
}
