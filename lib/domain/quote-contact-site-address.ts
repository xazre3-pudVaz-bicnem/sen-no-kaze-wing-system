/**
 * 連絡先住所と設置先住所が同じ場合の誤入力防止用（見積金額や住所正本には影響しない）。
 * 全角・半角と空白の差だけを吸収し、異なる住所を推測で同一視しない。
 */
export function sameContactAndSiteAddress(
  contactAddress: string | null | undefined,
  siteAddress: string | null | undefined
): boolean {
  const normalized = (address: string | null | undefined) =>
    (address ?? '').normalize('NFKC').replace(/[\s\u3000]+/g, '');
  const contact = normalized(contactAddress);
  const site = normalized(siteAddress);
  return contact.length > 0 && site.length > 0 && contact === site;
}

/** Server Action / Client Form が同じ確認項目名を使う。 */
export const SAME_SITE_ADDRESS_CONFIRMATION_FIELD = 'confirm_same_site_address';
export const SAME_SITE_ADDRESS_CONFIRMATION_MESSAGE =
  '連絡先住所と設置住所が同じです。同じ場所への設置で正しい場合は確認欄にチェックしてください。違う場合は詳しい設置住所を修正するか、未定なら空欄にしてください。';
