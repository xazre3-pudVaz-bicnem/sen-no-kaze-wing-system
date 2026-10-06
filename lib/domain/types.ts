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
/**
 * 権限階層。customer < dealer < master_dealer < admin。
 *  - master_dealer（総代理店）以上：商品台帳への商品登録・価格編集
 *  - dealer（代理店・工務店）：見積の別途工事・その他の入力と、自社のフリー商品登録
 */
export type RoleCode = 'customer' | 'dealer' | 'master_dealer' | 'admin';
export const ROLE_RANK: Record<RoleCode, number> = { customer: 0, dealer: 1, master_dealer: 2, admin: 3 };
export const ROLE_LABELS: Record<RoleCode, string> = {
  customer: '顧客',
  dealer: '代理店・工務店',
  master_dealer: '総代理店',
  admin: '管理者',
};
export function hasRoleAtLeast(role: RoleCode | undefined | null, min: RoleCode): boolean {
  return ROLE_RANK[role ?? 'customer'] >= ROLE_RANK[min];
}
/** 商品台帳（本体・カテゴリー・商品・価格・画像）を編集できるか */
export function canEditCatalog(role: RoleCode | undefined | null): boolean {
  return hasRoleAtLeast(role, 'master_dealer');
}
/** 見積の別途工事・その他の入力と、自社フリー商品の登録ができるか */
export function canEditDealerItems(role: RoleCode | undefined | null): boolean {
  return hasRoleAtLeast(role, 'dealer');
}
/** 代理店が自分で登録する商品のカテゴリーコード（見積書では別途工事の下に別枠表示） */
export const FREE_PRODUCT_CATEGORY_CODE = 'free-product';
/**
 * 旧実装で防火/非防火を商品オプションとして保持している互換用カテゴリー。
 * 防火仕様は商品カテゴリーではなく、標準見積・本体仕様を決める条件軸として扱う。
 * 既存Configuration互換のためデータ自体は当面残すが、商品台帳・商品登録には出さない。
 */
export const LEGACY_FIRE_SPEC_CATEGORY_CODE = 'fireproof';

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
  /** 管理画面・見積内で使う名称 */
  name: string;
  /** お客様画面の平面図見出しに使う名称。未設定時は name から従来互換で生成する */
  display_name?: string;
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

export type ProductImageKind = 'hero' | 'exterior' | 'interior' | 'floorplan' | 'elevation' | 'transport' | 'case';
export const IMAGE_KIND_LABELS: Record<ProductImageKind, string> = {
  hero: 'メイン',
  exterior: '外観',
  elevation: '立面図',
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
  /** 商品台帳の分類フォルダ（内外装仕上げ／建具・開口／設備機器／照明器具／家具・備品／その他／別途工事など） */
  group_code: string;
  group_name: string;
  group_sort: number;
  description: string | null;
  selection_mode: SelectionMode;
  /** このカテゴリーが選択対象になり得る最小注文範囲。モデル・仕様別の選択 / ×は別判定。 */
  finish_level: FinishLevel;
  /** single のとき: 選択対象になった仕様では必ず1つ選ぶ（標準が is_default） */
  is_required: boolean;
  /** false ならお客様画面では常に非公開。trueでもモデル・仕様別の選択 / ×判定をさらに通す。 */
  customer_visible: boolean;
  sort_order: number;
  status: PublishStatus;
}

/**
 * 本体内訳マスター（分類表見積書の右側＝お客様見積書）。
 * 仕様（hotel / residence / office）ごとに本体工事の明細を持ち、
 * 見積作成時に kind='base' の行として展開される。金額は売価のみ（原価は持たない）。
 */
export interface BaseBreakdownItem {
  id: string;
  base_model_id: string;
  spec_code: string;
  /** 工事区分（１．金物関係費用 など） */
  section: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  remark: string | null;
  sort_order: number;
}


/** 標準見積Excelの4分類。base の明細本体は base_breakdown_items に保持し、二重登録しない。 */
export type EstimateSectionCode = 'base' | 'interior_exterior' | 'option' | 'sitework';

export interface EstimateTemplate {
  id: string;
  base_model_id: string;
  /** base / hotel / residence / office など。防火は別段階で扱う */
  spec_code: string;
  name: string;
  source_file_name: string;
  source_sheet_name: string;
  source_sha256: string;
  /** 標準見積に含まれる商品マスターの標準選択。差額計算の基準。 */
  baseline_option_ids: string[];
  tax_rate: number;
  /** 4分類の合計（調整前） */
  subtotal_raw: number;
  /** 千円未満切捨て等、Excelに記載された調整額 */
  adjustment: number;
  /** 税抜請負額 */
  subtotal: number;
  tax: number;
  total: number;
  imported_at: string;
  updated_at: string;
}

export interface EstimateTemplateSection {
  id: string;
  template_id: string;
  code: EstimateSectionCode;
  label: string;
  /** 明細行だけの合計。base は base_breakdown_items、その他は estimate_template_lines を集計した値 */
  line_subtotal: number;
  expense_label: string | null;
  expense_rate: number | null;
  expense_amount: number;
  total: number;
  sort_order: number;
}

/**
 * 標準見積の「本体以外」の明細。
 * base 明細は既存 base_breakdown_items を唯一の正本とし、このテーブルへ複製しない。
 */
export interface EstimateTemplateLine {
  id: string;
  template_id: string;
  section_code: Exclude<EstimateSectionCode, 'base'>;
  group_label: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  remark: string | null;
  sort_order: number;
}

export interface EstimateTemplateBundle {
  template: EstimateTemplate;
  sections: EstimateTemplateSection[];
  /** base 以外だけ */
  lines: EstimateTemplateLine[];
  /** base だけ */
  base_breakdown_items: BaseBreakdownItem[];
  /** 標準見積に含まれる商品マスターの標準選択。差額計算の基準に使う。 */
  baseline_option_ids: string[];
}

export interface OptionImage {
  id: string;
  option_id: string;
  url: string;
  alt: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface ProductOption {
  id: string;
  /** 人が扱う商品管理番号。migration適用前の互換性のため optional。 */
  product_no?: string | null;
  base_model_id: string | null; // null = 全モデル共通
  category_id: string;
  /** 既存Preset / Import互換の技術キー。通常の登録担当者には入力させない。 */
  code: string;
  name: string;
  description: string | null;
  price: number; // 税別・円
  image_url: string | null;
  /** メーカー資料（PDF）の表示URL。未登録時は null / 未取得。 */
  manufacturer_document_url?: string | null;
  /** 商品詳細ギャラリーに表示するサブ画像。DB上は option_images で管理する。 */
  gallery_images?: OptionImage[];
  /** radio / checkbox（カテゴリー既定を上書き可） */
  selection_type: 'radio' | 'checkbox';
  is_required: boolean;
  is_default: boolean;
  is_installation: boolean;
  price_on_request: boolean;
  preview_key: string | null;
  affects_views: ViewKey[];
  spec_codes: string[];
  sort_order: number;
  status: PublishStatus;
  owner_id: string | null;
  manufacturer: string | null;
  model_no: string | null;
  size_note: string | null;
  /** メーカー希望小売価格（参考表示用・税別）。販売価格の正本にはしない。 */
  list_price: number | null;
  /** 商品の特徴。メーカー資料等で確認できる短い説明だけを保存する。 */
  highlight: string | null;
  created_at: string;
  updated_at: string;
}

export interface OptionDependency {
  id: string;
  option_id: string;
  requires_option_id: string;
}

export interface OptionConflict {
  id: string;
  option_id: string;
  conflicts_with_option_id: string;
}

export interface PreviewImageRule {
  id: string;
  base_model_id: string;
  view: ViewKey;
  option_id: string | null;
  variant_choice_id: string | null;
  image_url: string;
  priority: number;
  status: PublishStatus;
}

export interface PreviewHotspot {
  id: string;
  rule_id: string;
  x_pct: number;
  y_pct: number;
  label: string;
  sort_order: number;
}

export interface OptionVariantGroup {
  id: string;
  option_id: string;
  code: string;
  name: string;
  note: string | null;
  sort_order: number;
  is_required: boolean;
  status: PublishStatus;
  /** 別の選択項目の値によって表示する条件。例: 羽目板張り時だけ色を表示 */
  depends_on_group_code?: string | null;
  depends_on_choice_codes?: string[];
}

export interface OptionVariantChoice {
  id: string;
  group_id: string;
  code: string;
  name: string;
  kind: 'standard' | 'option';
  extra_price: number;
  price_on_request: boolean;
  image_url: string | null;
  note: string | null;
  sort_order: number;
  status: PublishStatus;
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
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  baseBreakdowns: BaseBreakdownItem[];
}

export type ConfigurationStatus = 'draft' | 'quote_requested' | 'quoted' | 'closed';

export interface Configuration {
  id: string;
  user_id: string;
  base_model_id: string;
  name: string;
  status: ConfigurationStatus;
  finish_level: FinishLevel;
  spec_code: string | null;
  site_prefecture: string | null;
  site_municipality: string | null;
  site_location_undecided: boolean;
  preview_image_url: string | null;
  notes: string | null;
  exterior_faces: import('./exterior-wall').ExteriorFaceSelection[];
  base_price: number;
  base_expense: number;
  option_subtotal: number;
  option_expense: number;
  installation_subtotal: number;
  free_subtotal: number;
  adjustment: number;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  created_at: string;
  updated_at: string;
}

export interface ConfigurationItem {
  id: string;
  configuration_id: string;
  option_id: string;
  quantity: number;
  variant_choice_ids: string[];
}

export interface QuoteContact {
  full_name: string;
  company_name: string | null;
  email: string;
  phone: string;
  address: string;
  site_address: string | null;
}

export type QuoteStatus = 'requested' | 'draft' | 'issued' | 'accepted' | 'expired' | 'rejected';

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

export type QuoteRequestStatus = 'new' | 'reviewing' | 'quoted' | 'closed';

export interface QuoteItem {
  id: string;
  quote_id: string;
  kind: string;
  name: string;
  description: string | null;
  unit: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
  image_url: string | null;
  remark: string | null;
  sort_order: number;
}

export interface Quote {
  id: string;
  quote_request_id: string | null;
  configuration_id: string;
  user_id: string;
  quote_no: string;
  revision: number;
  status: QuoteStatus;
  customer_name: string;
  customer_company: string | null;
  customer_no: string | null;
  dealer_id: string | null;
  dealer_note: string | null;
  base_model_id: string;
  base_model_name: string;
  spec_code: string | null;
  finish_level: FinishLevel;
  base_price: number;
  base_expense: number;
  option_subtotal: number;
  option_expense: number;
  installation_subtotal: number;
  free_subtotal: number;
  adjustment: number;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  price_on_request: boolean;
  created_at: string;
  updated_at: string;
  issued_at: string | null;
  accepted_at?: string | null;
  base_master_revision_id?: string | null;
  source_kind?: 'web_configuration' | 'manual' | null;
}

export interface QuoteDocument {
  id: string;
  quote_id: string;
  document_type: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

/** 案件資料の read-only 一覧。正式な版管理・更新は別工程。 */
export interface CaseDocument {
  id: string;
  document_type: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  download_url: string;
}

export interface QuoteDraftItem {
  id: string;
  draft_id: string;
  sort_order: number;
  kind: 'base' | 'interior_exterior' | 'option' | 'sitework';
  name: string;
  description: string | null;
  unit: string | null;
  unit_price: number;
  quantity: number;
  amount: number;
  image_url: string | null;
  remark: string | null;
}

export interface QuoteDraft {
  id: string;
  quote_request_id: string | null;
  parent_quote_id: string | null;
  user_id: string | null;
  customer_name: string;
  customer_company: string | null;
  customer_no: string | null;
  dealer_id: string | null;
  base_model_id: string;
  base_model_name: string;
  spec_code: string | null;
  finish_level: FinishLevel;
  base_master_revision_id: string | null;
  adjustment: number;
  adjustment_reason: string | null;
  dealer_note: string | null;
  notes: string | null;
  status: 'draft';
  lock_version: number;
  subtotal_raw: number;
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  created_at: string;
  updated_at: string;
}

export interface ContactMessage {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  attachment_url: string | null;
  status: ContactStatus;
  created_at: string;
  updated_at: string;
}

export type ContactStatus = 'new' | 'handled';

export type NotificationType = 'quote_requested' | 'quote_issued' | 'quote_accepted' | 'quote_revised' | 'contact_received' | 'system';

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}
