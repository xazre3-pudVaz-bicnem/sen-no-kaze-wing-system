import type { ElectronicContract, ElectronicContractStatus, Quote } from './types';

/**
 * 契約書テンプレート（GMOサイン上で本部が管理）へ渡す差し込み項目。
 * 項目名は GMOサイン側のテンプレートの差し込み項目名と完全に一致させる（docs/electronic-contract-gmosign.md）。
 * 金額は承諾済み見積のスナップショットをそのまま使い、ここで再計算しない。
 */
export const CONTRACT_INSET_ITEM_NAMES = [
  '見積番号',
  'お客様名',
  '会社名',
  '商品',
  '税抜金額',
  '消費税',
  '契約金額（税込）',
  '見積発行日',
] as const;

const yen = (value: number) => `${value.toLocaleString('ja-JP')}円`;

function jaDate(iso: string): string {
  const date = new Date(iso);
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}年${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日`;
}

export function contractInsetItems(
  quote: Pick<Quote, 'quote_no' | 'customer_name' | 'customer_company' | 'base_model_name' | 'subtotal' | 'tax' | 'total' | 'issued_at'>
): Array<{ name: (typeof CONTRACT_INSET_ITEM_NAMES)[number]; value: string }> {
  return [
    { name: '見積番号', value: quote.quote_no },
    { name: 'お客様名', value: quote.customer_name ?? '' },
    { name: '会社名', value: quote.customer_company ?? '' },
    { name: '商品', value: quote.base_model_name ?? '' },
    { name: '税抜金額', value: yen(quote.subtotal) },
    { name: '消費税', value: yen(quote.tax) },
    { name: '契約金額（税込）', value: yen(quote.total) },
    { name: '見積発行日', value: quote.issued_at ? jaDate(quote.issued_at) : '' },
  ];
}

export const CONTRACT_STATUS_LABEL: Record<ElectronicContractStatus, string> = {
  sending: '送信処理中',
  sent: 'お客様の署名待ち',
  signed: '締結済み',
  canceled: '取り消し',
  failed: '送信失敗',
};

/** 案件で現在有効な契約（送信処理中・署名待ち・締結済み）。無ければ null */
export function activeContract(contracts: ElectronicContract[]): ElectronicContract | null {
  return contracts.find((contract) => contract.status === 'sending' || contract.status === 'sent' || contract.status === 'signed') ?? null;
}
