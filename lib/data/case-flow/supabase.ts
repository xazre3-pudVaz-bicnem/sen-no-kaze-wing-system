import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { isMissingNamedFunction, isMissingRelation } from '@/lib/data/schema-compat';
import type {
  AfterServiceRequest,
  AfterServiceRequestInput,
  AfterServiceUpdateInput,
  CaseAccess,
  CaseOrganizations,
  CaseRole,
  SupervisedCaseDetail,
  ManufacturingCaseDetail,
  ManufacturingCaseSummary,
  SupervisedCaseSummary,
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
import { GUEST_PLAN_TOKEN } from '@/lib/domain/case-flow';
import type { BoardAfterServiceRequest, BoardAppointment, BoardManufacturingOrder, CaseFlowStore, StockLedgerRow } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

const CASE_FILES_BUCKET = 'case-files';
const CONTRACT_DOCUMENTS_BUCKET = 'contract-documents';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** DB のエラーを画面向けの StoreError にする（lib/data/supabase-store.ts の mapPgError と同じ規則） */
function fail(e: { code?: string; message?: string } | null): never {
  const msg = e?.message ?? '不明なエラー';
  if (msg.startsWith('VALIDATION:')) throw new StoreError('VALIDATION', msg.replace(/^VALIDATION:\s*/, ''));
  if (msg.startsWith('LOCKED')) throw new StoreError('LOCKED', msg.replace(/^LOCKED:\s*/, ''));
  if (msg.startsWith('FORBIDDEN') || e?.code === '42501') {
    const detail = msg.replace(/^FORBIDDEN:?\s*/, '');
    throw new StoreError('FORBIDDEN', detail && detail !== msg ? detail : '権限がありません');
  }
  if (msg.startsWith('NOT_FOUND') || e?.code === 'P0002' || e?.code === 'PGRST116') throw new StoreError('NOT_FOUND', 'データが見つかりません');
  if (msg.startsWith('UNAUTHENTICATED')) throw new StoreError('UNAUTHENTICATED', 'ログインが必要です');
  if (e?.code === '23503') throw new StoreError('VALIDATION', '他のデータから参照されているため変更できません');
  if (e?.code === '23505') throw new StoreError('VALIDATION', '同じ値が既に登録されています');
  throw new StoreError('INTERNAL', msg);
}

/** migration 未適用の DB（表・関数が無い）では「まだ何も無い」として扱う */
const missing = (error: { code?: string; message?: string }, fn?: string) =>
  isMissingRelation(error) || (fn ? isMissingNamedFunction(error, fn) : false);

export class SupabaseCaseFlowStore implements CaseFlowStore {
  private async db(): Promise<Db> {
    return (await createClient()) as unknown as Db;
  }

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const db = await this.db();
    const { data, error } = await db.rpc(name, args);
    if (error) fail(error);
    return data as T;
  }

  async getCaseAccess(_actor: SessionUser, requestId: string): Promise<CaseAccess | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('case_access', { p_request_id: requestId });
    if (error) {
      if (missing(error, 'case_access')) return null;
      fail(error);
    }
    return (data as CaseAccess | null) ?? null;
  }

  // ---------- 代理店の公開情報 ----------
  async listPublishedDealerProfiles(): Promise<DealerProfile[]> {
    const db = await this.db();
    const { data, error } = await db.from('dealer_profiles').select('*').eq('published', true).order('display_name');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as DealerProfile[];
  }
  async listDealerProfiles(actor: SessionUser): Promise<DealerProfile[]> {
    const db = await this.db();
    let q = db.from('dealer_profiles').select('*').order('display_name');
    if (actor.role !== 'admin') q = q.eq('dealer_id', actor.id);
    const { data, error } = await q;
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as DealerProfile[];
  }
  async getDealerProfile(_actor: SessionUser, dealerId: string): Promise<DealerProfile | null> {
    const db = await this.db();
    const { data, error } = await db.from('dealer_profiles').select('*').eq('dealer_id', dealerId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as DealerProfile | null) ?? null;
  }
  async saveDealerProfile(_actor: SessionUser, dealerId: string, input: DealerProfileInput, expectedLockVersion: number | null) {
    return this.rpc<number>('save_dealer_profile', { p_dealer_id: dealerId, p_profile: input, p_expected_lock_version: expectedLockVersion });
  }
  async setDealerProfilePublished(_actor: SessionUser, dealerId: string, published: boolean, expectedLockVersion: number) {
    return this.rpc<number>('set_dealer_profile_published', {
      p_dealer_id: dealerId,
      p_published: published,
      p_expected_lock_version: expectedLockVersion,
    });
  }

  // ---------- 見積依頼のときのお客様の希望 ----------
  async getQuoteRequestPreferences(_actor: SessionUser, requestId: string): Promise<QuoteRequestPreferences | null> {
    const db = await this.db();
    const { data, error } = await db.from('quote_request_preferences').select('*').eq('quote_request_id', requestId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as QuoteRequestPreferences | null) ?? null;
  }
  async setQuoteRequestPreferences(_actor: SessionUser, requestId: string, input: QuoteRequestPreferencesInput) {
    await this.rpc<void>('set_quote_request_preferences', { p_request_id: requestId, p_preferences: input });
  }

  // ---------- 受付・担当 ----------
  async getCaseWorkflow(_actor: SessionUser, requestId: string): Promise<CaseWorkflow | null> {
    const db = await this.db();
    const { data, error } = await db.from('case_workflows').select('*').eq('quote_request_id', requestId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as CaseWorkflow | null) ?? null;
  }
  async acknowledgeCase(_actor: SessionUser, requestId: string) {
    await this.rpc<void>('acknowledge_case', { p_request_id: requestId });
  }
  async assignCasePrimaryStaff(_actor: SessionUser, requestId: string, staffId: string | null) {
    await this.rpc<void>('assign_case_primary_staff', { p_request_id: requestId, p_staff_id: staffId });
  }
  async setCaseManufacturer(_actor: SessionUser, requestId: string, manufacturerId: string | null) {
    await this.rpc<void>('set_case_manufacturer', { p_request_id: requestId, p_manufacturer_id: manufacturerId });
  }
  async getCaseRole(_actor: SessionUser, requestId: string): Promise<CaseRole | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('case_role', { p_request_id: requestId });
    if (error) {
      // migration 未適用の DB では、これまでの判定（case_access）で代える
      if (missing(error, 'case_role')) return (await this.getCaseAccess(_actor, requestId)) as CaseRole | null;
      fail(error);
    }
    return (data as CaseRole | null) ?? null;
  }
  async getCaseOrganizations(_actor: SessionUser, requestId: string): Promise<CaseOrganizations | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('get_case_organizations', { p_request_id: requestId });
    if (error) {
      if (missing(error, 'get_case_organizations')) return null;
      fail(error);
    }
    return (data as CaseOrganizations | null) ?? null;
  }
  async setCaseSalesOrganization(_actor: SessionUser, requestId: string, organizationId: string | null) {
    await this.rpc<void>('set_case_sales_organization', { p_request_id: requestId, p_organization_id: organizationId });
  }
  async setCaseManufacturingOrganization(_actor: SessionUser, requestId: string, organizationId: string | null) {
    await this.rpc<void>('set_case_manufacturing_organization', { p_request_id: requestId, p_organization_id: organizationId });
  }
  async listSupervisedCases(_actor: SessionUser): Promise<SupervisedCaseSummary[]> {
    const db = await this.db();
    const { data, error } = await db.rpc('list_supervised_cases');
    if (error) {
      if (missing(error, 'list_supervised_cases')) return [];
      fail(error);
    }
    return ((data as SupervisedCaseSummary[] | null) ?? []);
  }
  async getSupervisedCase(_actor: SessionUser, requestId: string): Promise<SupervisedCaseDetail | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('get_supervised_case', { p_request_id: requestId });
    if (error) {
      // 配下でない案件・migration 未適用は「見られない」として扱う（画面は 404）
      if (missing(error, 'get_supervised_case') || error.code === '42501' || error.code === 'P0002') return null;
      fail(error);
    }
    return (data as SupervisedCaseDetail | null) ?? null;
  }
  async listManufacturingCases(_actor: SessionUser): Promise<ManufacturingCaseSummary[]> {
    const db = await this.db();
    const { data, error } = await db.rpc('list_manufacturing_cases');
    if (error) {
      if (missing(error, 'list_manufacturing_cases')) return [];
      fail(error);
    }
    return (data as ManufacturingCaseSummary[] | null) ?? [];
  }
  async getManufacturingCase(_actor: SessionUser, requestId: string): Promise<ManufacturingCaseDetail | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('get_manufacturing_case', { p_request_id: requestId });
    if (error) {
      // 製造の担当でない案件・migration 未適用は「見られない」として扱う（画面は 404）
      if (missing(error, 'get_manufacturing_case') || error.code === '42501' || error.code === 'P0002') return null;
      fail(error);
    }
    return (data as ManufacturingCaseDetail | null) ?? null;
  }
  async getCaseProgress(_actor: SessionUser, requestId: string): Promise<CaseProgress | null> {
    const db = await this.db();
    const { data, error } = await db.rpc('get_case_progress', { p_request_id: requestId });
    if (error) {
      if (missing(error, 'get_case_progress')) return null;
      fail(error);
    }
    return (data as CaseProgress | null) ?? null;
  }

  // ---------- 日程 ----------
  async listCaseAppointments(_actor: SessionUser, requestId: string): Promise<CaseAppointment[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('case_appointments')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CaseAppointment[];
  }
  async listBoardAppointments(_actor: SessionUser): Promise<BoardAppointment[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('case_appointments')
      .select('*')
      .in('status', ['proposed', 'confirmed'])
      .order('created_at', { ascending: true })
      .limit(300);
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    const rows = (data ?? []) as CaseAppointment[];
    const requestIds = [...new Set(rows.map((row) => row.quote_request_id))];
    const labels = new Map<string, { label: string; quote_id: string }>();
    if (requestIds.length) {
      // 見出しは見積（本部はすべて、代理店は担当の見積だけ RLS で見える）から作る
      const { data: quotes } = await db
        .from('quotes')
        .select('id, quote_no, customer_name, quote_request_id, revision')
        .in('quote_request_id', requestIds)
        .order('revision', { ascending: false });
      for (const quote of (quotes ?? []) as { id: string; quote_no: string; customer_name: string; quote_request_id: string }[]) {
        if (!labels.has(quote.quote_request_id)) {
          labels.set(quote.quote_request_id, { label: `${quote.quote_no} ${quote.customer_name} 様`, quote_id: quote.id });
        }
      }
    }
    return rows.map((row) => ({
      ...row,
      case_label: labels.get(row.quote_request_id)?.label ?? '案件',
      quote_id: labels.get(row.quote_request_id)?.quote_id ?? null,
    }));
  }
  async proposeCaseAppointment(_actor: SessionUser, requestId: string, input: CaseAppointmentInput) {
    return this.rpc<string>('propose_case_appointment', { p_request_id: requestId, p_appointment: input });
  }
  async confirmCaseAppointment(_actor: SessionUser, appointmentId: string, candidateIndex: number, expectedLockVersion: number) {
    await this.rpc<void>('confirm_case_appointment', {
      p_appointment_id: appointmentId,
      p_candidate_index: candidateIndex,
      p_expected_lock_version: expectedLockVersion,
    });
  }
  async requestCaseAppointmentChange(_actor: SessionUser, appointmentId: string, note: string, expectedLockVersion: number) {
    await this.rpc<void>('request_case_appointment_change', {
      p_appointment_id: appointmentId,
      p_customer_note: note,
      p_expected_lock_version: expectedLockVersion,
    });
  }
  async setCaseAppointmentStatus(_actor: SessionUser, appointmentId: string, status: 'done' | 'canceled', expectedLockVersion: number) {
    await this.rpc<void>('set_case_appointment_status', {
      p_appointment_id: appointmentId,
      p_status: status,
      p_expected_lock_version: expectedLockVersion,
    });
  }

  // ---------- 現地確認 ----------
  async getSiteSurvey(_actor: SessionUser, requestId: string): Promise<SiteSurvey | null> {
    const db = await this.db();
    const { data, error } = await db.from('site_surveys').select('*').eq('quote_request_id', requestId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as SiteSurvey | null) ?? null;
  }
  async saveSiteSurvey(_actor: SessionUser, requestId: string, input: SiteSurveyInput, expectedLockVersion: number | null) {
    return this.rpc<number>('save_site_survey', { p_request_id: requestId, p_survey: input, p_expected_lock_version: expectedLockVersion });
  }
  async setSiteSurveyStatus(_actor: SessionUser, requestId: string, status: 'completed' | 'draft', expectedLockVersion: number) {
    return this.rpc<number>('set_site_survey_status', { p_request_id: requestId, p_status: status, p_expected_lock_version: expectedLockVersion });
  }

  // ---------- 社内の記録 ----------
  async listCaseNotes(_actor: SessionUser, requestId: string): Promise<CaseNote[]> {
    const db = await this.db();
    const { data, error } = await db.from('case_notes').select('*').eq('quote_request_id', requestId).order('created_at');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CaseNote[];
  }
  async addCaseNote(_actor: SessionUser, requestId: string, input: CaseNoteInput) {
    return this.rpc<string>('add_case_note', { p_request_id: requestId, p_note: input });
  }

  // ---------- 見積の修正依頼 ----------
  async listQuoteChangeRequests(_actor: SessionUser, requestId: string): Promise<QuoteChangeRequest[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('quote_change_requests')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as QuoteChangeRequest[];
  }
  async requestQuoteChange(_actor: SessionUser, quoteId: string, message: string) {
    return this.rpc<string>('request_quote_change', { p_quote_id: quoteId, p_message: message });
  }
  async resolveQuoteChangeRequest(_actor: SessionUser, changeRequestId: string, resolution: string | null) {
    await this.rpc<void>('resolve_quote_change_request', { p_change_request_id: changeRequestId, p_resolution: resolution });
  }

  // ---------- 書面で締結した契約 ----------
  async recordPaperContract(_actor: SessionUser, quoteId: string, input: PaperContractInput, pdf: Uint8Array) {
    // 署名済みの書面は、電子契約と同じ非公開の保存先（contract-documents）へ置いてから記録する。記録できなければ置いた書面を消す
    const storagePath = `contracts/paper/${randomUUID()}.pdf`;
    const admin = createAdminClient();
    const up = await admin.storage.from(CONTRACT_DOCUMENTS_BUCKET).upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
    if (up.error) throw new StoreError('INTERNAL', '契約書を保存できませんでした。時間をおいてもう一度お試しください');
    const db = await this.db();
    const { data, error } = await db.rpc('record_paper_contract', {
      p_quote_id: quoteId,
      p_signer_name: input.signer_name,
      p_signer_email: input.signer_email,
      p_signed_on: input.signed_on,
      p_file_path: storagePath,
    });
    if (error) {
      await admin.storage.from(CONTRACT_DOCUMENTS_BUCKET).remove([storagePath]);
      fail(error);
    }
    return data as string;
  }
  async voidPaperContract(_actor: SessionUser, contractId: string, reason: string) {
    await this.rpc<void>('void_paper_contract', { p_contract_id: contractId, p_reason: reason });
  }

  // ---------- 製造依頼と個体 ----------
  async getManufacturingOrder(_actor: SessionUser, requestId: string): Promise<ManufacturingOrder | null> {
    const db = await this.db();
    const { data, error } = await db
      .from('manufacturing_orders')
      .select('*')
      .eq('quote_request_id', requestId)
      .neq('status', 'canceled')
      .maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as ManufacturingOrder | null) ?? null;
  }
  async listManufacturingUnits(_actor: SessionUser, orderId: string): Promise<ManufacturingUnit[]> {
    const db = await this.db();
    const { data, error } = await db.from('manufacturing_units').select('*').eq('order_id', orderId).order('seq');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as ManufacturingUnit[];
  }
  async listManufacturingBoard(_actor: SessionUser): Promise<BoardManufacturingOrder[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('manufacturing_orders')
      .select('*')
      .neq('status', 'canceled')
      .order('updated_at', { ascending: false })
      .limit(300);
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    const orders = (data ?? []) as ManufacturingOrder[];
    if (orders.length === 0) return [];
    const [{ data: units }, { data: quotes }] = await Promise.all([
      db.from('manufacturing_units').select('order_id, status').in('order_id', orders.map((o) => o.id)),
      db.from('quotes').select('id, quote_no, customer_name, quote_request_id, revision').in('quote_request_id', orders.map((o) => o.quote_request_id)).order('revision', { ascending: false }),
    ]);
    const labels = new Map<string, { label: string; quote_id: string }>();
    for (const quote of (quotes ?? []) as { id: string; quote_no: string; customer_name: string; quote_request_id: string }[]) {
      if (!labels.has(quote.quote_request_id)) labels.set(quote.quote_request_id, { label: `${quote.quote_no} ${quote.customer_name} 様`, quote_id: quote.id });
    }
    const unitRows = (units ?? []) as { order_id: string; status: string }[];
    return orders.map((order) => {
      const mine = unitRows.filter((u) => u.order_id === order.id);
      return {
        ...order,
        // 総代理店は見積（お客様名）を読めないことがあるため、そのときは製造仕様の見積番号を見出しにする
        case_label: labels.get(order.quote_request_id)?.label ?? order.spec_snapshot?.quote_no ?? '案件',
        case_quote_id: labels.get(order.quote_request_id)?.quote_id ?? null,
        units_total: mine.length,
        units_shipped: mine.filter((u) => ['shipped', 'installed', 'handed_over'].includes(u.status)).length,
        units_installed: mine.filter((u) => ['installed', 'handed_over'].includes(u.status)).length,
      };
    });
  }
  async createManufacturingOrder(_actor: SessionUser, requestId: string, input: ManufacturingOrderInput) {
    return this.rpc<string>('create_manufacturing_order', { p_request_id: requestId, p_order: input });
  }
  async updateManufacturingOrder(_actor: SessionUser, orderId: string, input: ManufacturingOrderInput, expectedLockVersion: number) {
    return this.rpc<number>('update_manufacturing_order', { p_order_id: orderId, p_order: input, p_expected_lock_version: expectedLockVersion });
  }
  async sendManufacturingOrder(_actor: SessionUser, orderId: string, expectedLockVersion: number) {
    return this.rpc<number>('send_manufacturing_order', { p_order_id: orderId, p_expected_lock_version: expectedLockVersion });
  }
  async setManufacturingOrderStatus(_actor: SessionUser, orderId: string, status: ManufacturingOrderStatus, expectedLockVersion: number, reason: string | null) {
    return this.rpc<number>('set_manufacturing_order_status', {
      p_order_id: orderId,
      p_status: status,
      p_expected_lock_version: expectedLockVersion,
      p_reason: reason,
    });
  }
  async updateManufacturingUnit(_actor: SessionUser, unitId: string, input: UnitUpdateInput, expectedLockVersion: number) {
    return this.rpc<number>('update_manufacturing_unit', { p_unit_id: unitId, p_unit: input, p_expected_lock_version: expectedLockVersion });
  }

  // ---------- 工程表 ----------
  async listScheduleItems(_actor: SessionUser, requestId: string): Promise<CaseScheduleItem[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('case_schedule_items')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('sort_order')
      .order('planned_start', { ascending: true, nullsFirst: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CaseScheduleItem[];
  }
  async saveScheduleItem(_actor: SessionUser, requestId: string, itemId: string | null, input: ScheduleItemInput, expectedLockVersion: number | null) {
    return this.rpc<{ id: string; lock_version: number }>('save_case_schedule_item', {
      p_request_id: requestId,
      p_item_id: itemId,
      p_item: input,
      p_expected_lock_version: expectedLockVersion,
    });
  }
  async deleteScheduleItem(_actor: SessionUser, itemId: string) {
    await this.rpc<void>('delete_case_schedule_item', { p_item_id: itemId });
  }

  // ---------- 施工の記録 ----------
  async listProgressReports(_actor: SessionUser, requestId: string): Promise<CaseProgressReport[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('case_progress_reports')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('reported_on', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CaseProgressReport[];
  }
  async addProgressReport(_actor: SessionUser, requestId: string, input: ProgressReportInput) {
    return this.rpc<string>('add_case_progress_report', { p_request_id: requestId, p_report: input });
  }
  async setProgressReportVisibility(_actor: SessionUser, reportId: string, visible: boolean) {
    await this.rpc<void>('set_case_progress_report_visibility', { p_report_id: reportId, p_visible: visible });
  }

  /** 案件の見出し（見積番号とお客様名）。見積を読めない総代理店には、製造仕様の見積番号を使う */
  private async caseLabels(db: Db, requestIds: string[]): Promise<Map<string, { label: string; quote_id: string | null }>> {
    const labels = new Map<string, { label: string; quote_id: string | null }>();
    if (requestIds.length === 0) return labels;
    const [{ data: quotes }, { data: orders }] = await Promise.all([
      db.from('quotes').select('id, quote_no, customer_name, quote_request_id, revision').in('quote_request_id', requestIds).order('revision', { ascending: false }),
      db.from('manufacturing_orders').select('quote_request_id, spec_snapshot').in('quote_request_id', requestIds).neq('status', 'canceled'),
    ]);
    for (const quote of (quotes ?? []) as { id: string; quote_no: string; customer_name: string; quote_request_id: string }[]) {
      if (!labels.has(quote.quote_request_id)) labels.set(quote.quote_request_id, { label: `${quote.quote_no} ${quote.customer_name} 様`, quote_id: quote.id });
    }
    for (const order of (orders ?? []) as { quote_request_id: string; spec_snapshot: { quote_no?: string } | null }[]) {
      if (!labels.has(order.quote_request_id) && order.spec_snapshot?.quote_no) labels.set(order.quote_request_id, { label: order.spec_snapshot.quote_no, quote_id: null });
    }
    return labels;
  }

  // ---------- 完了確認・是正・引渡し ----------
  async getHandover(_actor: SessionUser, requestId: string): Promise<CaseHandover | null> {
    const db = await this.db();
    const { data, error } = await db.from('case_handovers').select('*').eq('quote_request_id', requestId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    return (data as CaseHandover | null) ?? null;
  }
  async listPunchItems(_actor: SessionUser, requestId: string): Promise<CasePunchItem[]> {
    const db = await this.db();
    const { data, error } = await db.from('case_punch_items').select('*').eq('quote_request_id', requestId).order('created_at');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CasePunchItem[];
  }
  async startHandoverInspection(_actor: SessionUser, requestId: string, input: HandoverInspectionInput, expectedLockVersion: number | null) {
    return this.rpc<number>('start_handover_inspection', { p_request_id: requestId, p_inspection: input, p_expected_lock_version: expectedLockVersion });
  }
  async confirmHandover(_actor: SessionUser, requestId: string, result: 'ok' | 'issues', issues: string[], expectedLockVersion: number) {
    return this.rpc<number>('confirm_handover', {
      p_request_id: requestId,
      p_result: result,
      p_issues: result === 'issues' ? issues : null,
      p_expected_lock_version: expectedLockVersion,
    });
  }
  async addPunchItem(_actor: SessionUser, requestId: string, description: string, expectedLockVersion: number) {
    return this.rpc<string>('add_punch_item', { p_request_id: requestId, p_description: description, p_expected_lock_version: expectedLockVersion });
  }
  async setPunchItemStatus(_actor: SessionUser, itemId: string, status: 'fixed' | 'verified', expectedLockVersion: number) {
    return this.rpc<number>('set_punch_item_status', { p_item_id: itemId, p_status: status, p_expected_lock_version: expectedLockVersion });
  }
  async recordCompletionCertificate(_actor: SessionUser, requestId: string, fileId: string, signedOn: string, expectedLockVersion: number) {
    return this.rpc<number>('record_completion_certificate', {
      p_request_id: requestId,
      p_file_id: fileId,
      p_signed_on: signedOn,
      p_expected_lock_version: expectedLockVersion,
    });
  }
  async completeHandover(_actor: SessionUser, requestId: string, handedOverOn: string, expectedLockVersion: number) {
    return this.rpc<number>('complete_handover', { p_request_id: requestId, p_handed_over_on: handedOverOn, p_expected_lock_version: expectedLockVersion });
  }

  // ---------- アフター ----------
  async listAfterServiceRequests(_actor: SessionUser, requestId: string): Promise<AfterServiceRequest[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('after_service_requests')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('created_at', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as AfterServiceRequest[];
  }
  async listAfterServiceBoard(_actor: SessionUser): Promise<BoardAfterServiceRequest[]> {
    const db = await this.db();
    const { data, error } = await db.from('after_service_requests').select('*').order('updated_at', { ascending: false }).limit(300);
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    const rows = (data ?? []) as AfterServiceRequest[];
    const requestIds = [...new Set(rows.map((row) => row.quote_request_id))];
    // 操作の選択肢を出すため、案件ごとの関わり方を DB の case_access で確かめる（判定の正本は更新の RPC）
    const [labels, accessList] = await Promise.all([
      this.caseLabels(db, requestIds),
      Promise.all(requestIds.map(async (id) => [id, (await db.rpc('case_access', { p_request_id: id })).data as CaseAccess | null] as const)),
    ]);
    const accessOf = new Map(accessList);
    return rows.map((row) => ({
      ...row,
      case_label: labels.get(row.quote_request_id)?.label ?? '案件',
      case_quote_id: labels.get(row.quote_request_id)?.quote_id ?? null,
      viewer_access: accessOf.get(row.quote_request_id) ?? null,
    }));
  }
  async createAfterServiceRequest(_actor: SessionUser, requestId: string, input: AfterServiceRequestInput) {
    return this.rpc<string>('create_after_service_request', { p_request_id: requestId, p_request: input });
  }
  async updateAfterServiceRequest(_actor: SessionUser, id: string, input: AfterServiceUpdateInput, expectedLockVersion: number) {
    return this.rpc<number>('update_after_service_request', { p_id: id, p_update: input, p_expected_lock_version: expectedLockVersion });
  }

  // ---------- 災害時提供の意思 ----------
  async listDisasterConsentTexts(_actor: SessionUser): Promise<DisasterConsentText[]> {
    const db = await this.db();
    const { data, error } = await db.from('disaster_consent_texts').select('id, version, title, body, published_at').order('version', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as DisasterConsentText[];
  }
  async publishDisasterConsentText(_actor: SessionUser, input: { title: string; body: string }) {
    return this.rpc<number>('publish_disaster_consent_text', { p_title: input.title, p_body: input.body });
  }
  async listDisasterConsents(_actor: SessionUser, requestId: string): Promise<DisasterConsent[]> {
    const db = await this.db();
    const { data, error } = await db
      .from('disaster_consents')
      .select('*')
      .eq('quote_request_id', requestId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as DisasterConsent[];
  }
  async setDisasterConsent(_actor: SessionUser, requestId: string, input: DisasterConsentInput) {
    return this.rpc<string>('set_disaster_consent', {
      p_request_id: requestId,
      p_decision: input.decision,
      p_conditions: input.conditions,
      p_text_version: input.text_version,
    });
  }

  // ---------- 全国ストック台帳 ----------
  async listStockLedger(_actor: SessionUser): Promise<StockLedgerRow[]> {
    const db = await this.db();
    const { data: entryData, error } = await db.from('stock_ledger_entries').select('*');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    const entries = (entryData ?? []) as StockLedgerEntry[];
    // 引渡し済みの個体と、台帳に載っている個体（本部が状態を戻したものも含める）
    const { data: handedOver, error: unitError } = await db
      .from('manufacturing_units')
      .select('*')
      .eq('status', 'handed_over')
      .order('handed_over_on', { ascending: false, nullsFirst: false })
      .limit(500);
    if (unitError) fail(unitError);
    const units = (handedOver ?? []) as ManufacturingUnit[];
    const missingIds = entries.map((e) => e.unit_id).filter((id) => !units.some((u) => u.id === id));
    if (missingIds.length) {
      const { data: extra } = await db.from('manufacturing_units').select('*').in('id', missingIds);
      units.push(...((extra ?? []) as ManufacturingUnit[]));
    }
    const requestIds = [...new Set(units.map((u) => u.quote_request_id))];
    const [labels, { data: consentData }] = await Promise.all([
      this.caseLabels(db, requestIds),
      requestIds.length
        ? db.from('disaster_consents').select('*').in('quote_request_id', requestIds).order('created_at', { ascending: false }).order('id', { ascending: false })
        : Promise.resolve({ data: [] as DisasterConsent[] }),
    ]);
    const latest = new Map<string, DisasterConsent>();
    for (const consent of (consentData ?? []) as DisasterConsent[]) {
      if (!latest.has(consent.quote_request_id)) latest.set(consent.quote_request_id, consent);
    }
    return units.map((unit) => ({
      unit,
      entry: entries.find((e) => e.unit_id === unit.id) ?? null,
      latest_consent: latest.get(unit.quote_request_id) ?? null,
      case_label: labels.get(unit.quote_request_id)?.label ?? '案件',
      case_quote_id: labels.get(unit.quote_request_id)?.quote_id ?? null,
    }));
  }
  async saveStockLedgerEntry(_actor: SessionUser, unitId: string, input: StockLedgerEntryInput, expectedLockVersion: number | null) {
    return this.rpc<number>('save_stock_ledger_entry', { p_unit_id: unitId, p_entry: input, p_expected_lock_version: expectedLockVersion });
  }

  // ---------- 一時保存（ログインなし） ----------
  async createGuestPlan(baseModelId: string, plan: GuestPlanInput) {
    // 鍵はサーバーで作り、DB にはハッシュだけを渡す（RPC はサーバー＝service_role だけが呼べる）
    const token = randomBytes(24).toString('base64url');
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('create_guest_plan', { p_token_hash: sha256(token), p_base_model_id: baseModelId, p_plan: plan });
    if (error) fail(error);
    return { token, expires_at: data as string };
  }
  async getGuestPlan(token: string): Promise<GuestPlan | null> {
    if (!GUEST_PLAN_TOKEN.test(token)) return null;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('get_guest_plan', { p_token_hash: sha256(token) });
    if (error) {
      if (missing(error, 'get_guest_plan')) return null;
      fail(error);
    }
    return (data as GuestPlan | null) ?? null;
  }

  // ---------- 設置予定地・土地 ----------
  async getSiteProfile(_actor: SessionUser, configurationId: string): Promise<SiteProfile | null> {
    const db = await this.db();
    const { data, error } = await db.from('configuration_site_profiles').select('*').eq('configuration_id', configurationId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    if (!data) return null;
    const row = data as SiteProfile & { area_sqm: number | string | null };
    return { ...row, area_sqm: row.area_sqm === null ? null : Number(row.area_sqm) };
  }
  async saveSiteProfile(_actor: SessionUser, configurationId: string, input: SiteProfileInput, expectedLockVersion: number | null) {
    return this.rpc<number>('save_configuration_site_profile', {
      p_configuration_id: configurationId,
      p_profile: input,
      p_expected_lock_version: expectedLockVersion,
    });
  }

  // ---------- 写真・書類 ----------
  async listCaseFiles(_actor: SessionUser, requestId: string): Promise<CaseFile[]> {
    const db = await this.db();
    const { data, error } = await db.from('case_files').select('*').eq('quote_request_id', requestId).order('created_at');
    if (error) {
      if (missing(error)) return [];
      fail(error);
    }
    return (data ?? []) as CaseFile[];
  }
  async uploadCaseFile(actor: SessionUser, requestId: string, input: CaseFileInput, bytes: Uint8Array): Promise<CaseFile> {
    if (bytes.byteLength !== input.size_bytes) throw new StoreError('VALIDATION', 'ファイルの大きさが一致しません');
    // 1. 登録してよいかを DB で確かめ、行と保存先を作る（権限の判定は DB）
    const registered = await this.rpc<{ id: string; storage_path: string }>('register_case_file', { p_request_id: requestId, p_file: input });
    // 2. 非公開の保存先へ置く（保存先は DB が決めた名前だけ）
    const admin = createAdminClient();
    const up = await admin.storage.from(CASE_FILES_BUCKET).upload(registered.storage_path, bytes, { contentType: input.content_type, upsert: false });
    if (up.error) {
      try {
        await this.rpc<string>('delete_case_file', { p_file_id: registered.id });
      } catch (rollbackError) {
        console.error('[wing] case file registration could not be rolled back', rollbackError);
      }
      throw new StoreError('INTERNAL', 'ファイルを保存できませんでした。時間をおいてもう一度お試しください');
    }
    const db = await this.db();
    const { data, error } = await db.from('case_files').select('*').eq('id', registered.id).single();
    if (error) fail(error);
    void actor;
    return data as CaseFile;
  }
  async getCaseFileContent(_actor: SessionUser, fileId: string) {
    // 見てよいかは利用者のセッション（RLS）で判定し、見える行のファイルだけ service role で取り出す
    const db = await this.db();
    const { data, error } = await db.from('case_files').select('*').eq('id', fileId).maybeSingle();
    if (error) {
      if (missing(error)) return null;
      fail(error);
    }
    const file = data as CaseFile | null;
    if (!file) return null;
    const admin = createAdminClient();
    const { data: blob, error: dlError } = await admin.storage.from(CASE_FILES_BUCKET).download(file.storage_path);
    if (dlError || !blob) return null;
    return { file, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  async deleteCaseFile(_actor: SessionUser, fileId: string) {
    const path = await this.rpc<string>('delete_case_file', { p_file_id: fileId });
    const admin = createAdminClient();
    const { error } = await admin.storage.from(CASE_FILES_BUCKET).remove([path]);
    if (error) console.error('[wing] case file object could not be removed', path, error.message);
  }
}
