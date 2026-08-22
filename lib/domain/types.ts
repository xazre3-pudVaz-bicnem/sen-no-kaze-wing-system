/**
 * Wing 見積シミュレーター ドメイン型定義
 * DB（Supabase）のテーブルと 1:1 で対応する。ローカル検証モードも同じ型を使う。
 */

export type ViewKey = 'exterior' | 'interior' | 'water' | 'floorplan';
export const VIEW_KEYS: ViewKey[] = ['exterior', 'interior', 'water', 'floorplan'];
export const VIEW_LABELS: Record<ViewKey, string> = {
  exterior: '外観',
  interior: '室内',
  water: '水まわり',
  floorplan: '平面図',
};

export type PublishStatus = 'published' | 'draft';
export type RoleCode = 'customer' | 'admin';

/**
 * 注文範囲（どこまで仕上げるか）。
 * 本体＝木造躯体＋屋根＋外壁＋サッシが付いた状態で、そこから先をお客様が選ぶ。
 */
export type FinishLevel = 'shell' | 'equipment' | 'full';
export const FINISH_LEVELS: FinishLevel[] = ['shell', 'equipment', 'full'];
export const FINISH_LEVEL_INFO: Record<FinishLevel, { name: string; short: string; lead: string; includes: string[] }> = {
  shell: {
    name: '本体のみ',
    short: 'DIY・自分で仕上げる',
    lead: '木造躯体・屋根・外壁・サッシ・玄関ドアまでを工場で仕上げてお届けします。内装や設備はご自身で、あるいは地元の工務店で自由に仕上げられます。',
    includes: ['折り畳み式木造躯体・金物一式', '断熱材（床・壁・天井）', '屋根・外壁（ガルバリウム鋼板）', 'サッシ・玄関ドア・窓一式'],
  },
  equipment: {
    name: '本体＋設備',
    short: '必要な設備だけ選ぶ',
    lead: '本体に、ユニットバス・トイレ・キッチン・エアコン・照明などから必要なものだけを加えます。内装の仕上げはご自身で行えます。',
    includes: ['本体のみに含まれるすべて', '浴室・トイレ・洗面・キッチン・給湯・空調', '照明器具・家具・家電・スマートロック'],
  },
  full: {
    name: 'フル装備',
    short: '完全仕上げで引き渡し',
    lead: '床・壁・天井の内装仕上げと造作工事まで含めた、そのまま使える状態でお引き渡しします。ホテル・住宅・事務所の各仕様から選べます。',
    includes: ['本体＋設備に含まれるすべて', '床材・壁／天井の仕上げ', '内部建具', '室内造作工事'],
  },
};
/** shell < equipment < full。カテゴリーは自分のランク以上の注文範囲でだけ選べる */
export function finishLevelRank(level: FinishLevel): number {
  return FINISH_LEVELS.indexOf(level);
}

export interface Role {
  code: RoleCode;
  name: string;
}

export interface Profile {
  id: string; // auth.users.id
  /** 顧客番号（見積書・注文書に記載。C + 6桁連番） */
  customer_no: string | null;
  email: string;
  full_name: string;
  company_name: string | null;
  phone: string | null;
  postal_code: string | null;
  address: string | null;
  role_code: RoleCode;
  created_at: string;
  updated_at: string;
}

/** プラン（見積書テンプレートのシートに相当する推奨構成） */
export interface ModelPreset {
  code: string;
  name: string;
  description: string;
  option_codes: string[];
}

export interface BaseModel {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** 本体一式（工場生産分・諸費用別・税別・円） */
  base_price: number;
  /** 諸費用率（交通費・労災・安全管理費等）。null なら 0.15 */
  expense_rate: number | null;
  presets: ModelPreset[];
  status: PublishStatus;
  sort_order: number;
  /** サイズ・仕様（表示順を保つため配列） */
  specs: { label: string; value: string }[];
  features: { title: string; body: string }[];
  standard_equipment: string[];
  use_cases: string[];
  created_at: string;
  updated_at: string;
}

export type ProductImageKind = 'hero' | 'exterior' | 'interior' | 'floorplan' | 'transport' | 'case';
export const IMAGE_KIND_LABELS: Record<ProductImageKind, string> = {
  hero: 'メイン',
  exterior: '外観',
  interior: '室内',
  floorplan: '平面図',
  transport: '輸送・設置',
  case: '施工事例',
};

export interface ProductImage {
  id: string;
  base_model_id: string;
  kind: ProductImageKind;
  url: string;
  alt: string;
  caption: string | null;
  sort_order: number;
}

export type SelectionMode = 'single' | 'multi';

export interface OptionCategory {
  id: string;
  code: string;
  name: string;
  /** 商品台帳の分類フォルダ（内外装仕上げ／サッシ／内部建具／設備機器／照明器具／家具／その他／防火仕様／別途工事） */
  group_code: string;
  group_name: string;
  group_sort: number;
  description: string | null;
  selection_mode: SelectionMode;
  /** このカテゴリーが含まれ始める注文範囲（shell=本体に必ず含まれる） */
  finish_level: FinishLevel;
  /** single のとき: 必ず 1 つ選ぶ（標準が is_default）。注文範囲に入っているときだけ効く */
  is_required: boolean;
  sort_order: number;
  status: PublishStatus;
}

export interface ProductOption {
  id: string;
  base_model_id: string | null; // null = 全モデル共通
  category_id: string;
  code: string;
  name: string;
  description: string | null;
  price: number; // 税別・円
  image_url: string | null;
  selection_type: 'checkbox' | 'radio';
  is_required: boolean;
  is_default: boolean;
  /** 設置関連費用として集計する */
  is_installation: boolean;
  /** 価格が現地確認後に確定する（0 円で「別途見積」表示） */
  price_on_request: boolean;
  /** 対応する仕様（hotel / residence / office）。空配列 = 全仕様共通 */
  spec_codes: string[];
  /** プレビュー画像切替の識別子（null = 画像に影響しない） */
  preview_key: string | null;
  affects_views: ViewKey[];
  sort_order: number;
  status: PublishStatus;
  created_at: string;
  updated_at: string;
}

export interface OptionDependency {
  id: string;
  option_id: string;
  requires_option_id: string;
  message: string | null;
}

export interface OptionConflict {
  id: string;
  option_id: string;
  conflicts_with_option_id: string;
  message: string | null;
}

export type PreviewRuleKind = 'composite' | 'layer';

export interface PreviewImageRule {
  id: string;
  base_model_id: string;
  view: ViewKey;
  kind: PreviewRuleKind;
  /** composite: この集合と選択状態が完全一致したとき表示。layer: このキーが選択されたとき重ねる（空 = ベース層） */
  preview_keys: string[];
  url: string;
  alt: string;
  note: string | null;
  z_index: number;
  status: PublishStatus;
}

/** 平面図・立面図のクリック領域（カテゴリーの選択ポップアップを開く） */
export interface PreviewHotspot {
  id: string;
  rule_id: string;
  category_id: string;
  label: string;
  /** 画像に対する割合（%） */
  x: number;
  y: number;
  w: number;
  h: number;
  sort_order: number;
}

export interface CatalogBundle {
  model: BaseModel;
  images: ProductImage[];
  categories: OptionCategory[];
  options: ProductOption[];
  dependencies: OptionDependency[];
  conflicts: OptionConflict[];
  previewRules: PreviewImageRule[];
  hotspots: PreviewHotspot[];
}

export type ConfigurationStatus = 'draft' | 'quote_requested' | 'quoted' | 'closed';
export const CONFIGURATION_STATUS_LABELS: Record<ConfigurationStatus, string> = {
  draft: '下書き',
  quote_requested: '見積依頼中',
  quoted: '見積発行済み',
  closed: '完了',
};

export interface Configuration {
  id: string;
  user_id: string;
  base_model_id: string;
  name: string;
  status: ConfigurationStatus;
  /** どこまで仕上げるか */
  finish_level: FinishLevel;
  base_price: number;
  base_expense: number;
  option_subtotal: number;
  option_expense: number;
  installation_subtotal: number;
  adjustment: number;
  subtotal: number;
  tax: number;
  total: number;
  preview_image_url: string | null;
  notes: string | null;
  /** 将来段階: 販売パートナー・契約・図面承認との紐付け用 */
  partner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigurationItem {
  id: string;
  configuration_id: string;
  option_id: string;
  quantity: number;
}

export interface ConfigurationSnapshot {
  id: string;
  configuration_id: string;
  reason: 'saved' | 'quote_requested';
  snapshot: PricingResult & { model_name: string };
  created_at: string;
}

export type QuoteRequestStatus = 'new' | 'reviewing' | 'sent' | 'closed' | 'cancelled';
export const QUOTE_REQUEST_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  new: '新規',
  reviewing: '確認中',
  sent: '回答済み',
  closed: '完了',
  cancelled: 'キャンセル',
};

export interface QuoteContact {
  full_name: string;
  company_name: string | null;
  email: string;
  phone: string;
  address: string;
  site_address: string | null;
}

export interface QuoteRequest {
  id: string;
  configuration_id: string;
  user_id: string;
  quote_id: string | null;
  status: QuoteRequestStatus;
  message: string | null;
  contact: QuoteContact;
  created_at: string;
  updated_at: string;
}

export type QuoteStatus = 'issued' | 'expired' | 'accepted' | 'declined' | 'cancelled';
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  issued: '発行済み',
  expired: '期限切れ',
  accepted: '承諾',
  declined: '辞退',
  cancelled: '取消',
};

export interface Quote {
  id: string;
  quote_no: string;
  quote_request_id: string;
  configuration_id: string;
  user_id: string;
  status: QuoteStatus;
  issued_at: string;
  valid_until: string;
  customer_no: string | null;
  customer_name: string;
  customer_company: string | null;
  base_model_name: string;
  /** 発行時の注文範囲（スナップショット） */
  finish_level: FinishLevel;
  base_price: number;
  base_expense: number;
  option_subtotal: number;
  option_expense: number;
  installation_subtotal: number;
  adjustment: number;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  /** 第二段階: 別途工事を入力した代理店（partners.id）。第一段階では null */
  dealer_id: string | null;
  preview_image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** base=本体一式 / base_expense=本体諸費用 / option=オプション / option_expense=オプション諸費用 / installation=別途工事（現地） */
export type QuoteItemKind = 'base' | 'base_expense' | 'option' | 'option_expense' | 'installation';

export interface QuoteItem {
  id: string;
  quote_id: string;
  kind: QuoteItemKind;
  name: string;
  description: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
  /** 選択した商品の画像（見積書に表示） */
  image_url: string | null;
  sort_order: number;
}

export type ContactStatus = 'new' | 'handled';

/** お問い合わせ（トップ／お問い合わせページのフォーム） */
export interface ContactMessage {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  attachment_path: string | null;
  attachment_name: string | null;
  status: ContactStatus;
  created_at: string;
}

export interface QuoteDocument {
  id: string;
  quote_id: string;
  storage_path: string;
  file_name: string;
  byte_size: number;
  generated_at: string;
}

/* ---------- 計算結果（クライアント／サーバー共通） ---------- */

export interface PricingLine {
  option_id: string;
  code: string;
  name: string;
  category_name: string;
  unit_price: number;
  quantity: number;
  amount: number;
  is_installation: boolean;
  price_on_request: boolean;
  image_url: string | null;
}

export interface PricingResult {
  base_model_id: string;
  /** 本体一式（諸費用別） */
  base_price: number;
  expense_rate: number;
  base_expense: number;
  /** 本体価格計 */
  base_total: number;
  lines: PricingLine[];
  option_subtotal: number;
  option_expense: number;
  /** オプション価格計 */
  option_total: number;
  /** 別途工事計（第一段階では要見積のため通常 0） */
  installation_subtotal: number;
  subtotal_raw: number;
  /** 値引き等調整額（千円未満切捨て、0 以下） */
  adjustment: number;
  /** 税抜請負額 */
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  /** 「別途見積」項目を含むか */
  has_price_on_request: boolean;
}
