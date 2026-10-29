import { FREE_PRODUCT_CATEGORY_CODE, type OptionVariantChoice, type ProductOption } from '@/lib/domain/types';

/**
 * 商品標準原価・原価差額（v2.5 PR-A3）を、誰に見せて誰に入力させるかの決まり。
 * 画面（サーバー・クライアント）と Server Action で同じ決まりを使う。
 */
export type CostRecordingAccess = {
  /** 原価の Version の仕組みが DB にある（ローカル検証モード・migration 未適用なら false） */
  available: boolean;
  /** 原価を記録・閲覧できる（本部） */
  canManage: boolean;
  /** 権限の確認ができなかった（一時的な失敗）。表示は隠し、保存は止める */
  error?: boolean;
};

/** 原価の欄を出すか。仕組みが無い間（ローカル・未適用）は従来どおり誰でも、ある間は本部だけ */
export function canEditCostField(access: CostRecordingAccess) {
  if (access.error) return false;
  return !access.available || access.canManage;
}

/**
 * 本部標準原価（商品標準原価・原価差額）の対象になる「本部商品」か。
 * 本部だけに限るのは本部商品の原価だけで、総代理店商品・代理店商品の登録の権限は変えない（2026-10-29 先方の回答）。
 * いまの作りには所有組織（総代理店商品・代理店商品）の区分がまだ無く、本部商品の外にあるのは旧フリー商品（代理店が登録した商品）だけ。
 * 所有組織の区分を足すときは、ここで「所有組織が本部以外」の商品を本部商品の外にする。
 * カテゴリーが分からない商品は本部商品として扱う（原価を見せない側に倒す）。
 */
export function isHqCostProduct(categoryCode: string | null | undefined) {
  return categoryCode !== FREE_PRODUCT_CATEGORY_CODE;
}

/** この商品の金額の欄を出し、保存に使うか。本部商品は canEditCostField、本部商品の外（旧フリー商品）は従来どおり */
export function canEditProductCost(access: CostRecordingAccess, categoryCode: string | null | undefined) {
  return !isHqCostProduct(categoryCode) || canEditCostField(access);
}

/**
 * 原価を出さない担当者のために、クライアントへ渡す商品から金額を外す（表示を隠すだけでなく、渡すデータにも残さない）。
 * 別途見積かどうか・メーカー参考価格は原価ではないので残す。
 */
export function withoutOptionCost<T extends Pick<ProductOption, 'price'>>(option: T): T {
  return { ...option, price: 0 };
}

export function withoutChoiceCost<T extends Pick<OptionVariantChoice, 'extra_price'>>(choice: T): T {
  return { ...choice, extra_price: 0 };
}

/** 商品の一覧をクライアントへ渡す前に、この担当者に見せない本部商品の原価だけを外す */
export function withoutHqOptionCosts<T extends Pick<ProductOption, 'price' | 'category_id'>>(
  options: T[],
  access: CostRecordingAccess,
  categoryCodeById: ReadonlyMap<string, string>
): T[] {
  if (canEditCostField(access)) return options;
  return options.map((option) => (isHqCostProduct(categoryCodeById.get(option.category_id)) ? withoutOptionCost(option) : option));
}
