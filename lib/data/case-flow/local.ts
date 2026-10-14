import 'server-only';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { filesDir, loadDb, saveDb, type LocalDb } from '@/lib/data/local-db';
import { ROLE_RANK, type AppNotification } from '@/lib/domain/types';
import {
  CASE_FILE_TYPES,
  canChangeAppointmentStatus,
  canRegisterCaseFile,
  type CaseAccess,
  type CaseAppointment,
  type CaseAppointmentInput,
  type CaseFile,
  type CaseFileInput,
  type CaseNote,
  type CaseNoteInput,
  type CaseProgress,
  type CaseWorkflow,
  type DealerProfileInput,
  type PaperContractInput,
  type QuoteRequestPreferences,
  type QuoteRequestPreferencesInput,
  type SiteSurvey,
  type SiteSurveyInput,
} from '@/lib/domain/case-flow';
import { emptyCaseFlowTables, type LocalCaseFlowTables } from './local-tables';
import type { BoardAppointment, CaseFlowStore } from './store';

/**
 * ローカル検証モードの案件の進行。DB（20261013220000）の RPC・RLS と同じ判定を行う（開発・E2E 用。本番では使わない）。
 */
const nowIso = () => new Date().toISOString();
const notFound = () => new StoreError('NOT_FOUND', 'データが見つかりません');
const forbidden = (message = '権限がありません') => new StoreError('FORBIDDEN', message);
const locked = (message: string) => new StoreError('LOCKED', message);
const invalid = (message: string) => new StoreError('VALIDATION', message);

function tables(db: LocalDb): LocalCaseFlowTables {
  db.caseFlow ??= emptyCaseFlowTables();
  return db.caseFlow;
}

function rank(actor: SessionUser) {
  return ROLE_RANK[actor.role] ?? 0;
}

/** DB の case_access() と同じ */
function accessOf(db: LocalDb, actor: SessionUser, requestId: string): CaseAccess | null {
  const request = db.quoteRequests.find((r) => r.id === requestId);
  if (!request) return null;
  if (rank(actor) >= 3) return 'admin';
  if (rank(actor) >= 1 && request.quote_id) {
    const quote = db.quotes.find((q) => q.id === request.quote_id);
    if (quote?.dealer_id === actor.id) return 'staff';
  }
  if (rank(actor) >= 2 && tables(db).workflows.some((w) => w.quote_request_id === requestId && w.manufacturer_id === actor.id)) {
    return 'manufacturer';
  }
  if (request.user_id === actor.id) return 'customer';
  return null;
}

function notify(
  db: LocalDb,
  n: { recipient_id: string | null; audience: AppNotification['audience']; kind: string; title: string; body: string; link: string }
) {
  db.notifications.push({
    id: randomUUID(),
    recipient_id: n.recipient_id,
    audience: n.audience,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    read_at: null,
    email_status: 'pending',
    email_error: null,
    created_at: nowIso(),
  });
}

function caseDealerId(db: LocalDb, requestId: string): string | null {
  const request = db.quoteRequests.find((r) => r.id === requestId);
  const quote = request?.quote_id ? db.quotes.find((q) => q.id === request.quote_id) : null;
  return quote?.dealer_id ?? null;
}

function workflowOf(db: LocalDb, requestId: string, actorId: string): CaseWorkflow {
  const t = tables(db);
  let workflow = t.workflows.find((w) => w.quote_request_id === requestId);
  if (!workflow) {
    workflow = {
      quote_request_id: requestId,
      acknowledged_at: null,
      acknowledged_by: null,
      primary_staff_id: null,
      primary_assigned_at: null,
      manufacturer_id: null,
      manufacturer_assigned_at: null,
      updated_at: nowIso(),
    };
    t.workflows.push(workflow);
  }
  void actorId;
  return workflow;
}

export class LocalCaseFlowStore implements CaseFlowStore {
  private mutate<T>(fn: (db: LocalDb) => T): T {
    const db = loadDb();
    const result = fn(db);
    saveDb(db);
    return result;
  }
  private read<T>(fn: (db: LocalDb) => T): T {
    return fn(loadDb());
  }

  async getCaseAccess(actor: SessionUser, requestId: string) {
    return this.read((db) => accessOf(db, actor, requestId));
  }

  // ---------- 代理店の公開情報 ----------
  async listPublishedDealerProfiles() {
    return this.read((db) =>
      tables(db)
        .dealerProfiles.filter((p) => p.published)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'))
        .map((p) => ({ ...p }))
    );
  }
  async listDealerProfiles(actor: SessionUser) {
    return this.read((db) =>
      tables(db)
        .dealerProfiles.filter((p) => actor.role === 'admin' || p.dealer_id === actor.id)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja'))
        .map((p) => ({ ...p }))
    );
  }
  async getDealerProfile(actor: SessionUser, dealerId: string) {
    return this.read((db) => {
      const profile = tables(db).dealerProfiles.find((p) => p.dealer_id === dealerId);
      if (!profile) return null;
      if (!profile.published && actor.role !== 'admin' && actor.id !== dealerId) return null;
      return { ...profile };
    });
  }
  async saveDealerProfile(actor: SessionUser, dealerId: string, input: DealerProfileInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      if (!(rank(actor) >= 3 || (rank(actor) >= 1 && rank(actor) <= 2 && dealerId === actor.id))) {
        throw forbidden('代理店の情報を編集できるのは本部と、その代理店だけです');
      }
      const target = db.profiles.find((p) => p.id === dealerId);
      if (!target) throw notFound();
      if (target.role_code !== 'dealer' && target.role_code !== 'master_dealer') {
        throw invalid('代理店・総代理店のアカウントだけ公開情報を登録できます');
      }
      const t = tables(db);
      const current = t.dealerProfiles.find((p) => p.dealer_id === dealerId);
      if (!current) {
        if (expectedLockVersion !== null) throw locked('他の画面でこの代理店の情報が更新されています。再読み込みしてください');
        t.dealerProfiles.push({ dealer_id: dealerId, ...input, published: false, published_at: null, lock_version: 1, updated_at: nowIso() });
        return 1;
      }
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面でこの代理店の情報が更新されています。再読み込みしてください');
      Object.assign(current, input, { lock_version: current.lock_version + 1, updated_at: nowIso() });
      return current.lock_version;
    });
  }
  async setDealerProfilePublished(actor: SessionUser, dealerId: string, published: boolean, expectedLockVersion: number) {
    return this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('代理店の情報を公開できるのは本部だけです');
      const current = tables(db).dealerProfiles.find((p) => p.dealer_id === dealerId);
      if (!current) throw notFound();
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面でこの代理店の情報が更新されています。再読み込みしてください');
      current.published = published;
      current.published_at = published ? nowIso() : null;
      current.lock_version += 1;
      current.updated_at = nowIso();
      notify(db, {
        recipient_id: dealerId,
        audience: 'dealer',
        kind: 'dealer_profile_published',
        title: published ? '代理店の紹介ページが公開されました' : '代理店の紹介ページを非公開にしました',
        body: published ? 'お客様の代理店検索に表示されます。' : 'お客様の代理店検索には表示されません。',
        link: `/admin/dealers/${dealerId}`,
      });
      return current.lock_version;
    });
  }

  // ---------- 見積依頼のときのお客様の希望 ----------
  async getQuoteRequestPreferences(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'manufacturer') return null;
      const row = tables(db).preferences.find((p) => p.quote_request_id === requestId);
      return row ? { ...row, preferred_slots: [...row.preferred_slots] } : null;
    });
  }
  async setQuoteRequestPreferences(actor: SessionUser, requestId: string, input: QuoteRequestPreferencesInput) {
    this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'customer' && access !== 'admin') throw forbidden('ご依頼の希望を変更できるのは、ご依頼のお客様と本部だけです');
      const t = tables(db);
      if (input.preferred_dealer_id && !t.dealerProfiles.some((p) => p.dealer_id === input.preferred_dealer_id && p.published)) {
        throw invalid('指定した代理店は選べません');
      }
      const current = t.preferences.find((p) => p.quote_request_id === requestId);
      const before = current?.preferred_dealer_id ?? null;
      const next: QuoteRequestPreferences = { quote_request_id: requestId, ...input, updated_at: nowIso() };
      if (current) Object.assign(current, next);
      else t.preferences.push(next);
      if (input.preferred_dealer_id && input.preferred_dealer_id !== before) {
        notify(db, {
          recipient_id: null,
          audience: 'admin',
          kind: 'case_preferred_dealer',
          title: 'お客様が相談したい代理店を指定しました',
          body: '案件の「受付・担当」で、担当代理店を割り当ててください。',
          link: `/admin/quotes?request=${requestId}`,
        });
      }
    });
  }

  // ---------- 受付・担当 ----------
  async getCaseWorkflow(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') return null;
      const row = tables(db).workflows.find((w) => w.quote_request_id === requestId);
      return row ? { ...row } : null;
    });
  }
  async acknowledgeCase(actor: SessionUser, requestId: string) {
    this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('受付できるのは本部と担当代理店だけです');
      const workflow = workflowOf(db, requestId, actor.id);
      if (workflow.acknowledged_at) return;
      workflow.acknowledged_at = nowIso();
      workflow.acknowledged_by = actor.id;
      workflow.updated_at = nowIso();
      const request = db.quoteRequests.find((r) => r.id === requestId);
      if (request?.user_id) {
        notify(db, {
          recipient_id: request.user_id,
          audience: 'customer',
          kind: 'case_acknowledged',
          title: 'ご依頼を受け付けました',
          body: '担当より、打合せの日程などのご連絡をいたします。進み具合はマイページで確認できます。',
          link: `/mypage/cases/${requestId}`,
        });
      }
    });
  }
  async assignCasePrimaryStaff(actor: SessionUser, requestId: string, staffId: string | null) {
    this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('主担当者を決められるのは本部と担当代理店だけです');
      const dealerId = caseDealerId(db, requestId);
      let role: string | undefined;
      if (staffId) {
        role = db.profiles.find((p) => p.id === staffId)?.role_code;
        if (!role || !(role === 'admin' || staffId === dealerId)) {
          throw invalid('主担当者は本部の担当者か、この案件の担当代理店から選んでください');
        }
      }
      if (access === 'staff' && staffId !== actor.id) throw forbidden('担当代理店は自分を主担当者にすることだけできます');
      const workflow = workflowOf(db, requestId, actor.id);
      workflow.primary_staff_id = staffId;
      workflow.primary_assigned_at = staffId ? nowIso() : null;
      workflow.updated_at = nowIso();
      if (staffId && staffId !== actor.id) {
        notify(db, {
          recipient_id: staffId,
          audience: role === 'admin' ? 'admin' : 'dealer',
          kind: 'case_primary_assigned',
          title: '案件の主担当者になりました',
          body: 'お客様への連絡と日程の調整をお願いします。',
          link: `/admin/quotes?request=${requestId}`,
        });
      }
    });
  }
  async setCaseManufacturer(actor: SessionUser, requestId: string, manufacturerId: string | null) {
    this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('技術検討・製造の担当を決められるのは本部だけです');
      if (!db.quoteRequests.some((r) => r.id === requestId)) throw notFound();
      if (manufacturerId && db.profiles.find((p) => p.id === manufacturerId)?.role_code !== 'master_dealer') {
        throw invalid('技術検討・製造の担当は総代理店から選んでください');
      }
      const workflow = workflowOf(db, requestId, actor.id);
      workflow.manufacturer_id = manufacturerId;
      workflow.manufacturer_assigned_at = manufacturerId ? nowIso() : null;
      workflow.updated_at = nowIso();
      if (manufacturerId) {
        notify(db, {
          recipient_id: manufacturerId,
          audience: 'dealer',
          kind: 'case_manufacturer_assigned',
          title: '技術検討・製造の担当に指定されました',
          body: '案件の仕様と現地確認の内容を確認し、技術検討を記録してください。',
          link: `/admin/manufacturing?request=${requestId}`,
        });
      }
    });
  }
  async getCaseProgress(actor: SessionUser, requestId: string): Promise<CaseProgress | null> {
    return this.read((db) => {
      if (!accessOf(db, actor, requestId)) return null;
      const t = tables(db);
      const workflow = t.workflows.find((w) => w.quote_request_id === requestId);
      const survey = t.siteSurveys.find((s) => s.quote_request_id === requestId);
      const primary = workflow?.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id) : null;
      return {
        acknowledged_at: workflow?.acknowledged_at ?? null,
        primary_staff_name: primary?.full_name ?? null,
        site_survey_status: survey?.status ?? 'none',
        site_survey_completed_at: survey?.completed_at ?? null,
      };
    });
  }

  // ---------- 日程 ----------
  async listCaseAppointments(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'manufacturer') return [];
      return tables(db)
        .appointments.filter((a) => a.quote_request_id === requestId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((a) => ({ ...a, candidates: [...a.candidates] }));
    });
  }
  async listBoardAppointments(actor: SessionUser): Promise<BoardAppointment[]> {
    return this.read((db) =>
      tables(db)
        .appointments.filter((a) => (a.status === 'proposed' || a.status === 'confirmed') && ['admin', 'staff'].includes(accessOf(db, actor, a.quote_request_id) ?? ''))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((a) => {
          const quote = db.quotes
            .filter((q) => q.quote_request_id === a.quote_request_id)
            .sort((x, y) => (y.revision ?? 0) - (x.revision ?? 0))[0];
          return { ...a, candidates: [...a.candidates], case_label: quote ? `${quote.quote_no} ${quote.customer_name} 様` : '案件', quote_id: quote?.id ?? null };
        })
    );
  }
  async proposeCaseAppointment(actor: SessionUser, requestId: string, input: CaseAppointmentInput) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('日程を送れるのは本部と担当代理店だけです');
      const now = nowIso();
      const first = input.candidates[0];
      const appointment: CaseAppointment = {
        id: randomUUID(),
        quote_request_id: requestId,
        purpose: input.purpose,
        method: input.method,
        status: input.confirm ? 'confirmed' : 'proposed',
        candidates: input.candidates,
        confirmed_starts_at: input.confirm ? first.starts_at : null,
        confirmed_ends_at: input.confirm ? first.ends_at : null,
        location: input.location,
        note: input.note,
        customer_note: null,
        lock_version: 1,
        created_at: now,
        updated_at: now,
      };
      tables(db).appointments.push(appointment);
      const request = db.quoteRequests.find((r) => r.id === requestId);
      if (request?.user_id) {
        notify(db, {
          recipient_id: request.user_id,
          audience: 'customer',
          kind: `case_appointment_${input.confirm ? 'confirmed' : 'proposed'}`,
          title: input.confirm ? '打合せなどの日時が決まりました' : '打合せなどの候補日をお送りしました',
          body: input.confirm ? 'マイページで日時と場所をご確認ください。' : 'マイページで、ご都合の良い日時を選んでください。',
          link: `/mypage/cases/${requestId}`,
        });
      }
      return appointment.id;
    });
  }
  async confirmCaseAppointment(actor: SessionUser, appointmentId: string, candidateIndex: number, expectedLockVersion: number) {
    this.mutate((db) => {
      const appointment = tables(db).appointments.find((a) => a.id === appointmentId);
      if (!appointment) throw notFound();
      const access = accessOf(db, actor, appointment.quote_request_id);
      if (!access || access === 'manufacturer') throw notFound();
      if (appointment.status !== 'proposed') throw locked('この日程はすでに決まっているか、取り消されています');
      if (appointment.lock_version !== expectedLockVersion) throw locked('日程が更新されています。再読み込みしてください');
      const candidate = appointment.candidates[candidateIndex];
      if (!Number.isInteger(candidateIndex) || !candidate) throw invalid('候補の日時を選んでください');
      appointment.status = 'confirmed';
      appointment.confirmed_starts_at = candidate.starts_at;
      appointment.confirmed_ends_at = candidate.ends_at;
      appointment.lock_version += 1;
      appointment.updated_at = nowIso();
      const requestId = appointment.quote_request_id;
      if (access === 'customer') {
        notify(db, { recipient_id: null, audience: 'admin', kind: 'case_appointment_confirmed', title: 'お客様が日程を選びました', body: '案件の「現地確認」タブで日時を確認してください。', link: `/admin/quotes?request=${requestId}` });
        const dealerId = caseDealerId(db, requestId);
        if (dealerId) {
          notify(db, { recipient_id: dealerId, audience: 'dealer', kind: 'case_appointment_confirmed', title: 'お客様が日程を選びました', body: '案件の「現地確認」タブで日時を確認してください。', link: `/admin/quotes?request=${requestId}` });
        }
      } else {
        const request = db.quoteRequests.find((r) => r.id === requestId);
        if (request?.user_id) {
          notify(db, { recipient_id: request.user_id, audience: 'customer', kind: 'case_appointment_confirmed', title: '打合せなどの日時が決まりました', body: 'マイページで日時と場所をご確認ください。', link: `/mypage/cases/${requestId}` });
        }
      }
    });
  }
  async requestCaseAppointmentChange(actor: SessionUser, appointmentId: string, note: string, expectedLockVersion: number) {
    this.mutate((db) => {
      const appointment = tables(db).appointments.find((a) => a.id === appointmentId);
      if (!appointment || accessOf(db, actor, appointment.quote_request_id) !== 'customer') throw notFound();
      if (appointment.status !== 'proposed') throw locked('この日程はすでに決まっているか、取り消されています');
      if (appointment.lock_version !== expectedLockVersion) throw locked('日程が更新されています。再読み込みしてください');
      const text = note.trim();
      if (!text || text.length > 1000) throw invalid('ご都合の良い日時やご要望を 1000 文字以内で入力してください');
      appointment.customer_note = text;
      appointment.lock_version += 1;
      appointment.updated_at = nowIso();
      const requestId = appointment.quote_request_id;
      notify(db, { recipient_id: null, audience: 'admin', kind: 'case_appointment_change_requested', title: 'お客様から日程の変更のご要望がありました', body: '候補の日時が合わないとのご連絡です。案件の「現地確認」タブで確認し、新しい候補を送ってください。', link: `/admin/quotes?request=${requestId}` });
      const dealerId = caseDealerId(db, requestId);
      if (dealerId) {
        notify(db, { recipient_id: dealerId, audience: 'dealer', kind: 'case_appointment_change_requested', title: 'お客様から日程の変更のご要望がありました', body: '候補の日時が合わないとのご連絡です。新しい候補を送ってください。', link: `/admin/quotes?request=${requestId}` });
      }
    });
  }
  async setCaseAppointmentStatus(actor: SessionUser, appointmentId: string, status: 'done' | 'canceled', expectedLockVersion: number) {
    this.mutate((db) => {
      const appointment = tables(db).appointments.find((a) => a.id === appointmentId);
      if (!appointment) throw notFound();
      const access = accessOf(db, actor, appointment.quote_request_id);
      if (access !== 'admin' && access !== 'staff') throw forbidden('日程を変更できるのは本部と担当代理店だけです');
      if (appointment.lock_version !== expectedLockVersion) throw locked('日程が更新されています。再読み込みしてください');
      if (!canChangeAppointmentStatus(appointment.status, status)) throw locked('この日程はその状態に変更できません');
      appointment.status = status;
      appointment.lock_version += 1;
      appointment.updated_at = nowIso();
      if (status === 'canceled') {
        const request = db.quoteRequests.find((r) => r.id === appointment.quote_request_id);
        if (request?.user_id) {
          notify(db, { recipient_id: request.user_id, audience: 'customer', kind: 'case_appointment_canceled', title: '日程を取り消しました', body: '担当より改めてご連絡いたします。', link: `/mypage/cases/${appointment.quote_request_id}` });
        }
      }
    });
  }

  // ---------- 現地確認 ----------
  async getSiteSurvey(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') return null;
      const row = tables(db).siteSurveys.find((s) => s.quote_request_id === requestId);
      return row ? { ...row, land: { ...row.land }, legal: { ...row.legal } } : null;
    });
  }
  async saveSiteSurvey(actor: SessionUser, requestId: string, input: SiteSurveyInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('現地確認を記録できるのは本部と担当代理店だけです');
      const t = tables(db);
      const current = t.siteSurveys.find((s) => s.quote_request_id === requestId);
      if (!current) {
        if (expectedLockVersion !== null) throw locked('他の画面で現地確認が更新されています。再読み込みしてください');
        const row: SiteSurvey = { quote_request_id: requestId, status: 'draft', ...input, completed_at: null, lock_version: 1, updated_at: nowIso() };
        t.siteSurveys.push(row);
        return 1;
      }
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面で現地確認が更新されています。再読み込みしてください');
      if (current.status === 'completed') throw locked('完了した現地確認は変更できません。変更するときは「記録中に戻す」を押してください');
      Object.assign(current, input, { lock_version: current.lock_version + 1, updated_at: nowIso() });
      return current.lock_version;
    });
  }
  async setSiteSurveyStatus(actor: SessionUser, requestId: string, status: 'completed' | 'draft', expectedLockVersion: number) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('現地確認を完了できるのは本部と担当代理店だけです');
      const current = tables(db).siteSurveys.find((s) => s.quote_request_id === requestId);
      if (!current) throw invalid('先に現地確認の内容を保存してください');
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面で現地確認が更新されています。再読み込みしてください');
      if (current.status === status) return current.lock_version;
      if (status === 'completed' && !current.surveyed_on) throw invalid('確認日を入力してから完了にしてください');
      current.status = status;
      current.completed_at = status === 'completed' ? nowIso() : null;
      current.lock_version += 1;
      current.updated_at = nowIso();
      if (status === 'completed') {
        notify(db, { recipient_id: null, audience: 'admin', kind: 'site_survey_completed', title: '現地確認が完了しました', body: '案件の「現地確認」タブで内容を確認してください。', link: `/admin/quotes?request=${requestId}` });
      }
      return current.lock_version;
    });
  }

  // ---------- 社内の記録 ----------
  async listCaseNotes(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') return [];
      return tables(db)
        .notes.filter((n) => n.quote_request_id === requestId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((n) => ({ ...n }));
    });
  }
  async addCaseNote(actor: SessionUser, requestId: string, input: CaseNoteInput) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') throw forbidden('社内の記録を書けるのは本部・担当代理店・技術検討の担当だけです');
      const t = tables(db);
      let parent: CaseNote | undefined;
      if (input.kind === 'tech_review') {
        if (access !== 'admin' && access !== 'manufacturer') throw forbidden('技術検討を記録できるのは本部と技術検討の担当（総代理店）だけです');
      } else if (input.kind === 'consult_reply') {
        if (access !== 'admin') throw forbidden('相談への回答は本部だけが書けます');
        parent = t.notes.find((n) => n.id === input.parent_id);
        if (!parent || parent.quote_request_id !== requestId || parent.kind !== 'consult') throw invalid('回答する相談を選んでください');
      } else if (access !== 'admin' && access !== 'staff') {
        throw forbidden('打合せ記録・相談を書けるのは本部と担当代理店だけです');
      }
      const profileName = db.profiles.find((p) => p.id === actor.id)?.full_name?.trim();
      const note: CaseNote = {
        id: randomUUID(),
        quote_request_id: requestId,
        kind: input.kind,
        body: input.body,
        verdict: input.kind === 'tech_review' ? input.verdict : null,
        estimated_cost: input.kind === 'tech_review' ? input.estimated_cost : null,
        parent_id: input.kind === 'consult_reply' ? (input.parent_id as string) : null,
        created_by: actor.id,
        author_name: (profileName || (access === 'admin' ? '本部' : access === 'manufacturer' ? '総代理店' : '担当代理店')).slice(0, 100),
        created_at: nowIso(),
      };
      t.notes.push(note);
      const link = `/admin/quotes?request=${requestId}`;
      const dealerId = caseDealerId(db, requestId);
      if (input.kind === 'consult') {
        notify(db, { recipient_id: null, audience: 'admin', kind: 'case_consult', title: '代理店から本部への相談があります', body: input.body.slice(0, 200), link });
      } else if (input.kind === 'consult_reply' && parent) {
        const parentRole = db.profiles.find((p) => p.id === parent!.created_by)?.role_code;
        notify(db, { recipient_id: parent.created_by, audience: parentRole === 'admin' ? 'admin' : 'dealer', kind: 'case_consult_reply', title: '本部から相談への回答があります', body: input.body.slice(0, 200), link });
      } else if (input.kind === 'tech_review') {
        notify(db, { recipient_id: null, audience: 'admin', kind: 'case_tech_review', title: '技術検討が記録されました', body: input.body.slice(0, 200), link });
        if (dealerId) notify(db, { recipient_id: dealerId, audience: 'dealer', kind: 'case_tech_review', title: '技術検討が記録されました', body: input.body.slice(0, 200), link });
      }
      return note.id;
    });
  }

  // ---------- 見積の修正依頼（20261013230000 と同じ判定） ----------
  async listQuoteChangeRequests(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'manufacturer') return [];
      return (tables(db).changeRequests ?? [])
        .filter((c) => c.quote_request_id === requestId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((c) => ({ ...c }));
    });
  }
  async requestQuoteChange(actor: SessionUser, quoteId: string, message: string) {
    return this.mutate((db) => {
      const quote = db.quotes.find((q) => q.id === quoteId);
      // 権限は状態の判定より前（見えない見積は存在も分からないようにする）
      if (!quote || quote.user_id !== actor.id) throw notFound();
      const text = message.trim();
      if (!text || text.length > 2000) throw invalid('修正したい内容を 2000 文字以内で入力してください');
      const request = db.quoteRequests.find((r) => r.id === quote.quote_request_id);
      if (!request) throw notFound();
      if (quote.status !== 'issued') throw locked('回答済み・取り消し済みの見積には修正を依頼できません');
      if (request.quote_id !== quote.id) throw locked('この見積は最新の版ではありません。最新の見積をご確認ください');
      const t = tables(db);
      t.changeRequests ??= [];
      if (t.changeRequests.some((c) => c.quote_id === quote.id && c.status === 'open')) {
        throw locked('この見積には対応中の修正依頼があります。担当からのご連絡をお待ちください');
      }
      const now = nowIso();
      const row = {
        id: randomUUID(),
        quote_request_id: request.id,
        quote_id: quote.id,
        message: text,
        status: 'open' as const,
        resolution: null,
        requested_by: actor.id,
        resolved_at: null,
        created_at: now,
        updated_at: now,
      };
      t.changeRequests.push(row);
      const link = `/admin/quotes/${quote.id}`;
      notify(db, { recipient_id: null, audience: 'admin', kind: 'quote_change_requested', title: `お客様から見積の修正依頼がありました：${quote.quote_no}`, body: text.slice(0, 200), link });
      if (quote.dealer_id) {
        notify(db, { recipient_id: quote.dealer_id, audience: 'dealer', kind: 'quote_change_requested', title: `お客様から見積の修正依頼がありました：${quote.quote_no}`, body: text.slice(0, 200), link });
      }
      return row.id;
    });
  }
  async resolveQuoteChangeRequest(actor: SessionUser, changeRequestId: string, resolution: string | null) {
    this.mutate((db) => {
      const row = (tables(db).changeRequests ?? []).find((c) => c.id === changeRequestId);
      if (!row) throw notFound();
      const access = accessOf(db, actor, row.quote_request_id);
      if (access !== 'admin' && access !== 'staff') throw forbidden('修正依頼を対応済みにできるのは本部と担当代理店だけです');
      if (row.status !== 'open') throw locked('この修正依頼はすでに対応済みです');
      if ((resolution ?? '').length > 1000) throw invalid('対応内容は 1000 文字以内で入力してください');
      row.status = 'resolved';
      row.resolution = resolution?.trim() || null;
      row.resolved_at = nowIso();
      row.updated_at = nowIso();
      const request = db.quoteRequests.find((r) => r.id === row.quote_request_id);
      if (request?.user_id) {
        notify(db, { recipient_id: request.user_id, audience: 'customer', kind: 'quote_change_resolved', title: '見積の修正依頼に対応しました', body: (row.resolution ?? '担当からのご案内をご確認ください。').slice(0, 200), link: `/mypage/cases/${row.quote_request_id}` });
      }
    });
  }

  // ---------- 書面で締結した契約（20261013230000 と同じ判定） ----------
  async recordPaperContract(actor: SessionUser, quoteId: string, input: PaperContractInput, pdf: Uint8Array) {
    return this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('書面の契約を記録できるのは本部だけです');
      const quote = db.quotes.find((q) => q.id === quoteId);
      if (!quote) throw notFound();
      const request = db.quoteRequests.find((r) => r.id === quote.quote_request_id);
      if (!request) throw notFound();
      if (!quote.user_id) throw locked('お客様アカウントのある案件だけ契約を記録できます');
      if (quote.status !== 'accepted') throw locked('お客様が承諾した見積だけ契約を記録できます');
      if (request.quote_id !== quote.id) throw locked('この見積は案件の現在の版ではありません');
      if (db.contracts.some((c) => c.quote_request_id === request.id && ['sending', 'sent', 'signed'].includes(c.status))) {
        throw locked('この案件には送信中または締結済みの契約があります');
      }
      const id = randomUUID();
      const rel = path.posix.join('contracts', 'paper', `${randomUUID()}.pdf`);
      const abs = path.join(filesDir(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, pdf);
      const now = nowIso();
      db.contracts.push({
        id,
        quote_request_id: request.id,
        quote_id: quote.id,
        user_id: quote.user_id,
        provider: 'paper',
        status: 'signed',
        signer_name: input.signer_name,
        signer_email: input.signer_email,
        contract_total: quote.total,
        envelope_xid: null,
        provider_document_id: null,
        signed_file_path: rel,
        failure_reason: null,
        sent_at: null,
        signed_at: new Date(`${input.signed_on}T00:00:00+09:00`).toISOString(),
        canceled_at: null,
        created_at: now,
        updated_at: now,
      });
      notify(db, { recipient_id: quote.user_id, audience: 'customer', kind: 'contract_signed', title: 'ご契約の記録が完了しました', body: '書面でご締結いただいた契約書は、マイページの見積詳細からご確認いただけます。', link: `/mypage/quotes/${quote.id}` });
      return id;
    });
  }
  async voidPaperContract(actor: SessionUser, contractId: string, reason: string) {
    this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('書面の契約を無効にできるのは本部だけです');
      const text = reason.trim();
      if (!text || text.length > 1000) throw invalid('無効にする理由を 1000 文字以内で入力してください');
      const contract = db.contracts.find((c) => c.id === contractId);
      if (!contract) throw notFound();
      if (contract.provider !== 'paper' || contract.status !== 'signed') throw locked('無効にできるのは、記録済みの書面の契約だけです');
      contract.status = 'canceled';
      contract.canceled_at = nowIso();
      contract.failure_reason = text;
      contract.updated_at = nowIso();
    });
  }

  // ---------- 写真・書類 ----------
  async listCaseFiles(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access) return [];
      return tables(db)
        .files.filter((f) => f.quote_request_id === requestId && (access !== 'customer' || f.customer_visible))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((f) => ({ ...f }));
    });
  }
  async uploadCaseFile(actor: SessionUser, requestId: string, input: CaseFileInput, bytes: Uint8Array) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access) throw forbidden();
      if (!canRegisterCaseFile(access, input.context)) throw forbidden('この資料を登録する権限がありません');
      if (bytes.byteLength !== input.size_bytes) throw invalid('ファイルの大きさが一致しません');
      const ext = CASE_FILE_TYPES[input.content_type];
      if (!ext) throw invalid('登録できるのは JPEG・PNG・WebP の画像と PDF だけです');
      const id = randomUUID();
      const storagePath = `cases/${requestId}/${id}.${ext}`;
      const abs = path.join(filesDir(), 'case-files', storagePath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      const file: CaseFile = {
        id,
        quote_request_id: requestId,
        context: input.context,
        context_id: input.context_id,
        storage_path: storagePath,
        file_name: input.file_name,
        content_type: input.content_type,
        size_bytes: input.size_bytes,
        caption: input.caption,
        customer_visible: access === 'customer' ? true : input.customer_visible,
        uploaded_by: actor.id,
        created_at: nowIso(),
      };
      tables(db).files.push(file);
      return { ...file };
    });
  }
  async getCaseFileContent(actor: SessionUser, fileId: string) {
    return this.read((db) => {
      const file = tables(db).files.find((f) => f.id === fileId);
      if (!file) return null;
      const access = accessOf(db, actor, file.quote_request_id);
      if (!access || (access === 'customer' && !file.customer_visible)) return null;
      const abs = path.join(filesDir(), 'case-files', file.storage_path);
      if (!fs.existsSync(abs)) return null;
      return { file: { ...file }, bytes: new Uint8Array(fs.readFileSync(abs)) };
    });
  }
  async deleteCaseFile(actor: SessionUser, fileId: string) {
    this.mutate((db) => {
      const t = tables(db);
      const file = t.files.find((f) => f.id === fileId);
      const access = file ? accessOf(db, actor, file.quote_request_id) : null;
      // 見えない資料（関係の無い案件、お客様に表示していない資料）は、存在も分からないようにする
      if (!file || !access || (access === 'customer' && !file.customer_visible)) throw notFound();
      if (file.uploaded_by !== actor.id && rank(actor) < 3) throw forbidden('削除できるのは登録した人と本部だけです');
      t.files = t.files.filter((f) => f.id !== fileId);
      const abs = path.join(filesDir(), 'case-files', file.storage_path);
      if (fs.existsSync(abs)) fs.rmSync(abs);
    });
  }
}
