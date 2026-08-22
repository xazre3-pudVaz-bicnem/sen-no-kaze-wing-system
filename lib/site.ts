/** サイト共通定数（会社情報・SEO） */

export const SITE_NAME = 'Wing｜折り畳み式木造コンテナ';
export const SITE_SHORT_NAME = 'Wing';
export const PROJECT_NAME = '千の風プロジェクト';

export const COMPANY = {
  name: '株式会社 技術の杜',
  nameEn: 'Technology Forest Co., Ltd.',
  url: 'https://gijutsu.co.jp/',
  tel: '0120-030-205',
  telHours: '受付時間 9:00〜18:00（土日祝を除く）※要確認',
  headOffice: '千葉県千葉市花見川区西小中台2番29棟202',
  branches: [
    { name: '七尾営業所', address: '石川県七尾市池崎町（番地は確認中）' },
    { name: '穴水営業所', address: '石川県鳳珠郡穴水町大町（番地は確認中）' },
  ],
  /** 適格請求書発行事業者登録番号（見積書テンプレートより） */
  invoiceRegistrationNo: 'T6040001123237',
  /** 振込先（見積書テンプレートより） */
  bank: {
    name: '北日本銀行 本宮支店',
    type: '普通',
    number: '7084800',
    holder: 'カ）ギジュツノモリ',
  },
  /** 支払条件（見積書テンプレートより） */
  paymentTerms: '工事完了後1週間以内',
  /** 見積書に記載する備考 */
  quoteNotes: [
    '本見積書は工場生産分（本体・オプション）の概算です。別途工事（運送費・設計監理及び確認申請費・梱包養生・現場設置工事・電気設備工事・給排水給湯設備工事・基礎工事・廃材処分費・現場諸費用）は設置場所の確認後、代理店よりお見積りします。',
    '照明器具は電気設備工事に含みます。',
    '上下水道・電気・ガスの引き込み工事は含まれておりません。',
    '有効期限を過ぎたお見積りは、改めて作成させていただきます。',
  ],
} as const;

/** 見積の有効期限（日） */
export const QUOTE_VALID_DAYS = 30;

/** 画面に表示する価格注記 */
export const PRICE_DISCLAIMER =
  '表示価格は工場生産分（本体・オプション・諸費用）の概算（税込）です。運送費・現地工事費等の別途工事は設置場所確認後に確定します。';

export function getSiteUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function absoluteUrl(path: string): string | undefined {
  const base = getSiteUrl();
  return base ? `${base}${path}` : undefined;
}
