import type { OptionVariantChoice, ProductOption } from '@/lib/domain/types';

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
 * 原価を出さない担当者のために、クライアントへ渡す商品から金額を外す（表示を隠すだけでなく、渡すデータにも残さない）。
 * 別途見積かどうか・メーカー参考価格は原価ではないので残す。
 */
export function withoutOptionCost<T extends Pick<ProductOption, 'price'>>(option: T): T {
  return { ...option, price: 0 };
}

export function withoutChoiceCost<T extends Pick<OptionVariantChoice, 'extra_price'>>(choice: T): T {
  return { ...choice, extra_price: 0 };
}
