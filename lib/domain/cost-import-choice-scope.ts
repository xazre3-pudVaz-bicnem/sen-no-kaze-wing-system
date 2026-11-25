/** 原価Version取り込み画面で「指定した選択肢だけ」を選べるようにする表示用の限定リスト。 */
import type { CostImportProduct } from '@/lib/data/option-cost-import';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ChoiceScope = { valid: true; ids: string[] } | { valid: false; ids: [] };

/** パラメータ不正時は全面表示へフォールバックせず、必ずエラーとして扱う。 */
export function parseChoiceImportScope(raw: string | undefined): ChoiceScope | null {
  if (raw === undefined) return null;
  if (raw.length > 4000) return { valid: false, ids: [] };
  const ids = raw.split(',').map((id) => id.toLowerCase());
  if (ids.length < 1 || ids.length > 100 || ids.some((id) => !UUID.test(id)) || new Set(ids).size !== ids.length) {
    return { valid: false, ids: [] };
  }
  return { valid: true, ids };
}

/**
 * 選択肢の差額が台帳で明示的に0円・原価Version未記録・通常価格の場合だけ絞り込む。
 * 1件でも消失・額変更・記録済み・別途見積があれば、旧データの一括取り込み画面へ戻さず停止する。
 */
export function narrowZeroCostChoices(products: CostImportProduct[], ids: string[]): CostImportProduct[] | null {
  if (!ids.length) return null;
  const scope = new Set(ids);
  const matched = new Set<string>();
  const narrowed = products.flatMap((product) => {
    if (product.state === 'zero' || product.state === 'por') return [];
    const choices = product.choices.filter((choice) => {
      if (!scope.has(choice.id.toLowerCase())) return false;
      if (choice.state !== 'import' || choice.amount !== 0) return false;
      matched.add(choice.id.toLowerCase());
      return true;
    });
    return choices.length ? [{ ...product, choices }] : [];
  });
  if (matched.size !== scope.size) return null;
  return narrowed;
}
