import 'server-only';
import type { ProductLifecycleCapability } from '@/lib/domain/product-lifecycle';
import type {
  FinishLevel,
  BaseBreakdownItem,
  BaseModel,
  CatalogBundle,
  Configuration,
  ConfigurationItem,
  OptionCategory,
  OptionImage,
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
  CaseDocument,
  ElectronicContract,
  QuoteItem,
  QuoteItemKind,
  QuoteDraft,
  QuoteDraftItem,
  QuoteRequest,
  QuoteRequestStatus,
  QuoteStatus,
  RoleCode,
  ContactMessage,
  ContactStatus,
  EstimateTemplate,
  EstimateTemplateBundle,
  EstimateTemplateLine,
  EstimateTemplateSection,
  SpecMatrix,
  MatrixRow,
} from '@/lib/domain/types';
import type { ExteriorFaceSelection } from '@/lib/domain/exterior-wall';
import type { QuotePorSelectionState } from '@/lib/domain/quote-por';

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

export type CaseDealer = Pick<Profile, 'id' | 'role_code' | 'full_name' | 'company_name'>;
export type QuoteRequestListItem = QuoteRequest & {
  quote_no: string | null;
  user_email: string;
  configuration: { name: string; spec_code: string | null; model_name: string | null } | null;
};

export interface InitialQuoteDraftResume {
  quote_request_id: string;
  draft_id: string;
  updated_at: string;
}
/** 代理店案件一覧用。依頼の状態と設置予定地だけを追加する。 */
export type DealerQuoteListItem = Quote & {
  user_email: string;
  request_status: QuoteRequestStatus | null;
  site_address: string | null;
};

export type AccessibleCustomerIdentityIssue =
  | 'inconsistent_user_id'
  | 'non_customer_profile'
  | 'missing_profile';

export interface AccessibleCustomerCaseSummary {
  id: string;
  open_quote_id: string | null;
  quote_no: string | null;
  model_name: string | null;
  site_address: string | null;
  activity_at: string;
  dealer_name: string | null;
}

export interface AccessibleCustomerListItem {
  id: string;
  customer_no: string | null;
  full_name: string;
  company_name: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  ongoing_case_count: number;
  recent_case: AccessibleCustomerCaseSummary | null;
}

export interface AccessibleUnlinkedCustomerCase {
  id: string;
  full_name: string;
  company_name: string | null;
  identity_issue: AccessibleCustomerIdentityIssue;
  open_quote_id: string | null;
  quote_no: string | null;
  model_name: string | null;
  site_address: string | null;
  activity_at: string;
  dealer_name: string | null;
}

export interface AccessibleCustomerListResult {
  availability: 'available' | 'migration_pending';
  customers: AccessibleCustomerListItem[];
  unlinked_cases: AccessibleUnlinkedCustomerCase[];
}

export interface AccessibleCustomerQuote {
  id: string;
  case_id: string;
  quote_no: string;
  revision: number;
  status: QuoteStatus;
  base_model_name: string;
  issued_at: string;
  total: number;
  can_open_quote: boolean;
}

export interface AccessibleCustomerCase {
  id: string;
  request_status: QuoteRequestStatus | null;
  message: string | null;
  contact: QuoteContact | null;
  site_address: string | null;
  site_source: 'quote_contact' | 'configuration' | null;
  ongoing: boolean;
  activity_at: string;
  model_name: string | null;
  dealer_name: string | null;
  dealer_company: string | null;
  open_quote_id: string | null;
  latest_quote: AccessibleCustomerQuote | null;
}

export interface AccessibleCustomerDetail {
  customer: {
    id: string;
    customer_no: string | null;
    full_name: string;
    company_name: string | null;
    email: string;
    phone: string | null;
    postal_code: string | null;
    address: string | null;
    created_at: string;
  };
  latest_contact: QuoteContact | null;
  cases: AccessibleCustomerCase[];
  quote_history: AccessibleCustomerQuote[];
}

export interface AccessibleCustomerDetailResult {
  availability: 'available' | 'migration_pending';
  detail: AccessibleCustomerDetail | null;
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
  /** 設置予定地。未選択時は null */
  site_prefecture?: string | null;
  site_municipality?: string | null;
  /** 「設置予定地は未定」を明示選択した状態 */
  site_location_undecided?: boolean;
  /**
   * 既存の Draft を保存するとき、読み込んだ時点の lock_version。
   * 一致しなければ保存を拒否する（他の画面の保存を後勝ちで上書きしない）。新規保存では不要。
   */
  expected_lock_version?: number | null;
  /** 選ばれたバリエーション（選択肢 ID） */
  variant_choice_ids?: string[];
  /** 外壁4面の割当。未指定は既存互換用に空配列として保存する */
  exterior_faces?: ExteriorFaceSelection[];
}

/** 見積の1行。代理店は base / base_expense を編集不可。総代理店・本部は全区分編集可。 */
export type RevisionItemKind =
  | 'base'
  | 'base_expense'
  | 'interior_exterior'
  | 'interior_exterior_expense'
  | 'option'
  | 'option_expense'
  | 'installation'
  | 'free';

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
  /**
   * お客様が選んだ別途見積の商品を確認した、として画面が送る一覧の key（確認欄にチェックがあるときだけ）。
   * 発行の前に確認を記録する（DB の confirm_quote_por_selections と同じ。D1 までの暫定）
   */
  por_confirmation_keys?: string[] | null;
}

export interface ManualQuoteDraftInput {
  customer_name: string;
  customer_company: string | null;
  site_address: string | null;
  base_model_id: string;
  spec_code: string;
  finish_level: FinishLevel;
  memo: string | null;
}

export interface ManualQuoteWorkbenchInput extends ManualQuoteDraftInput {
  case_name: string | null;
  base_master_revision_id: string | null;
  items: QuoteDraftSaveItem[];
  adjustment: number;
  adjustment_reason: string | null;
}

export interface QuoteDraftSaveItem {
  line_key?: string | null;
  kind: QuoteItemKind;
  option_id?: string | null;
  name: string;
  description?: string | null;
  unit?: string | null;
  remark?: string | null;
  unit_price: number;
  quantity: number;
  image_url?: string | null;
}

export interface QuoteDraftSaveInput {
  expected_lock_version: number;
  base_master_revision_id: string | null;
  items: QuoteDraftSaveItem[];
  adjustment: number;
  adjustment_reason: string | null;
  dealer_note: string | null;
  notes: string | null;
}

export interface QuoteDraftBaseRevisionChoice {
  id: string;
  base_master_id: string;
  master_name: string;
  fire_spec_code: 'non_fire' | 'fire';
  version: number;
  total: number;
}

export interface QuoteDraftDetail {
  draft: QuoteDraft;
  items: QuoteDraftItem[];
  request: Pick<QuoteRequest, 'id' | 'case_name' | 'status' | 'message' | 'contact' | 'created_by' | 'created_at' | 'updated_at'>;
  baseRevisions: QuoteDraftBaseRevisionChoice[];
}

export interface MatrixRowUpdateInput {
  row_id: string;
  fire_selectable: boolean;
  /** 選択できる項目のコード。列挙していない有効な項目は選択不可になる */
  selectable_items: string[];
  expected_lock_version: number;
}

export interface MatrixRowCreateInput {
  base_model_id: string;
  spec_code: string;
  size_code: string;
  fire_selectable: boolean;
  selectable_items: string[];
}

export interface QuoteDetail {
  quote: Quote;
  items: QuoteItem[];
  request: QuoteRequest | null;
  document: QuoteDocument | null;
  /** 管理者向け: 顧客プロフィール */
  profile?: Profile | null;
}

export interface CasePlanConfigurationHeader {
  id: string;
  /** 保存済みConfiguration名。案件タイトルとして使える場合だけ返す。 */
  name?: string | null;
  base_model_id: string;
  status: Configuration['status'];
  finish_level: Configuration['finish_level'];
  spec_code: string | null;
  site_prefecture?: string | null;
  site_municipality?: string | null;
  site_location_undecided?: boolean;
}

export type CasePlanConfigurationItem = Pick<
  ConfigurationItem,
  'option_id' | 'quantity' | 'variant_choice_ids'
>;

export interface CasePlanConfiguration {
  configuration: CasePlanConfigurationHeader;
  items: CasePlanConfigurationItem[];
  exterior_faces: ExteriorFaceSelection[];
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
// 取扱終了・シミュレーター表示は、商品の登録・編集では書き換えない（専用の setProductLifecycle だけで変える）
export type OptionInput = Omit<ProductOption, 'id' | 'created_at' | 'updated_at' | 'gallery_images' | 'simulator_visible' | 'archived_at'> & { id?: string | null };

/** 商品の状態の変更（20261015113000）。取扱終了・取扱再開・シミュレーターに表示する・表示しない */
export type ProductLifecycleAction = 'retire' | 'resume' | 'show_in_simulator' | 'hide_from_simulator';
export type OptionImageInput = Omit<OptionImage, 'id' | 'created_at'> & { id?: string | null };
export type PreviewRuleInput = Omit<PreviewImageRule, 'id'> & { id?: string | null };
export type HotspotInput = Omit<PreviewHotspot, 'id'> & { id?: string | null };
export type ProductImageInput = Omit<ProductImage, 'id'> & { id?: string | null };

/** 商品台帳 Import を 1 transaction で反映するための書き込み単位。 */
export interface CatalogImportBatch {
  options: (OptionInput & { import_operation: 'INSERT' | 'UPDATE' })[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
}


/** 実物Excelを価格の正本として取り込む標準見積テンプレート。 */
export interface EstimateTemplateImportInput {
  base_model_id: string;
  spec_code: string;
  name: string;
  source_file_name: string;
  source_sheet_name: string;
  source_sha256: string;
  tax_rate: number;
  subtotal_raw: number;
  adjustment: number;
  subtotal: number;
  tax: number;
  total: number;
  sections: Omit<EstimateTemplateSection, 'id' | 'template_id'>[];
  /** 本体明細だけは既存 base_breakdown_items に保存する。 */
  base_breakdown_items: Omit<BaseBreakdownItem, 'id' | 'base_model_id' | 'spec_code'>[];
  /** 本体以外の3分類だけ。 */
  lines: Omit<EstimateTemplateLine, 'id' | 'template_id'>[];
  /** この標準見積で標準選択されている商品ID。差額計算の基準。 */
  baseline_option_ids: string[];
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
  /** 顧客管理。adminは全顧客、総代理店・代理店は担当案件由来の顧客だけを返す。 */
  listAccessibleCustomers(actor: SessionUser): Promise<AccessibleCustomerListResult>;
  /** 顧客詳細。アクセスできない顧客は detail=null とし、存在有無を区別しない。 */
  getAccessibleCustomerDetail(customerId: string, actor: SessionUser): Promise<AccessibleCustomerDetailResult>;

  // ---- 保存した仕様 ----
  listConfigurations(userId: string): Promise<Configuration[]>;
  getConfiguration(id: string, actor: SessionUser): Promise<{ configuration: Configuration; items: ConfigurationItem[] } | null>;
  /** 案件プランボード用。管理者または担当代理店だけが見積経由で読み取れる。 */
  getCasePlanConfiguration(quoteId: string, actor: SessionUser): Promise<CasePlanConfiguration | null>;
  saveConfiguration(actor: SessionUser, input: SaveConfigurationInput): Promise<Configuration>;
  duplicateConfiguration(id: string, actor: SessionUser): Promise<Configuration>;
  deleteConfiguration(id: string, actor: SessionUser): Promise<void>;
  listAllConfigurations(): Promise<(Configuration & { user_email: string; user_name: string; user_address: string | null })[]>;

  // ---- 見積 ----
  /** 非Web案件を登録し、Quoteを発行せず空Draftを作る */
  createManualQuoteDraft(actor: SessionUser, input: ManualQuoteDraftInput): Promise<QuoteDraft>;
  /** 案件情報と初期明細を1 transactionで保存し、Quoteを発行せずDraftを作る */
  createManualQuoteDraftWithItems(actor: SessionUser, input: ManualQuoteWorkbenchInput): Promise<QuoteDraft>;
  /** 現在の非Web formal Revisionを親に、編集用Draftを作成または再開する */
  createQuoteRevisionDraft(id: string, actor: SessionUser): Promise<QuoteDraft>;
  /** RLSを迂回せずSECURITY DEFINER RPCの権限境界でDraftを読む */
  getQuoteDraft(id: string, actor: SessionUser): Promise<QuoteDraftDetail | null>;
  /** expected lock_versionで競合検知し、DB再計算でDraftを保存する */
  saveQuoteDraft(id: string, input: QuoteDraftSaveInput, actor: SessionUser): Promise<number>;
  /** 非Web初回Draftをformal Revision 1として確定する */
  finalizeQuoteDraft(id: string, expectedLockVersion: number, actor: SessionUser): Promise<Quote>;
  /**
   * expectedLockVersion: 見積依頼の確認画面を表示した時点の Configuration の版。
   * DB の版と一致しなければ（NULL を含む）見積を作らずに LOCKED で拒否する。
   */
  createQuoteFromConfiguration(
    actor: SessionUser,
    configurationId: string,
    contact: QuoteContact,
    message: string | null,
    expectedLockVersion: number | null
  ): Promise<Quote>;
  listQuotes(userId: string): Promise<Quote[]>;
  listQuotesByConfiguration(userId: string): Promise<Map<string, Quote>>;
  getQuote(id: string, actor: SessionUser): Promise<QuoteDetail | null>;
  /** 案件資料のread-only一覧。正式な保存・版管理は別工程。 */
  listCaseDocuments(quoteId: string, actor: SessionUser): Promise<CaseDocument[]>;
  listAllQuotes(): Promise<(Quote & { user_email: string })[]>;
  /** 案件一覧に必要な保存済み仕様の表示項目だけを含む。 */
  listQuoteRequests(): Promise<QuoteRequestListItem[]>;
  /** 本部管理者向け。正式Quote未発行の初回Draftを案件管理から再開する最小情報。 */
  listInitialQuoteDraftResumes(actor: SessionUser): Promise<InitialQuoteDraftResume[]>;
  /** 案件一覧の担当者表示・絞り込み用。プロフィール全列は取得しない。 */
  listCaseDealers(): Promise<CaseDealer[]>;
  /** 案件ナビの保存済み仕様バッジ用。仕様本体は取得しない。 */
  getConfigurationCount(): Promise<number>;
  /** 案件ナビの未対応問い合わせバッジ用。本文を取得しない。 */
  getNewContactMessageCount(): Promise<number>;
  /** 管理者が見積の担当代理店を割り当てる */
  assignQuoteDealer(id: string, dealerId: string | null, actor: SessionUser): Promise<Quote>;
  /** 代理店に割り当てられた見積の一覧 */
  listDealerQuotes(dealerId: string): Promise<DealerQuoteListItem[]>;
  /** 代理店が別途工事・フリー商品を入れた確定見積（次の版）を発行する。元の版は改訂済みとして残る */
  createDealerRevision(id: string, input: DealerRevisionInput, actor: SessionUser): Promise<Quote>;
  /**
   * 改訂・確定見積の画面用：Web の案件でお客様が選んだ別途見積の商品と、自分の確認が済んでいるか。
   * 本部と担当の代理店・総代理店だけ（DB の get_quote_por_selections。D1 までの暫定）
   */
  getQuotePorSelections(quoteId: string, actor: SessionUser): Promise<QuotePorSelectionState>;

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
  /**
   * 商品の状態を変える（取扱終了・再開・シミュレーター表示）。画面が読んだ版（updated_at）と一致する行だけを更新し、
   * 0 件なら失敗にする（古い画面の操作を成功扱いにしない）。参照保護などの判定は DB のトリガーが行う（20261015113000）
   */
  setProductLifecycle(input: { id: string; action: ProductLifecycleAction; expectedUpdatedAt: string }): Promise<{ updated_at: string }>;
  /** 商品の状態の機能を使えるか（20261015110000 と 20261015113000 が適用済みか） */
  getProductLifecycleCapability(): Promise<ProductLifecycleCapability>;

  // ---- 本体内訳マスター ----
  /** モデル・仕様ごとの本体内訳（分類表見積書）。modelId 省略で全件 */
  listBaseBreakdownItems(modelId?: string): Promise<BaseBreakdownItem[]>;
  /** (モデル, 仕様) の本体内訳を丸ごと入れ替える（総代理店以上） */
  saveBaseBreakdownItems(
    modelId: string,
    specCode: string,
    items: Omit<BaseBreakdownItem, 'id' | 'base_model_id' | 'spec_code' | 'sort_order' | 'amount'>[]
  ): Promise<BaseBreakdownItem[]>;

  // ---- 標準見積テンプレート（Excelが価格の正本） ----
  /** 本体仕様マトリクス（誰でも読める公開情報）。表が無い DB（migration 未適用）では null */
  getSpecMatrix(): Promise<SpecMatrix | null>;
  /** 本部：行の防火可否と項目ごとの選択可否を保存する（読み込んだ時点の版と一致しなければ LOCKED） */
  updateMatrixRow(actor: SessionUser, input: MatrixRowUpdateInput): Promise<MatrixRow>;
  /** 本部：既存の仕様・サイズで行を追加する */
  createMatrixRow(actor: SessionUser, input: MatrixRowCreateInput): Promise<MatrixRow>;
  /** 本部：行を停止（retired）・再開（active）する */
  setMatrixRowStatus(actor: SessionUser, rowId: string, status: 'active' | 'retired', expectedLockVersion: number): Promise<MatrixRow>;
  listEstimateTemplates(modelId?: string): Promise<EstimateTemplate[]>;
  getEstimateTemplateBundle(modelId: string, specCode: string): Promise<EstimateTemplateBundle | null>;
  /** 解析・検算済みの標準見積を一括置換する。base 明細も同じ transaction で更新する。 */
  replaceEstimateTemplates(items: EstimateTemplateImportInput[]): Promise<void>;

  // ---- 商品のバリエーション ----
  getOptionVariants(optionId: string): Promise<{ groups: OptionVariantGroup[]; choices: OptionVariantChoice[] }>;
  upsertVariantGroup(input: OptionVariantGroup): Promise<OptionVariantGroup>;
  upsertVariantChoice(input: OptionVariantChoice): Promise<OptionVariantChoice>;
  /** 商品・選択項目・選択肢を全件成功時だけ反映する。 */
  applyCatalogImport(batch: CatalogImportBatch): Promise<void>;

  // ---- 見積書PDF ----
  getQuoteDocumentFile(quoteId: string): Promise<{ bytes: Uint8Array; document: QuoteDocument } | null>;
  saveQuoteDocument(quoteId: string, bytes: Uint8Array, fileName: string): Promise<QuoteDocument>;

  // ---- 電子契約（GMOサイン） ----
  /** 案件の電子契約の履歴（新しい順）。お客様は自分の案件、本部はすべて（RLS） */
  listElectronicContracts(quoteRequestId: string, actor: SessionUser): Promise<ElectronicContract[]>;
  /** 本部が承諾済みの現在の見積から送信を開始する（状態 sending）。送信先の GMOサインを呼ぶ前に必ず通す */
  beginElectronicContract(actor: SessionUser, quoteId: string, signerName: string, signerEmail: string): Promise<string>;
  recordElectronicContractSent(actor: SessionUser, contractId: string, envelopeXid: string, documentId: string | null): Promise<void>;
  recordElectronicContractFailed(actor: SessionUser, contractId: string, reason: string): Promise<void>;
  cancelElectronicContract(actor: SessionUser, contractId: string, reason: string | null): Promise<void>;
  /**
   * 署名完了の記録（GMOサインの通知を受けたサーバーだけが呼ぶ）。
   * 署名済み PDF をこちらの資格情報で取得した後に、非公開の保存先へ置いてから状態を signed にする。
   * 封筒が見つからなければ null（関係の無い通知は無視する）
   */
  completeElectronicContract(envelopeXid: string, documentId: string | null, pdf: Uint8Array): Promise<string | null>;
  /** 署名済み PDF。見られるのは契約のお客様と本部だけ（見えない契約・未締結は null） */
  getSignedContractPdf(contractId: string, actor: SessionUser): Promise<{ bytes: Uint8Array; contract: ElectronicContract } | null>;

  // ---- 管理: マスター編集 ----
  upsertModel(input: ModelInput): Promise<BaseModel>;
  listCategories(): Promise<OptionCategory[]>;
  upsertCategory(input: CategoryInput): Promise<OptionCategory>;
  listOptions(): Promise<ProductOption[]>;
  getOption(id: string): Promise<ProductOption | null>;
  upsertOption(input: OptionInput): Promise<ProductOption>;
  deleteOption(id: string): Promise<void>;
  upsertOptionImage(input: OptionImageInput): Promise<OptionImage>;
  deleteOptionImage(id: string): Promise<OptionImage | null>;
  setOptionManufacturerDocument(optionId: string, url: string | null): Promise<void>;
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
  /** 商品サブ画像を option ID 固有prefixへ保存する */
  uploadOptionImage(file: UploadInput, optionId: string): Promise<string>;
  /** option ID 固有prefixと一致する商品サブ画像だけを削除する */
  deleteUploadedOptionImage(url: string, optionId: string): Promise<void>;
  /** メーカー資料PDFを option ID 固有prefixへ保存する */
  uploadProductDocument(file: UploadInput, optionId: string): Promise<string>;
  /** option ID 固有prefixと一致するメーカー資料だけを削除する */
  deleteUploadedProductDocument(url: string, optionId: string): Promise<void>;
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
