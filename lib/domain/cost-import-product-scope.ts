import type { CostImportProduct } from '@/lib/data/option-cost-import';

/** 商品本体の原価Versionを1商品の登録済み金額だけに限定する。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ProductImportScope =
  | { valid: true; id: string; amount: number }
  | { valid: false };

/** 指定がない場合だけ通常画面とし、片方欠落などは必ず不正扱いにする。 */
export function parseProductImportScope(
  rawId: string | undefined,
  rawAmount: string | undefined
): ProductImportScope | null {
  if (rawId === undefined && rawAmount === undefined) return null;
  if (!rawId || !UUID.test(rawId) || !rawAmount || !/^[1-9][0-9]{0,8}$/.test(rawAmount)) {
    return { valid: false };
  }
  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(amount) || amount > 100_000_000) return { valid: false };
  return { valid: true, id: rawId.toLowerCase(), amount };
}

/**
 * 指定の1商品が「原価Version未登録・商品台帳の価格が一致・正式公開中」
 * のときだけ返す。選択肢はすべて除外し、商品本体以外を登録できないようにする。
 */
export function narrowProductImport(
  products: CostImportProduct[],
  scope: { id: string; amount: number }
): CostImportProduct[] | null {
  const match = products.find((product) => product.id.toLowerCase() === scope.id);
  if (!match || match.state !== 'import' || match.currentAmount !== null || match.amount !== scope.amount) return null;
  return [{ ...match, choices: [] }];
}
