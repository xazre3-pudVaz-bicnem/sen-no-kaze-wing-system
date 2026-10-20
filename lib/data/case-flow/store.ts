import 'server-only';
import type { SessionUser } from '@/lib/data/store';
import { isLocalMode } from '@/lib/data/store';
import type {
  AfterServiceRequest,
  AfterServiceRequestInput,
  AfterServiceUpdateInput,
  CaseAccess,
  CaseOrganizations,
  CaseRole,
  CaseAppointment,
  CaseAppointmentInput,
  CaseFile,
  CaseFileInput,
  CaseHandover,
  CaseNote,
  CaseNoteInput,
  CaseProgress,
  CasePunchItem,
  CaseWorkflow,
  CaseProgressReport,
  CaseScheduleItem,
  DealerProfile,
  DealerProfileInput,
  DisasterConsent,
  DisasterConsentInput,
  DisasterConsentText,
  GuestPlan,
  GuestPlanInput,
  HandoverInspectionInput,
  SiteProfile,
  SiteProfileInput,
  ManufacturingOrder,
  ManufacturingOrderInput,
  ManufacturingOrderStatus,
  ManufacturingUnit,
  PaperContractInput,
  ProgressReportInput,
  ScheduleItemInput,
  StockLedgerEntry,
  StockLedgerEntryInput,
  UnitUpdateInput,
  QuoteChangeRequest,
  QuoteRequestPreferences,
  QuoteRequestPreferencesInput,
  SiteSurvey,
  SiteSurveyInput,
} from '@/lib/domain/case-flow';

/** 予約ボードの 1 行（案件の見出し付き） */
export type BoardAppointment = CaseAppointment & { case_label: string; quote_id: string | null };

/** 製造の一覧の 1 行（案件の見出しと個体の進み具合付き） */
export type BoardManufacturingOrder = ManufacturingOrder & {
  case_label: string;
  case_quote_id: string | null;
  units_total: number;
  units_shipped: number;
  units_installed: number;
};

/** アフターの一覧の 1 行（案件の見出しと、見ている人の関わり方付き） */
export type BoardAfterServiceRequest = AfterServiceRequest & { case_label: string; case_quote_id: string | null; viewer_access: CaseAccess | null };

/** 全国ストック台帳の 1 行（引渡し済みの個体・本部の判定・お客様の今の意思） */
export interface StockLedgerRow {
  unit: ManufacturingUnit;
  entry: StockLedgerEntry | null;
  latest_consent: DisasterConsent | null;
  case_label: string;
  case_quote_id: string | null;
}

/**
 * 案件の進行（フローチャート第4版 フェーズ4〜15）のデータアクセス。
 * - Supabase：読み取りは RLS（case_access）、書き込みは SECURITY DEFINER の RPC（20261013220000 以降）
 * - ローカル検証モード：同じ判定を JSON の DB で行う（開発・E2E 用）
 * 既存の DataStore（lib/data/store.ts）と同じく、両方を実装する。正本は DB の判定。
 */
export interface CaseFlowStore {
  /** 案件への関わり方（見えない案件は null） */
  getCaseAccess(actor: SessionUser, requestId: string): Promise<CaseAccess | null>;

  // ---- 代理店の公開情報（フェーズ4） ----
  /** 公開中の代理店（未ログインでも読める） */
  listPublishedDealerProfiles(): Promise<DealerProfile[]>;
  /** 本部：すべての代理店の公開情報。代理店：自分の公開情報だけ */
  listDealerProfiles(actor: SessionUser): Promise<DealerProfile[]>;
  getDealerProfile(actor: SessionUser, dealerId: string): Promise<DealerProfile | null>;
  saveDealerProfile(actor: SessionUser, dealerId: string, input: DealerProfileInput, expectedLockVersion: number | null): Promise<number>;
  setDealerProfilePublished(actor: SessionUser, dealerId: string, published: boolean, expectedLockVersion: number): Promise<number>;

  // ---- 見積依頼のときのお客様の希望（フェーズ5） ----
  getQuoteRequestPreferences(actor: SessionUser, requestId: string): Promise<QuoteRequestPreferences | null>;
  setQuoteRequestPreferences(actor: SessionUser, requestId: string, input: QuoteRequestPreferencesInput): Promise<void>;

  // ---- 受付・担当（フェーズ5〜6） ----
  getCaseWorkflow(actor: SessionUser, requestId: string): Promise<CaseWorkflow | null>;
  acknowledgeCase(actor: SessionUser, requestId: string): Promise<void>;
  assignCasePrimaryStaff(actor: SessionUser, requestId: string, staffId: string | null): Promise<void>;
  setCaseManufacturer(actor: SessionUser, requestId: string, manufacturerId: string | null): Promise<void>;
  /** 読み取りの関わり方（DB の case_role）。営業担当組織の管理者は manager、直属の総代理店の管理者は supervisor */
  getCaseRole(actor: SessionUser, requestId: string): Promise<CaseRole | null>;
  /** 案件の営業担当組織・製造担当組織・主担当者（と主担当者の候補）。お客様には返さない */
  getCaseOrganizations(actor: SessionUser, requestId: string): Promise<CaseOrganizations | null>;
  /** 営業担当組織を決める・変える（本部だけ）。NULL で本部の受付に戻す */
  setCaseSalesOrganization(actor: SessionUser, requestId: string, organizationId: string | null): Promise<void>;
  /** 製造担当組織を変える（本部だけ）。NULL で営業担当組織からの自動に戻す */
  setCaseManufacturingOrganization(actor: SessionUser, requestId: string, organizationId: string | null): Promise<void>;
  /** お客様にも見せてよい進み具合 */
  getCaseProgress(actor: SessionUser, requestId: string): Promise<CaseProgress | null>;

  // ---- 日程（フェーズ6・予約ボード） ----
  listCaseAppointments(actor: SessionUser, requestId: string): Promise<CaseAppointment[]>;
  /** 予約ボード：見える案件の、調整中・確定の日程 */
  listBoardAppointments(actor: SessionUser): Promise<BoardAppointment[]>;
  proposeCaseAppointment(actor: SessionUser, requestId: string, input: CaseAppointmentInput): Promise<string>;
  confirmCaseAppointment(actor: SessionUser, appointmentId: string, candidateIndex: number, expectedLockVersion: number): Promise<void>;
  requestCaseAppointmentChange(actor: SessionUser, appointmentId: string, note: string, expectedLockVersion: number): Promise<void>;
  setCaseAppointmentStatus(actor: SessionUser, appointmentId: string, status: 'done' | 'canceled', expectedLockVersion: number): Promise<void>;

  // ---- 現地確認（フェーズ7） ----
  getSiteSurvey(actor: SessionUser, requestId: string): Promise<SiteSurvey | null>;
  saveSiteSurvey(actor: SessionUser, requestId: string, input: SiteSurveyInput, expectedLockVersion: number | null): Promise<number>;
  setSiteSurveyStatus(actor: SessionUser, requestId: string, status: 'completed' | 'draft', expectedLockVersion: number): Promise<number>;

  // ---- 社内の記録（フェーズ7） ----
  listCaseNotes(actor: SessionUser, requestId: string): Promise<CaseNote[]>;
  addCaseNote(actor: SessionUser, requestId: string, input: CaseNoteInput): Promise<string>;

  // ---- 見積の修正依頼（フェーズ9） ----
  listQuoteChangeRequests(actor: SessionUser, requestId: string): Promise<QuoteChangeRequest[]>;
  requestQuoteChange(actor: SessionUser, quoteId: string, message: string): Promise<string>;
  resolveQuoteChangeRequest(actor: SessionUser, changeRequestId: string, resolution: string | null): Promise<void>;

  // ---- 書面で締結した契約（フェーズ10） ----
  /** 本部：署名済みの書面（PDF）を非公開の保存先へ置き、締結済みとして記録する */
  recordPaperContract(actor: SessionUser, quoteId: string, input: PaperContractInput, pdf: Uint8Array): Promise<string>;
  /** 本部：誤って記録した書面の契約を、理由を残して無効にする */
  voidPaperContract(actor: SessionUser, contractId: string, reason: string): Promise<void>;

  // ---- 製造依頼と個体（フェーズ11） ----
  /** 案件の有効な製造依頼（取り消したものは除く） */
  getManufacturingOrder(actor: SessionUser, requestId: string): Promise<ManufacturingOrder | null>;
  listManufacturingUnits(actor: SessionUser, orderId: string): Promise<ManufacturingUnit[]>;
  /** 本部：全国の製造の進み具合。総代理店：届いた製造依頼。代理店：担当の案件 */
  listManufacturingBoard(actor: SessionUser): Promise<BoardManufacturingOrder[]>;
  createManufacturingOrder(actor: SessionUser, requestId: string, input: ManufacturingOrderInput): Promise<string>;
  updateManufacturingOrder(actor: SessionUser, orderId: string, input: ManufacturingOrderInput, expectedLockVersion: number): Promise<number>;
  sendManufacturingOrder(actor: SessionUser, orderId: string, expectedLockVersion: number): Promise<number>;
  setManufacturingOrderStatus(actor: SessionUser, orderId: string, status: ManufacturingOrderStatus, expectedLockVersion: number, reason: string | null): Promise<number>;
  updateManufacturingUnit(actor: SessionUser, unitId: string, input: UnitUpdateInput, expectedLockVersion: number): Promise<number>;

  // ---- 工程表（フェーズ12） ----
  listScheduleItems(actor: SessionUser, requestId: string): Promise<CaseScheduleItem[]>;
  saveScheduleItem(actor: SessionUser, requestId: string, itemId: string | null, input: ScheduleItemInput, expectedLockVersion: number | null): Promise<{ id: string; lock_version: number }>;
  deleteScheduleItem(actor: SessionUser, itemId: string): Promise<void>;

  // ---- 施工の記録（フェーズ13） ----
  listProgressReports(actor: SessionUser, requestId: string): Promise<CaseProgressReport[]>;
  addProgressReport(actor: SessionUser, requestId: string, input: ProgressReportInput): Promise<string>;
  setProgressReportVisibility(actor: SessionUser, reportId: string, visible: boolean): Promise<void>;

  // ---- 完了確認・是正・引渡し（フェーズ14） ----
  getHandover(actor: SessionUser, requestId: string): Promise<CaseHandover | null>;
  listPunchItems(actor: SessionUser, requestId: string): Promise<CasePunchItem[]>;
  /** 完成確認を始める（確認し直すときは、お客様の回答と承諾書の記録を待ちに戻す） */
  startHandoverInspection(actor: SessionUser, requestId: string, input: HandoverInspectionInput, expectedLockVersion: number | null): Promise<number>;
  /** お客様の回答（問題なし／気になる点。気になる点は是正事項になる） */
  confirmHandover(actor: SessionUser, requestId: string, result: 'ok' | 'issues', issues: string[], expectedLockVersion: number): Promise<number>;
  addPunchItem(actor: SessionUser, requestId: string, description: string, expectedLockVersion: number): Promise<string>;
  setPunchItemStatus(actor: SessionUser, itemId: string, status: 'fixed' | 'verified', expectedLockVersion: number): Promise<number>;
  /** 署名済みの工事完了承諾書（写し・「完了確認・引渡し」の資料）を記録する。お客様の確認（書面）として扱う */
  recordCompletionCertificate(actor: SessionUser, requestId: string, fileId: string, signedOn: string, expectedLockVersion: number): Promise<number>;
  /** 引渡し完了（設置済みの個体を引渡し済みにする） */
  completeHandover(actor: SessionUser, requestId: string, handedOverOn: string, expectedLockVersion: number): Promise<number>;

  // ---- アフター（フェーズ15） ----
  listAfterServiceRequests(actor: SessionUser, requestId: string): Promise<AfterServiceRequest[]>;
  /** 本部：すべて。担当代理店：担当の案件。総代理店：回されたもの */
  listAfterServiceBoard(actor: SessionUser): Promise<BoardAfterServiceRequest[]>;
  createAfterServiceRequest(actor: SessionUser, requestId: string, input: AfterServiceRequestInput): Promise<string>;
  updateAfterServiceRequest(actor: SessionUser, id: string, input: AfterServiceUpdateInput, expectedLockVersion: number): Promise<number>;

  // ---- 災害時提供の意思（フェーズ15） ----
  /** 承諾書の文面（新しい版から） */
  listDisasterConsentTexts(actor: SessionUser): Promise<DisasterConsentText[]>;
  /** 本部：先方が決めた文面を新しい版として登録する。登録した版を返す */
  publishDisasterConsentText(actor: SessionUser, input: { title: string; body: string }): Promise<number>;
  /** 案件の意思の履歴（新しい順。先頭が今の意思） */
  listDisasterConsents(actor: SessionUser, requestId: string): Promise<DisasterConsent[]>;
  setDisasterConsent(actor: SessionUser, requestId: string, input: DisasterConsentInput): Promise<string>;

  // ---- 全国ストック台帳（フェーズ15・本部だけ） ----
  listStockLedger(actor: SessionUser): Promise<StockLedgerRow[]>;
  saveStockLedgerEntry(actor: SessionUser, unitId: string, input: StockLedgerEntryInput, expectedLockVersion: number | null): Promise<number>;

  // ---- 一時保存（フェーズ2：ログインなし。サーバーだけが呼ぶ） ----
  /** 仕様の選択を一時保存し、URL の鍵と有効期限を返す。DB には鍵のハッシュだけを残す */
  createGuestPlan(baseModelId: string, plan: GuestPlanInput): Promise<{ token: string; expires_at: string }>;
  /** URL の鍵から一時保存を開く（期限切れ・見つからなければ null） */
  getGuestPlan(token: string): Promise<GuestPlan | null>;

  // ---- 設置予定地・土地（フェーズ3） ----
  /** お客様本人・本部・そのプランの案件の担当代理店と製造の担当だけ（見えなければ null） */
  getSiteProfile(actor: SessionUser, configurationId: string): Promise<SiteProfile | null>;
  /** お客様本人と本部だけ。保存した版を返す */
  saveSiteProfile(actor: SessionUser, configurationId: string, input: SiteProfileInput, expectedLockVersion: number | null): Promise<number>;

  // ---- 写真・書類 ----
  listCaseFiles(actor: SessionUser, requestId: string): Promise<CaseFile[]>;
  /** 登録してよいかを DB で確かめてから、非公開の保存先へ置く */
  uploadCaseFile(actor: SessionUser, requestId: string, input: CaseFileInput, bytes: Uint8Array): Promise<CaseFile>;
  /** 見てよいファイルだけ（見えなければ null） */
  getCaseFileContent(actor: SessionUser, fileId: string): Promise<{ file: CaseFile; bytes: Uint8Array } | null>;
  deleteCaseFile(actor: SessionUser, fileId: string): Promise<void>;
}

let cached: CaseFlowStore | null = null;

export async function getCaseFlowStore(): Promise<CaseFlowStore> {
  if (cached) return cached;
  if (isLocalMode()) {
    const { LocalCaseFlowStore } = await import('./local');
    cached = new LocalCaseFlowStore();
  } else {
    const { SupabaseCaseFlowStore } = await import('./supabase');
    cached = new SupabaseCaseFlowStore();
  }
  return cached;
}
