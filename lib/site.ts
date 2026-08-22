/** サイト共通定数（会社情報・SEO） */

export const SITE_NAME = '千の風プロジェクト｜折畳木造コンテナホテル Wing';
export const SITE_SHORT_NAME = 'Wing';
export const PROJECT_NAME = '千の風プロジェクト';

export interface Office {
  name: string;
  postal: string;
  address: string;
  tel?: string;
}

export const OFFICES: Office[] = [
  { name: '本社', postal: '〒262-0016', address: '千葉県千葉市花見川区西小中台２番' },
  { name: '穴水事務所', postal: '〒927-0026', address: '石川県鳳珠郡穴水町字大町に１番２' },
  { name: '七尾事務所', postal: '〒926-0831', address: '石川県七尾市池崎町５番地甲', tel: '0767-58-3688' },
];

export const COMPANY = {
  name: '株式会社 技術の杜',
  nameEn: 'gijyutsunomori Inc.',
  url: 'https://gijutsu.co.jp/',
  /** フリーダイヤル（パンフレット記載） */
  tel: '0120-030-205',
  /** 七尾事務所（特商法表記の連絡先） */
  officeTel: '0767-58-3688',
  telHours: '受付時間 9:00〜18:00（土日祝を除く）※要確認',
  representative: '千代川 健裕',
  representativeBio: '建築業界に約45年。木造住宅の設計・施工に長年携わり、構造計算による設計から大工としての施工まで一貫して手がける。',
  established: '2022年4月28日',
  capital: '2,950万円',
  business: ['木造建築の設計・施工（構造計算を含む）', '折り畳み式木造コンテナの製造・販売', '宿泊施設の運営・開業支援'],
  licenses: ['二級建築士事務所 千葉県知事登録 第2-2206-7434号', '建設業 千葉県知事許可 (般-4) 第055799号'],
  headOffice: '千葉県千葉市花見川区西小中台２番',
  offices: OFFICES,
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
