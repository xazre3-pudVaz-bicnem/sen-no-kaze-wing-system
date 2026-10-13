import 'server-only';
import type { SessionUser } from '@/lib/data/store';
import { isLocalMode } from '@/lib/data/store';
import type {
  CaseAccess,
  CaseAppointment,
  CaseAppointmentInput,
  CaseFile,
  CaseFileInput,
  CaseNote,
  CaseNoteInput,
  CaseProgress,
  CaseWorkflow,
  DealerProfile,
  DealerProfileInput,
  QuoteRequestPreferences,
  QuoteRequestPreferencesInput,
  SiteSurvey,
  SiteSurveyInput,
} from '@/lib/domain/case-flow';

/** 予約ボードの 1 行（案件の見出し付き） */
export type BoardAppointment = CaseAppointment & { case_label: string; quote_id: string | null };

/**
 * 案件の進行（フローチャート第4版 フェーズ4〜7）のデータアクセス。
 * - Supabase：読み取りは RLS（case_access）、書き込みは SECURITY DEFINER の RPC（20261013220000）
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
