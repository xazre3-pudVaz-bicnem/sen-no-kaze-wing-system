import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { isMissingNamedFunction, isMissingRelation } from '@/lib/data/schema-compat';
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
  PaperContractInput,
  QuoteChangeRequest,
  QuoteRequestPreferences,
  QuoteRequestPreferencesInput,
  SiteSurvey,
  SiteSurveyInput,
} from '@/lib/domain/case-flow';
import type { BoardAppointment, CaseFlowStore } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

const CASE_FILES_BUCKET = 'case-files';
const CONTRACT_DOCUMENTS_BUCKET = 'contract-documents';

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
