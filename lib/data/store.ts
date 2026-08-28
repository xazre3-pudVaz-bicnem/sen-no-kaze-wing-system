import 'server-only';
import type {
  FinishLevel,
  BaseBreakdownItem,
  BaseModel,
  CatalogBundle,
  Configuration,
  ConfigurationItem,
  OptionCategory,
  PreviewImageRule,
  PreviewHotspot,
  ProductImage,
  ProductOption,
  AppNotification,
  AuditLog,
  OptionVariantChoice,
  OptionVariantGroup,
  Profile,
  Quote,
  QuoteContact,
  QuoteDocument,
  QuoteItem,
  QuoteRequest,
  QuoteRequestStatus,
  QuoteStatus,
  RoleCode,
  ContactMessage,
  ContactStatus,
} from '@/lib/domain/types';

export interface SessionUser {
  id: string;
  email: string;
  role: RoleCode;
  full_name: string;
}

export class StoreError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION' | 'LOCKED' | 'UNAUTHENTICATED' | 'INTERNAL',
    message: string
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface SaveConfigurationInput {
  id: string | null;
  base_model_id: string;
  name: string;
  option_ids: string[];
  preview_image_url: string | null;
  notes: string | null;
  /** どこまで仕上げるか（未指定は full） */
  finish_level?: FinishLevel;
  /** 仕様（hotel / residence / office）。本体内訳の解決に使う */
  spec_code?: string | null;
  /** 選ばれたバリエーション（選択肢 ID） */
  variant_choice_ids?: string[];
}

/** 見積の 1 行。本部・総代理店は全区分、代理店は installation / free だけ */
export type RevisionItemKind = 'base' | 'base_expense' | 'option' | 'option_expense' | 'installation' | 'free';

export interface DealerRevisionItem {
  kind: RevisionItemKind;
  name: string;
  description: string | null;
  unit: string | null;
  remark: string | null;
  unit_price: number;
  quantity: number;
  /** 元の明細から引き継ぐ商品画像（見積書下部の画像一覧に使う） */
  image_url?: string | null;
}

export interface DealerRevisionInput {
  items: DealerRevisionItem[];
  dealer_note: string | null;
}

export interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
  request: QuoteRequest | null;
  document: QuoteDocument | null;
  /** 管理者向け: 顧客プロフィール */
  profile?: Profile | null;
}

export interface ContactInput {
  full_name: string;
  email: string;
  phone: string | null;
  topic: string;
  message: string;
  attachment?: { bytes: Uint8Array; contentType: string; fileName: string } | null;
}

export interface UploadInput {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}

export type ModelInput = Omit<BaseModel, 'id' | 'created_at' | 'updated_at'> & { id?: string | null };
export type CategoryInput = Omit<OptionCategory, 'id'> & { id?: string | null };
export type OptionInput = Omit<ProductOption, 'id' | 'created_at' | 'updated_at'> & { id?: string | null };
export type PreviewRuleInput = Omit<PreviewImageRule, 'id'> & { id?: string | null };
export type HotspotInput = Omit<PreviewHotspot, 'id'> & { id?: string | null };
export type ProductImageInput = Omit<ProductImage, 'id'> & { id?: string | null };

/** 商品台帳 Import を 1 transaction で反映するための書き込み単位。 */
export interface CatalogImportBatch {
  options: (OptionInput & { import_operation: 'INSERT' | 'UPDATE' })[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
}

/**
 * データアクセス層のインターフェース。
 * - SupabaseStore: 本番（RLS ＋ security definer RPC）
 * - LocalStore   : Supabase なしの検証モード（.wing-local/ の JSON）
 * 権限チェックは呼び出し側（Server Action）で requireUser / requireAdmin を通した上で、
 * 各実装でも所有者チェックを二重に行う。
 */
export interface DataStore {
  // ---- 商品マスター（公開） ----
  listModels(opts?: { includeDraft?: boolean }): Promise<BaseModel[]>;
  getModelBySlug(slug: string, opts?: { includeDraft?: boolean }): Promise<BaseModel | null>;
  getModelById(id: string, opts?: { includeDraft?: boolean }): Promise<BaseModel | null>;
  getCatalogBundle(modelId: string, opts?: { includeDraft?: boolean }): Promise<CatalogBundle | null>;

  // ---- プロフィール ----
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(
    userId: string,
    patch: Partial<Pick<Profile, 'full_name' | 'company_name' | 'phone' | 'postal_code' | 'address'>>
  ): Promise<Profile>;
  listProfiles(): Promise<Profile[]>;
  /** 管理者がユーザーの権限を変更する。自分自身の権限は変更できない */
  updateUserRole(userId: string, role: RoleCode, actor: SessionUser): Promise<Profile>;

  // ---- 保存した仕様 ----
  listConfigurations(userId: string): Promise<Configuration[]>;
  getConfiguration(id: string, actor: SessionUser): Promise<{ configuration: Configuration; items: ConfigurationItem[] } | null>;
  saveConfiguration(actor: SessionUser, input: SaveConfigurationInput): Promise<Configuration>;
  duplicateConfiguration(id: string, actor: SessionUser): Promise<Configuration>;
  deleteConfiguration(id: string, actor: SessionUser): Promise<void>;
  listAllConfigurations(): Promise<(Configuration & { user_email: string; user_name: string })[]>;

  // ---- 見積 ----
  createQuoteFromConfiguration(actor: SessionUser, configurationId: string, contact: QuoteContact, message: string | null): Promise<Quote>;
  listQuotes(userId: string): Promise<Quote[]>;
  listQuotesByConfiguration(userId: string): Promise<Map<string, Quote>>;
  getQuote(id: string, actor: SessionUser): Promise<QuoteDetail | null>;
  listAllQuotes(): Promise<(Quote & { user_email: string })[]>;
  listQuoteRequests(): Promise<(QuoteRequest & { quote_no: string | null; user_email: string })[]>;
  updateQuoteStatus(id: string, status: QuoteStatus, requestStatus: QuoteRequestStatus | null): Promise<void>;
  /** 管理者が見積の担当代理店を割り当てる */
  assignQuoteDealer(id: string, dealerId: string | null, actor: SessionUser): Promise<Quote>;
  /** 代理店に割り当てられた見積の一覧 */
  listDealerQuotes(dealerId: string): Promise<(Quote & { user_email: string })[]>;
  /** 代理店が別途工事・フリー商品を入れた確定見積（次の版）を発行する。元の版は改訂済みとして残る */
  createDealerRevision(id: string, input: DealerRevisionInput, actor: SessionUser): Promise<Quote>;

  /** 顧客が見積を承諾／辞退する */
  respondToQuote(id: string, status: 'accepted' | 'declined', actor: SessionUser): Promise<Quote>;

  // ---- 通知 ----
  listNotifications(actor: SessionUser, opts?: { limit?: number }): Promise<AppNotification[]>;
  markNotificationRead(id: string, actor: SessionUser): Promise<void>;
  markAllNotificationsRead(actor: SessionUser): Promise<void>;

  // ---- 監査ログ ----
  listAuditLogs(opts?: { limit?: number }): Promise<AuditLog[]>;

  /** 商品価格の一括更新（総代理店以上）。本体内訳マスターの一括管理表から使う */
  updateOptionPrices(items: { id: string; price: number }[]): Promise<void>;

  // ---- 本体内訳マスター ----
  /** モデル・仕様ごとの本体内訳（分類表見積書）。modelId 省略で全件 */
  listBaseBreakdownItems(modelId?: string): Promise<BaseBreakdownItem[]>;
  /** (モデル, 仕様) の本体内訳を丸ごと入れ替える（総代理店以上） */
  saveBaseBreakdownItems(
    modelId: string,
    specCode: string,
    items: Omit<BaseBreakdownItem, 'id' | 'base_model_id' | 'spec_code' | 'sort_order' | 'amount'>[]
  ): Promise<BaseBreakdownItem[]>;

  // ---- 商品のバリエーション ----
  upsertVariantGroup(input: OptionVariantGroup): Promise<OptionVariantGroup>;
  upsertVariantChoice(input: OptionVariantChoice): Promise<OptionVariantChoice>;
  /** 商品・選択項目・選択肢を全件成功時だけ反映する。 */
  applyCatalogImport(batch: CatalogImportBatch): Promise<void>;

  // ---- 見積書PDF ----
  getQuoteDocumentFile(quoteId: string): Promise<{ bytes: Uint8Array; document: QuoteDocument } | null>;
  saveQuoteDocument(quoteId: string, bytes: Uint8Array, fileName: string): Promise<QuoteDocument>;

  // ---- 管理: マスター編集 ----
  upsertModel(input: ModelInput): Promise<BaseModel>;
  listCategories(): Promise<OptionCategory[]>;
  upsertCategory(input: CategoryInput): Promise<OptionCategory>;
  listOptions(): Promise<ProductOption[]>;
  getOption(id: string): Promise<ProductOption | null>;
  upsertOption(input: OptionInput): Promise<ProductOption>;
  deleteOption(id: string): Promise<void>;
  setOptionRelations(
    optionId: string,
    dependencies: { requires_option_id: string; message: string | null }[],
    conflicts: { conflicts_with_option_id: string; message: string | null }[]
  ): Promise<void>;
  upsertPreviewRule(input: PreviewRuleInput): Promise<PreviewImageRule>;
  deletePreviewRule(id: string): Promise<void>;
  upsertHotspot(input: HotspotInput): Promise<PreviewHotspot>;
  deleteHotspot(id: string): Promise<void>;
  addProductImage(input: ProductImageInput): Promise<ProductImage>;
  deleteProductImage(id: string): Promise<void>;
  /** 画像をストレージへ保存し公開 URL を返す */
  uploadImage(file: UploadInput, folder: string): Promise<string>;
  /** 商品マスター Import 用画像を、実行ユーザーと session 単位の隔離パスへ保存する */
  uploadCatalogImportImage(file: UploadInput, userId: string, sessionId: string, index: number): Promise<string>;
  /** このリクエストで保存した画像を、後続処理失敗時に取り消す。 */
  deleteUploadedImage(url: string): Promise<void>;
  /** options / option_variant_choices が現在参照している、このユーザーの catalog-import 画像 URL */
  listReferencedCatalogImportImageUrls(userId: string): Promise<string[]>;
  /** 候補 URL のうち、削除直前の再確認でも未参照の catalog-import 画像だけを削除する */
  deleteUnreferencedCatalogImportImages(candidateUrls: string[], userId: string): Promise<number>;

  // ---- お問い合わせ ----
  createContactMessage(input: ContactInput): Promise<ContactMessage>;
  listContactMessages(): Promise<ContactMessage[]>;
  updateContactStatus(id: string, status: ContactStatus): Promise<void>;
}

function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * ローカル検証モード（JSON ファイル DB）。
 * WING_LOCAL_MODE=1 で明示、または Supabase の環境変数が未設定のときに自動で有効になる
 * （環境変数なしでデプロイしても 500 にせず、デモとして閲覧できるようにするため）。
 */
export function isLocalMode(): boolean {
  return process.env.WING_LOCAL_MODE === '1' || !hasSupabaseEnv();
}

/** Supabase 未設定のため自動的にローカルモードになっている（デモ）状態か */
export function isDemoFallback(): boolean {
  return process.env.WING_LOCAL_MODE !== '1' && !hasSupabaseEnv();
}

let cached: DataStore | null = null;

export async function getStore(): Promise<DataStore> {
  if (cached) return cached;
  if (isLocalMode()) {
    const { LocalStore } = await import('./local-store');
    cached = new LocalStore();
  } else {
    const { SupabaseStore } = await import('./supabase-store');
    cached = new SupabaseStore();
  }
  return cached;
}
