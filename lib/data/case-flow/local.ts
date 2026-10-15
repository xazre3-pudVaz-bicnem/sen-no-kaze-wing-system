import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { filesDir, loadDb, saveDb, type LocalDb } from '@/lib/data/local-db';
import { ROLE_RANK, type AppNotification } from '@/lib/domain/types';
import {
  CASE_FILE_TYPES,
  GUEST_PLAN_DAYS,
  GUEST_PLAN_TOKEN,
  type GuestPlan,
  type GuestPlanInput,
  type SiteProfile,
  type SiteProfileInput,
  MANUFACTURER_PROGRESS_KINDS,
  MANUFACTURER_SCHEDULE_CATEGORIES,
  canChangeAppointmentStatus,
  canChangeOrderStatus,
  canRegisterCaseFile,
  canRegisterStock,
  canSetUnitStatus,
  type AfterServiceRequest,
  type AfterServiceRequestInput,
  type AfterServiceUpdateInput,
  type CaseHandover,
  type CasePunchItem,
  type DisasterConsent,
  type DisasterConsentInput,
  type HandoverInspectionInput,
  type StockLedgerEntry,
  type StockLedgerEntryInput,
  type CaseProgressReport,
  type CaseScheduleItem,
  type ManufacturingOrder,
  type ManufacturingOrderInput,
  type ManufacturingOrderStatus,
  type ManufacturingUnit,
  type ProgressReportInput,
  type ScheduleItemInput,
  type UnitUpdateInput,
  type CaseAccess,
  type CaseOrganizations,
  type CaseRole,
  type SupervisedCaseDetail,
  type ManufacturingCaseDetail,
  type ManufacturingCaseSummary,
  type SupervisedCaseSummary,
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
import {
  defaultManufacturingOrganization,
  isActiveOrganizationMember,
  isCaseSalesManager,
  isCaseSupervisor,
  organizationManagers,
} from '@/lib/data/organizations/local-relations';
import type { BoardAfterServiceRequest, BoardAppointment, BoardManufacturingOrder, CaseFlowStore, StockLedgerRow } from './store';

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

/** DB の case_access() と同じ（書き込みの判定。20261015130000 で組織の案件に対応） */
function accessOf(db: LocalDb, actor: SessionUser, requestId: string): CaseAccess | null {
  const request = db.quoteRequests.find((r) => r.id === requestId);
  if (!request) return null;
  if (rank(actor) >= 3) return 'admin';
  const workflow = tables(db).workflows.find((w) => w.quote_request_id === requestId);
  if (workflow?.sales_organization_id) {
    // 組織の案件：主担当者（営業担当組織の有効なメンバー）だけが担当
    if (rank(actor) >= 1 && workflow.primary_staff_id === actor.id && isActiveOrganizationMember(db, workflow.sales_organization_id, actor.id)) {
      return 'staff';
    }
  } else if (rank(actor) >= 1 && request.quote_id) {
    const quote = db.quotes.find((q) => q.id === request.quote_id);
    if (quote?.dealer_id === actor.id) return 'staff';
  }
  if (workflow?.manufacturing_organization_id) {
    if (rank(actor) >= 1 && isActiveOrganizationMember(db, workflow.manufacturing_organization_id, actor.id)) return 'manufacturer';
  } else if (rank(actor) >= 2 && workflow?.manufacturer_id === actor.id) {
    return 'manufacturer';
  }
  if (request.user_id === actor.id) return 'customer';
  return null;
}

/** DB の case_role() と同じ（読み取りの判定）：営業担当組織の管理者（manager）と直属の総代理店の管理者（supervisor）を足す */
function roleOf(db: LocalDb, actor: SessionUser, requestId: string): CaseRole | null {
  const access = accessOf(db, actor, requestId);
  if (access === 'admin' || access === 'staff') return access;
  if (isCaseSalesManager(db, requestId, actor.id)) return 'manager';
  if (access) return access;
  if (isCaseSupervisor(db, requestId, actor.id)) return 'supervisor';
  return null;
}

/**
 * これまでの案件（製造担当組織が無い）で、本部が個人として選んだ製造の担当か（DB の is_case_legacy_manufacturer と同じ）。
 * 製造担当組織のメンバーには、総代理店に見せる顧客情報の項目が決まるまで、製造・施工の記録だけを見せる
 */
function isLegacyManufacturer(db: LocalDb, actor: SessionUser, requestId: string): boolean {
  const workflow = tables(db).workflows.find((w) => w.quote_request_id === requestId);
  return !!workflow && !workflow.manufacturing_organization_id && workflow.manufacturer_id === actor.id && rank(actor) >= 2;
}

/** 一覧・詳細の読み取り：営業担当組織の管理者は担当と同じものを見られる（総代理店の配下の閲覧はここでは開かない） */
function viewAccessOf(db: LocalDb, actor: SessionUser, requestId: string): CaseAccess | null {
  const role = roleOf(db, actor, requestId);
  if (role === 'manager') return 'staff';
  if (role === 'supervisor') return null;
  return role;
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

function newUnit(order: ManufacturingOrder, seq: number): ManufacturingUnit {
  return {
    id: randomUUID(),
    order_id: order.id,
    quote_request_id: order.quote_request_id,
    seq,
    unit_no: null,
    status: 'planned',
    produced_on: null,
    inspected_on: null,
    shipped_on: null,
    installed_on: null,
    handed_over_on: null,
    note: null,
    lock_version: 1,
    updated_at: nowIso(),
  };
}

/** 主担当者を決め、案件の見積の担当（dealer_id）を主担当者にそろえる。主担当者が本部の利用者なら見積の担当は空にする（DB の apply_case_main_staff と同じ） */
function applyCaseMainStaff(db: LocalDb, requestId: string, staffId: string | null, actorId: string) {
  const workflow = workflowOf(db, requestId, actorId);
  workflow.primary_staff_id = staffId;
  workflow.primary_assigned_at = staffId ? nowIso() : null;
  workflow.updated_at = nowIso();
  const staffRank = staffId ? ROLE_RANK[db.profiles.find((p) => p.id === staffId)?.role_code ?? 'customer'] ?? 0 : 0;
  const dealerId = staffId && staffRank >= 1 && staffRank <= 2 ? staffId : null;
  for (const quote of db.quotes.filter((q) => q.quote_request_id === requestId)) quote.dealer_id = dealerId;
}

function notifyOrganizationManagers(db: LocalDb, organizationId: string, n: { kind: string; title: string; body: string; link: string }) {
  for (const managerId of organizationManagers(db, organizationId)) {
    notify(db, { recipient_id: managerId, audience: 'dealer', ...n });
  }
}

/** お客様にも見せる進み具合（DB の get_case_progress と同じ。判定は呼び出し側で行う） */
function progressOf(db: LocalDb, requestId: string): CaseProgress {
  const t = tables(db);
  const workflow = t.workflows.find((w) => w.quote_request_id === requestId);
  const survey = t.siteSurveys.find((s) => s.quote_request_id === requestId);
  const primary = workflow?.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id) : null;
  const order = (t.orders ?? []).find((o) => o.quote_request_id === requestId && o.status !== 'canceled');
  const units = order ? (t.units ?? []).filter((u) => u.order_id === order.id) : [];
  return {
    acknowledged_at: workflow?.acknowledged_at ?? null,
    primary_staff_name: primary?.full_name ?? null,
    site_survey_status: survey?.status ?? 'none',
    site_survey_completed_at: survey?.completed_at ?? null,
    // 製造：状態と棟数・出荷済み・設置済みの数だけ（DB の get_case_progress と同じ）
    manufacturing_status: !order || order.status === 'draft' ? 'none' : (order.status as Exclude<ManufacturingOrderStatus, 'draft' | 'canceled'>),
    unit_count: order?.unit_count ?? null,
    units_shipped: units.filter((u) => ['shipped', 'installed', 'handed_over'].includes(u.status)).length,
    units_installed: units.filter((u) => ['installed', 'handed_over'].includes(u.status)).length,
    // 契約は締結済みかどうかだけ（契約の中身は本部とお客様だけ）。DB の get_case_progress と同じ
    contract_signed: db.contracts.some((c) => c.quote_request_id === requestId && c.status === 'signed'),
    handover_status: (t.handovers ?? []).find((h) => h.quote_request_id === requestId)?.status ?? 'none',
  };
}

function caseDealerId(db: LocalDb, requestId: string): string | null {
  const request = db.quoteRequests.find((r) => r.id === requestId);
  const quote = request?.quote_id ? db.quotes.find((q) => q.id === request.quote_id) : null;
  return quote?.dealer_id ?? null;
}

/** 案件の見出し（見積番号とお客様名）。見積が無ければ製造仕様の見積番号 */
function caseLabelOf(db: LocalDb, requestId: string): { label: string; quote_id: string | null } {
  const quote = db.quotes.filter((q) => q.quote_request_id === requestId).sort((x, y) => (y.revision ?? 0) - (x.revision ?? 0))[0];
  if (quote) return { label: `${quote.quote_no} ${quote.customer_name} 様`, quote_id: quote.id };
  const order = (tables(db).orders ?? []).find((o) => o.quote_request_id === requestId && o.status !== 'canceled');
  return { label: order?.spec_snapshot?.quote_no ?? '案件', quote_id: null };
}

const todayInJapan = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());

function customerOf(db: LocalDb, requestId: string): string | null {
  return db.quoteRequests.find((r) => r.id === requestId)?.user_id ?? null;
}

function hasOpenPunchItems(db: LocalDb, requestId: string): boolean {
  return (tables(db).punchItems ?? []).some((p) => p.quote_request_id === requestId && p.status !== 'verified');
}

function isHandedOver(db: LocalDb, requestId: string): boolean {
  return (tables(db).handovers ?? []).some((h) => h.quote_request_id === requestId && h.status === 'handed_over');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** 資料を読めるか（DB の case_files_read と同じ）。お客様は表示している資料だけ、製造担当組織は施工・製造の写真だけ */
function canReadCaseFile(db: LocalDb, actor: SessionUser, access: CaseAccess, file: CaseFile): boolean {
  if (access === 'customer') return file.customer_visible;
  if (access === 'manufacturer') return file.context === 'progress' || isLegacyManufacturer(db, actor, file.quote_request_id);
  return true;
}

/** プランの土地の情報への関わり方（DB の configuration_site_profile_access と同じ） */
function siteProfileAccessOf(db: LocalDb, actor: SessionUser, configurationId: string): 'owner' | 'admin' | 'staff' | null {
  const configuration = db.configurations.find((c) => c.id === configurationId);
  if (!configuration) return null;
  if (configuration.user_id === actor.id) return 'owner';
  if (rank(actor) >= 3) return 'admin';
  const related = db.quoteRequests.some(
    (r) =>
      r.configuration_id === configurationId &&
      (accessOf(db, actor, r.id) === 'staff' || isLegacyManufacturer(db, actor, r.id) || isCaseSalesManager(db, r.id, actor.id))
  );
  return related ? 'staff' : null;
}

/** お客様の意思の履歴（新しい順。先頭が今の意思）。行は足すだけなので、後に足した行ほど新しい */
function consentsOf(db: LocalDb, requestId: string): DisasterConsent[] {
  return (tables(db).consents ?? []).filter((c) => c.quote_request_id === requestId).reverse();
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
      const access = viewAccessOf(db, actor, requestId);
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
      // お客様が選んだ代理店（組織）。有効な代理店・総代理店で、管理者がいる組織だけ選べる（DB と同じ）
      const preferredOrg = input.preferred_organization_id
        ? db.organizations?.organizations.find((o) => o.id === input.preferred_organization_id)
        : null;
      if (
        input.preferred_organization_id &&
        (!preferredOrg ||
          preferredOrg.status !== 'active' ||
          preferredOrg.organization_type === 'headquarters' ||
          organizationManagers(db, preferredOrg.id).length === 0)
      ) {
        throw invalid('指定した代理店は選べません');
      }
      const current = t.preferences.find((p) => p.quote_request_id === requestId);
      const before = current?.preferred_dealer_id ?? null;
      const next: QuoteRequestPreferences = {
        quote_request_id: requestId,
        ...input,
        preferred_organization_id: input.preferred_organization_id ?? null,
        updated_at: nowIso(),
      };
      if (current) Object.assign(current, next);
      else t.preferences.push(next);
      // 営業担当組織が未定なら、お客様が選んだ代理店を営業担当にする（いったん決まった後は、本部だけが変える）
      if (preferredOrg) {
        const workflow = workflowOf(db, requestId, actor.id);
        if (!workflow.sales_organization_id) {
          workflow.sales_organization_id = preferredOrg.id;
          workflow.sales_assigned_at = nowIso();
          if (workflow.manufacturing_auto !== false || !workflow.manufacturing_organization_id) {
            workflow.manufacturing_organization_id = defaultManufacturingOrganization(db, preferredOrg.id);
            workflow.manufacturing_auto = true;
            workflow.manufacturing_assigned_at = nowIso();
          }
          workflow.updated_at = nowIso();
          applyCaseMainStaff(db, requestId, null, actor.id);
          notifyOrganizationManagers(db, preferredOrg.id, {
            kind: 'case_sales_assigned',
            title: 'お客様から見積のご依頼が届きました',
            body: 'お客様があなたの組織を選びました。案件の内容を確認し、主担当者を決めてください。',
            link: `/admin/quotes?request=${requestId}`,
          });
          notify(db, {
            recipient_id: null,
            audience: 'admin',
            kind: 'case_sales_assigned',
            title: 'お客様が代理店を選びました',
            body: '選ばれた代理店を営業担当にしました。必要なら案件の「受付・担当」で変えられます。',
            link: `/admin/quotes?request=${requestId}`,
          });
        }
      }
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
      const access = viewAccessOf(db, actor, requestId);
      if (!access || access === 'customer') return null;
      const row = tables(db).workflows.find((w) => w.quote_request_id === requestId);
      return row ? { ...row } : null;
    });
  }
  async acknowledgeCase(actor: SessionUser, requestId: string) {
    this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff' && !isCaseSalesManager(db, requestId, actor.id)) {
        throw forbidden('受付できるのは本部と担当（営業担当組織の管理者を含む）だけです');
      }
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
      const orgWorkflow = tables(db).workflows.find((w) => w.quote_request_id === requestId);
      if (orgWorkflow?.sales_organization_id) {
        // 組織の案件：主担当者を決めるのは本部と、営業担当組織の管理者（DB の assign_case_primary_staff と同じ）
        if (rank(actor) < 3 && !isCaseSalesManager(db, requestId, actor.id)) {
          throw forbidden('主担当者を決められるのは、本部と営業担当組織の管理者だけです');
        }
        const salesOrg = db.organizations?.organizations.find((o) => o.id === orgWorkflow.sales_organization_id);
        let staffRole: string | undefined;
        if (staffId) {
          staffRole = db.profiles.find((p) => p.id === staffId)?.role_code;
          const allowed =
            isActiveOrganizationMember(db, orgWorkflow.sales_organization_id, staffId) ||
            (salesOrg?.organization_type === 'headquarters' && staffRole === 'admin');
          if (!staffRole || !allowed) throw invalid('主担当者は、営業担当組織のメンバーから選んでください');
        }
        applyCaseMainStaff(db, requestId, staffId, actor.id);
        if (staffId && staffId !== actor.id) {
          notify(db, {
            recipient_id: staffId,
            audience: staffRole === 'admin' ? 'admin' : 'dealer',
            kind: 'case_primary_assigned',
            title: '案件の主担当者になりました',
            body: 'お客様への連絡と日程の調整をお願いします。',
            link: `/admin/quotes?request=${requestId}`,
          });
        }
        return;
      }
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
      if (tables(db).workflows.some((w) => w.quote_request_id === requestId && w.sales_organization_id)) {
        throw invalid('営業担当組織が決まっている案件の製造担当は、総代理店の組織から選んでください');
      }
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
  // ---------- 営業担当組織・製造担当組織（20261015130000） ----------
  async getCaseRole(actor: SessionUser, requestId: string): Promise<CaseRole | null> {
    return this.read((db) => roleOf(db, actor, requestId));
  }
  async getCaseOrganizations(actor: SessionUser, requestId: string): Promise<CaseOrganizations | null> {
    return this.read((db) => {
      const role = roleOf(db, actor, requestId);
      if (!role || role === 'customer') return null;
      const workflow = tables(db).workflows.find((w) => w.quote_request_id === requestId);
      const orgs = db.organizations?.organizations ?? [];
      const sales = workflow?.sales_organization_id ? orgs.find((o) => o.id === workflow.sales_organization_id) : undefined;
      const manufacturing = workflow?.manufacturing_organization_id ? orgs.find((o) => o.id === workflow.manufacturing_organization_id) : undefined;
      const primary = workflow?.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id) : undefined;
      const canAssign = role === 'admin' || (Boolean(sales) && isCaseSalesManager(db, requestId, actor.id));
      const candidates =
        canAssign && sales
          ? (db.organizations?.memberships ?? [])
              .filter((m) => m.organization_id === sales.id && m.status === 'active')
              .map((m) => ({
                id: m.profile_id,
                full_name: db.profiles.find((p) => p.id === m.profile_id)?.full_name ?? '',
                member_role: m.member_role,
              }))
              .sort(
                (a, b) =>
                  Number(!['owner', 'admin'].includes(a.member_role)) - Number(!['owner', 'admin'].includes(b.member_role)) ||
                  a.full_name.localeCompare(b.full_name, 'ja')
              )
          : [];
      return {
        sales_organization: sales ? { id: sales.id, name: sales.name, organization_type: sales.organization_type } : null,
        manufacturing_organization: manufacturing ? { id: manufacturing.id, name: manufacturing.name } : null,
        manufacturing_auto: workflow?.manufacturing_auto ?? true,
        primary_staff: primary ? { id: primary.id, full_name: primary.full_name } : null,
        viewer_role: role,
        can_assign: canAssign,
        candidates,
      };
    });
  }
  async setCaseSalesOrganization(actor: SessionUser, requestId: string, organizationId: string | null) {
    this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('営業担当組織を決められるのは本部だけです');
      if (!db.quoteRequests.some((r) => r.id === requestId)) throw notFound();
      const org = organizationId ? db.organizations?.organizations.find((o) => o.id === organizationId) : null;
      if (organizationId && (!org || org.status !== 'active')) {
        throw invalid('営業担当組織は、有効な本部・総代理店・代理店から選んでください');
      }
      const workflow = workflowOf(db, requestId, actor.id);
      if ((workflow.sales_organization_id ?? null) === organizationId) return;
      const before = workflow.manufacturing_organization_id ?? null;
      const auto = workflow.manufacturing_auto !== false || !workflow.manufacturing_organization_id;
      workflow.sales_organization_id = organizationId;
      workflow.sales_assigned_at = organizationId ? nowIso() : null;
      if (auto) {
        workflow.manufacturing_organization_id = defaultManufacturingOrganization(db, organizationId);
        workflow.manufacturing_auto = true;
        if (workflow.manufacturing_organization_id !== before) workflow.manufacturing_assigned_at = nowIso();
      }
      workflow.updated_at = nowIso();
      // 主担当者は、新しい営業担当組織のメンバー（本部なら本部の利用者）のときだけ残す
      const staffId = workflow.primary_staff_id;
      const keep =
        Boolean(staffId && org) &&
        (isActiveOrganizationMember(db, org!.id, staffId!) ||
          (org!.organization_type === 'headquarters' && db.profiles.find((p) => p.id === staffId)?.role_code === 'admin'));
      applyCaseMainStaff(db, requestId, keep ? staffId : null, actor.id);
      if (org && org.organization_type !== 'headquarters') {
        notifyOrganizationManagers(db, org.id, {
          kind: 'case_sales_assigned',
          title: '新しい案件が届きました',
          body: '案件の内容を確認し、主担当者を決めてください。',
          link: `/admin/quotes?request=${requestId}`,
        });
      }
      if (workflow.manufacturing_organization_id && workflow.manufacturing_organization_id !== before) {
        notifyOrganizationManagers(db, workflow.manufacturing_organization_id, {
          kind: 'case_manufacturer_assigned',
          title: '製造担当の案件になりました',
          body: '案件の仕様と現地確認の内容を確認してください。',
          link: `/admin/manufacturing?request=${requestId}`,
        });
      }
    });
  }
  async setCaseManufacturingOrganization(actor: SessionUser, requestId: string, organizationId: string | null) {
    this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('製造担当を変えられるのは本部だけです');
      if (!db.quoteRequests.some((r) => r.id === requestId)) throw notFound();
      const org = organizationId ? db.organizations?.organizations.find((o) => o.id === organizationId) : null;
      if (organizationId && (!org || org.organization_type !== 'master_dealer' || org.status !== 'active')) {
        throw invalid('製造担当は、有効な総代理店から選んでください');
      }
      const workflow = workflowOf(db, requestId, actor.id);
      const next = organizationId ?? defaultManufacturingOrganization(db, workflow.sales_organization_id);
      const before = workflow.manufacturing_organization_id ?? null;
      if (
        next !== before &&
        (tables(db).orders ?? []).some((o) => o.quote_request_id === requestId && o.status !== 'draft' && o.status !== 'canceled')
      ) {
        throw invalid('製造依頼を送った後は製造担当を変えられません（製造依頼を取り消してから変えてください）');
      }
      workflow.manufacturing_organization_id = next;
      workflow.manufacturing_auto = organizationId === null;
      if (next !== before) workflow.manufacturing_assigned_at = nowIso();
      workflow.updated_at = nowIso();
      if (next && next !== before) {
        notifyOrganizationManagers(db, next, {
          kind: 'case_manufacturer_assigned',
          title: '製造担当の案件になりました',
          body: '案件の仕様と現地確認の内容を確認してください。',
          link: `/admin/manufacturing?request=${requestId}`,
        });
      }
    });
  }

  // ---------- 総代理店の配下の確認（DB の list_supervised_cases／get_supervised_case と同じ。顧客情報を含まない） ----------
  private supervisedRequestIds(db: LocalDb, actor: SessionUser): string[] {
    const orgs = db.organizations?.organizations ?? [];
    return tables(db)
      .workflows.filter((w) => {
        const sales = w.sales_organization_id ? orgs.find((o) => o.id === w.sales_organization_id) : undefined;
        if (!sales || sales.organization_type !== 'dealer' || !sales.parent_organization_id) return false;
        return rank(actor) >= 3 || isCaseSupervisor(db, w.quote_request_id, actor.id);
      })
      .map((w) => w.quote_request_id);
  }
  private supervisedQuote(db: LocalDb, requestId: string) {
    const request = db.quoteRequests.find((r) => r.id === requestId);
    return request?.quote_id ? db.quotes.find((q) => q.id === request.quote_id) ?? null : null;
  }
  async listSupervisedCases(actor: SessionUser): Promise<SupervisedCaseSummary[]> {
    return this.read((db) => {
      const orgs = db.organizations?.organizations ?? [];
      const orgRef = (id: string | null | undefined) => {
        const org = id ? orgs.find((o) => o.id === id) : undefined;
        return org ? { id: org.id, name: org.name } : null;
      };
      return this.supervisedRequestIds(db, actor)
        .map((requestId): SupervisedCaseSummary => {
          const workflow = tables(db).workflows.find((w) => w.quote_request_id === requestId)!;
          const sales = orgs.find((o) => o.id === workflow.sales_organization_id)!;
          const quote = this.supervisedQuote(db, requestId);
          const request = db.quoteRequests.find((r) => r.id === requestId);
          return {
            request_id: requestId,
            sales_organization: { id: sales.id, name: sales.name },
            supervisor_organization: orgRef(sales.parent_organization_id)!,
            manufacturing_organization: orgRef(workflow.manufacturing_organization_id),
            primary_staff_name: workflow.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id)?.full_name ?? null : null,
            quote: quote
              ? {
                  id: quote.id,
                  quote_no: quote.quote_no,
                  revision: quote.revision ?? 1,
                  status: quote.status,
                  base_model_name: quote.base_model_name,
                  spec_code: quote.spec_code ?? null,
                  finish_level: quote.finish_level ?? null,
                  total: quote.total,
                  issued_at: quote.issued_at ?? null,
                }
              : null,
            progress: progressOf(db, requestId),
            activity_at: [workflow.updated_at, request?.updated_at ?? ''].sort().at(-1) ?? workflow.updated_at,
          };
        })
        .sort((a, b) => b.activity_at.localeCompare(a.activity_at));
    });
  }
  async getSupervisedCase(actor: SessionUser, requestId: string): Promise<SupervisedCaseDetail | null> {
    return this.read((db) => {
      if (rank(actor) < 3 && !isCaseSupervisor(db, requestId, actor.id)) return null;
      if (!db.quoteRequests.some((r) => r.id === requestId)) return null;
      const t = tables(db);
      const orgs = db.organizations?.organizations ?? [];
      const orgRef = (id: string | null | undefined) => {
        const org = id ? orgs.find((o) => o.id === id) : undefined;
        return org ? { id: org.id, name: org.name } : null;
      };
      const workflow = t.workflows.find((w) => w.quote_request_id === requestId);
      const quote = this.supervisedQuote(db, requestId);
      const order = (t.orders ?? [])
        .filter((o) => o.quote_request_id === requestId && o.status !== 'canceled')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return {
        request_id: requestId,
        sales_organization: orgRef(workflow?.sales_organization_id),
        manufacturing_organization: orgRef(workflow?.manufacturing_organization_id),
        primary_staff_name: workflow?.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id)?.full_name ?? null : null,
        // 見積はお客様の氏名・会社名・備考を除いた金額だけ
        quote: quote
          ? {
              id: quote.id,
              quote_no: quote.quote_no,
              revision: quote.revision ?? 1,
              status: quote.status,
              issued_at: quote.issued_at ?? null,
              valid_until: quote.valid_until ?? null,
              base_model_name: quote.base_model_name,
              spec_code: quote.spec_code ?? null,
              finish_level: quote.finish_level ?? null,
              base_price: quote.base_price,
              base_expense: quote.base_expense ?? 0,
              option_subtotal: quote.option_subtotal,
              option_expense: quote.option_expense ?? 0,
              installation_subtotal: quote.installation_subtotal,
              adjustment: quote.adjustment ?? 0,
              subtotal: quote.subtotal,
              tax_rate: quote.tax_rate,
              tax: quote.tax,
              total: quote.total,
            }
          : null,
        items: quote
          ? db.quoteItems
              .filter((i) => i.quote_id === quote.id)
              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((i) => ({
                kind: i.kind,
                name: i.name,
                description: i.description ?? null,
                quantity: i.quantity,
                unit: i.unit ?? null,
                unit_price: i.unit_price,
                amount: i.amount,
                remark: i.remark ?? null,
              }))
          : [],
        progress: progressOf(db, requestId),
        manufacturing_order: order
          ? {
              status: order.status,
              unit_count: order.unit_count,
              requested_delivery_on: order.requested_delivery_on ?? null,
              order_no: order.order_no ?? null,
              sent_at: order.sent_at ?? null,
              received_at: order.received_at ?? null,
              completed_at: order.completed_at ?? null,
              spec_snapshot: (order.spec_snapshot as Record<string, unknown> | null) ?? null,
            }
          : null,
        units: (t.units ?? [])
          .filter((u) => u.quote_request_id === requestId)
          .sort((a, b) => a.seq - b.seq)
          .map((u) => ({
            seq: u.seq,
            unit_no: u.unit_no ?? null,
            status: u.status,
            produced_on: u.produced_on ?? null,
            inspected_on: u.inspected_on ?? null,
            shipped_on: u.shipped_on ?? null,
            installed_on: u.installed_on ?? null,
            handed_over_on: u.handed_over_on ?? null,
            note: u.note ?? null,
          })),
        schedule: (t.scheduleItems ?? [])
          .filter((s) => s.quote_request_id === requestId)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((s) => ({
            category: s.category,
            title: s.title,
            planned_start: s.planned_start ?? null,
            planned_end: s.planned_end ?? null,
            actual_start: s.actual_start ?? null,
            actual_end: s.actual_end ?? null,
            status: s.status,
            note: s.note ?? null,
          })),
        progress_reports: (t.progressReports ?? [])
          .filter((r) => r.quote_request_id === requestId)
          .sort((a, b) => (b.reported_on ?? '').localeCompare(a.reported_on ?? ''))
          .map((r) => ({ kind: r.kind, title: r.title ?? null, body: r.body ?? null, reported_on: r.reported_on ?? null, author_name: r.author_name ?? null })),
        handover_status: (t.handovers ?? []).find((h) => h.quote_request_id === requestId)?.status ?? 'none',
      };
    });
  }

  // ---------- 製造担当の案件（DB の list_manufacturing_cases／get_manufacturing_case と同じ。お客様の情報・見積の金額を含まない） ----------
  private manufacturingCaseRow(db: LocalDb, requestId: string): ManufacturingCaseSummary | null {
    const request = db.quoteRequests.find((r) => r.id === requestId);
    const t = tables(db);
    const workflow = t.workflows.find((w) => w.quote_request_id === requestId);
    if (!request || !workflow) return null;
    const orgs = db.organizations?.organizations ?? [];
    const orgRef = (id: string | null | undefined) => {
      const org = id ? orgs.find((o) => o.id === id) : undefined;
      return org ? { id: org.id, name: org.name } : null;
    };
    const quote = request.quote_id ? db.quotes.find((q) => q.id === request.quote_id) : undefined;
    const order = (t.orders ?? [])
      .filter((o) => o.quote_request_id === requestId && o.status !== 'canceled')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const units = order ? (t.units ?? []).filter((u) => u.order_id === order.id) : [];
    const orderUpdated = (t.orders ?? []).filter((o) => o.quote_request_id === requestId).map((o) => o.updated_at);
    return {
      request_id: requestId,
      quote: quote
        ? {
            quote_no: quote.quote_no,
            revision: quote.revision ?? 1,
            status: quote.status,
            base_model_name: quote.base_model_name,
            spec_code: quote.spec_code ?? null,
            finish_level: quote.finish_level ?? null,
          }
        : null,
      sales_organization: orgRef(workflow.sales_organization_id),
      manufacturing_organization: orgRef(workflow.manufacturing_organization_id),
      primary_staff_name: workflow.primary_staff_id ? db.profiles.find((p) => p.id === workflow.primary_staff_id)?.full_name ?? null : null,
      contract_signed: db.contracts.some((c) => c.quote_request_id === requestId && c.status === 'signed'),
      order: order
        ? {
            status: order.status,
            unit_count: order.unit_count,
            requested_delivery_on: order.requested_delivery_on ?? null,
            sent_at: order.sent_at ?? null,
            received_at: order.received_at ?? null,
            completed_at: order.completed_at ?? null,
            units_shipped: units.filter((u) => ['shipped', 'installed', 'handed_over'].includes(u.status)).length,
            units_installed: units.filter((u) => ['installed', 'handed_over'].includes(u.status)).length,
          }
        : null,
      activity_at: [workflow.updated_at, request.updated_at ?? '', ...orderUpdated].sort().at(-1) ?? workflow.updated_at,
    };
  }
  async listManufacturingCases(actor: SessionUser): Promise<ManufacturingCaseSummary[]> {
    return this.read((db) =>
      tables(db)
        .workflows.filter((w) =>
          rank(actor) >= 3 ? Boolean(w.manufacturing_organization_id || w.manufacturer_id) : accessOf(db, actor, w.quote_request_id) === 'manufacturer'
        )
        .map((w) => this.manufacturingCaseRow(db, w.quote_request_id))
        .filter((row): row is ManufacturingCaseSummary => row !== null)
        .sort((a, b) => b.activity_at.localeCompare(a.activity_at))
    );
  }
  async getManufacturingCase(actor: SessionUser, requestId: string): Promise<ManufacturingCaseDetail | null> {
    return this.read((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'manufacturer') return null;
      const row = this.manufacturingCaseRow(db, requestId);
      if (!row) return null;
      const request = db.quoteRequests.find((r) => r.id === requestId);
      const items = request?.quote_id
        ? db.quoteItems
            .filter((i) => i.quote_id === request.quote_id)
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((i) => ({ kind: i.kind, name: i.name, quantity: i.quantity, unit: i.unit ?? null }))
        : [];
      return { ...row, spec_items: items };
    });
  }

  async getCaseProgress(actor: SessionUser, requestId: string): Promise<CaseProgress | null> {
    return this.read((db) => {
      // DB の get_case_progress と同じく、読み取りの判定（直属の総代理店の管理者を含む）で返す
      if (!roleOf(db, actor, requestId)) return null;
      return progressOf(db, requestId);
    });
  }

  // ---------- 日程 ----------
  async listCaseAppointments(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
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
        .appointments.filter((a) => (a.status === 'proposed' || a.status === 'confirmed') && ['admin', 'staff'].includes(viewAccessOf(db, actor, a.quote_request_id) ?? ''))
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
      const access = viewAccessOf(db, actor, requestId);
      if (!access || access === 'customer') return null;
      // 製造担当組織には、顧客情報の項目が決まるまで見せない（DB の site_surveys_read と同じ）
      if (access === 'manufacturer' && !isLegacyManufacturer(db, actor, requestId)) return null;
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
      const access = viewAccessOf(db, actor, requestId);
      if (!access || access === 'customer') return [];
      // 製造担当組織は自分たちの技術検討だけ（DB の case_notes_read と同じ）
      const techReviewOnly = access === 'manufacturer' && !isLegacyManufacturer(db, actor, requestId);
      return tables(db)
        .notes.filter((n) => n.quote_request_id === requestId && (!techReviewOnly || n.kind === 'tech_review'))
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
      const access = viewAccessOf(db, actor, requestId);
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

  // ---------- 製造依頼と個体（20261013234000 と同じ判定） ----------
  private orderOf(db: LocalDb, orderId: string) {
    const order = (tables(db).orders ?? []).find((o) => o.id === orderId);
    if (!order) throw notFound();
    return order;
  }
  async getManufacturingOrder(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      if (!access || access === 'customer') return null;
      const order = (tables(db).orders ?? []).find((o) => o.quote_request_id === requestId && o.status !== 'canceled');
      return order ? { ...order } : null;
    });
  }
  async listManufacturingUnits(actor: SessionUser, orderId: string) {
    return this.read((db) => {
      const order = (tables(db).orders ?? []).find((o) => o.id === orderId);
      if (!order) return [];
      const access = viewAccessOf(db, actor, order.quote_request_id);
      if (!access || access === 'customer') return [];
      return (tables(db).units ?? []).filter((u) => u.order_id === orderId).sort((a, b) => a.seq - b.seq).map((u) => ({ ...u }));
    });
  }
  async listManufacturingBoard(actor: SessionUser): Promise<BoardManufacturingOrder[]> {
    return this.read((db) => {
      const t = tables(db);
      return (t.orders ?? [])
        .filter((o) => o.status !== 'canceled' && ['admin', 'staff', 'manufacturer'].includes(viewAccessOf(db, actor, o.quote_request_id) ?? ''))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((o) => {
          const units = (t.units ?? []).filter((u) => u.order_id === o.id);
          // 製造担当は見積（お客様の名前を含む）を読めない（DB の RLS と同じ）。製造仕様の見積番号を見出しにする
          const canReadQuote = viewAccessOf(db, actor, o.quote_request_id) !== 'manufacturer';
          const quote = canReadQuote
            ? db.quotes.filter((q) => q.quote_request_id === o.quote_request_id).sort((x, y) => (y.revision ?? 0) - (x.revision ?? 0))[0]
            : undefined;
          return {
            ...o,
            case_label: quote ? `${quote.quote_no} ${quote.customer_name} 様` : (o.spec_snapshot?.quote_no ?? '案件'),
            case_quote_id: quote?.id ?? null,
            units_total: units.length,
            units_shipped: units.filter((u) => ['shipped', 'installed', 'handed_over'].includes(u.status)).length,
            units_installed: units.filter((u) => ['installed', 'handed_over'].includes(u.status)).length,
          };
        });
    });
  }
  async createManufacturingOrder(actor: SessionUser, requestId: string, input: ManufacturingOrderInput) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('製造依頼を作れるのは本部と担当代理店だけです');
      const contract = db.contracts
        .filter((c) => c.quote_request_id === requestId && c.status === 'signed')
        .sort((a, b) => (b.signed_at ?? '').localeCompare(a.signed_at ?? ''))[0];
      if (!contract) throw locked('契約が締結されてから製造依頼を作れます');
      const t = tables(db);
      t.orders ??= [];
      t.units ??= [];
      if (t.orders.some((o) => o.quote_request_id === requestId && o.status !== 'canceled')) throw locked('この案件には製造依頼があります');
      const now = nowIso();
      const order: ManufacturingOrder = {
        id: randomUUID(),
        quote_request_id: requestId,
        contract_id: contract.id,
        quote_id: contract.quote_id,
        manufacturer_id: null,
        status: 'draft',
        unit_count: input.unit_count,
        requested_delivery_on: input.requested_delivery_on,
        spec_note: input.spec_note,
        spec_snapshot: null,
        supply_note: null,
        order_no: null,
        sent_at: null,
        received_at: null,
        completed_at: null,
        canceled_at: null,
        cancel_reason: null,
        lock_version: 1,
        created_at: now,
        updated_at: now,
      };
      t.orders.push(order);
      for (let seq = 1; seq <= input.unit_count; seq++) t.units.push(newUnit(order, seq));
      return order.id;
    });
  }
  async updateManufacturingOrder(actor: SessionUser, orderId: string, input: ManufacturingOrderInput, expectedLockVersion: number) {
    return this.mutate((db) => {
      const order = this.orderOf(db, orderId);
      const access = accessOf(db, actor, order.quote_request_id);
      if (access !== 'admin' && access !== 'staff') throw forbidden('製造依頼を変更できるのは本部と担当代理店だけです');
      if (order.lock_version !== expectedLockVersion) throw locked('他の画面で製造依頼が更新されています。再読み込みしてください');
      if (order.status === 'canceled') throw locked('取り消した製造依頼は変更できません');
      const t = tables(db);
      if (order.status === 'draft') {
        if (input.unit_count !== order.unit_count) {
          t.units = (t.units ?? []).filter((u) => u.order_id !== order.id);
          for (let seq = 1; seq <= input.unit_count; seq++) t.units.push(newUnit(order, seq));
        }
        order.unit_count = input.unit_count;
        order.requested_delivery_on = input.requested_delivery_on;
        order.spec_note = input.spec_note;
        if (access === 'admin') order.supply_note = input.supply_note;
      } else {
        if (access !== 'admin') throw locked('送った製造依頼は変更できません（本部の供給手配のメモだけ変更できます）');
        order.supply_note = input.supply_note;
      }
      order.lock_version += 1;
      order.updated_at = nowIso();
      return order.lock_version;
    });
  }
  async sendManufacturingOrder(actor: SessionUser, orderId: string, expectedLockVersion: number) {
    return this.mutate((db) => {
      const order = this.orderOf(db, orderId);
      const access = accessOf(db, actor, order.quote_request_id);
      if (access !== 'admin' && access !== 'staff') throw forbidden('製造依頼を送れるのは本部と担当代理店だけです');
      if (order.lock_version !== expectedLockVersion) throw locked('他の画面で製造依頼が更新されています。再読み込みしてください');
      if (order.status !== 'draft') throw locked('この製造依頼はすでに送っています');
      const sendWorkflow = tables(db).workflows.find((w) => w.quote_request_id === order.quote_request_id);
      const manufacturer = sendWorkflow?.manufacturer_id ?? null;
      const manufacturingOrg = sendWorkflow?.manufacturing_organization_id ?? null;
      if (!manufacturer && !manufacturingOrg) throw locked('先に製造の担当（総代理店）を決めてください');
      const quote = db.quotes.find((q) => q.id === order.quote_id);
      order.spec_snapshot = {
        quote_no: quote?.quote_no ?? '',
        revision: quote?.revision ?? null,
        base_model_name: quote?.base_model_name ?? '',
        spec_code: quote?.spec_code ?? null,
        finish_level: quote?.finish_level ?? null,
        // 品名・数量だけ。価格は写さない
        items: db.quoteItems
          .filter((i) => i.quote_id === order.quote_id)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((i) => ({ kind: i.kind, name: i.name, quantity: i.quantity, unit: (i as { unit?: string | null }).unit ?? null })),
      };
      order.status = 'sent';
      // 組織の案件は製造担当組織あて、これまでの案件は総代理店の利用者あて（DB の send_manufacturing_order と同じ）
      order.manufacturer_id = manufacturingOrg ? null : manufacturer;
      order.manufacturing_organization_id = manufacturingOrg;
      order.sent_at = nowIso();
      order.lock_version += 1;
      order.updated_at = nowIso();
      if (manufacturingOrg) {
        notifyOrganizationManagers(db, manufacturingOrg, { kind: 'manufacturing_order_sent', title: '製造依頼が届きました', body: '製造仕様・棟数・希望納期を確認し、受領してください。', link: '/admin/manufacturing' });
      } else {
        notify(db, { recipient_id: manufacturer, audience: 'dealer', kind: 'manufacturing_order_sent', title: '製造依頼が届きました', body: '製造仕様・棟数・希望納期を確認し、受領してください。', link: '/admin/manufacturing' });
      }
      notify(db, { recipient_id: null, audience: 'admin', kind: 'manufacturing_order_sent', title: '製造依頼を総代理店へ送りました', body: '案件の「製造・施工」タブで状況を確認できます。', link: '/admin/manufacturing' });
      return order.lock_version;
    });
  }
  async setManufacturingOrderStatus(actor: SessionUser, orderId: string, status: ManufacturingOrderStatus, expectedLockVersion: number, reason: string | null) {
    return this.mutate((db) => {
      const order = this.orderOf(db, orderId);
      const access = accessOf(db, actor, order.quote_request_id);
      const allowedRole =
        access !== null &&
        (status === 'received' || status === 'in_production' || status === 'shipped'
          ? access === 'admin' || access === 'manufacturer'
          : status === 'completed'
            ? access === 'admin' || access === 'staff'
            : status === 'canceled'
              ? access === 'admin'
              : false);
      if (!allowedRole) throw forbidden('この製造依頼をその状態にする権限がありません');
      if (order.lock_version !== expectedLockVersion) throw locked('他の画面で製造依頼が更新されています。再読み込みしてください');
      if (!canChangeOrderStatus(access as CaseAccess, order.status, status)) throw locked('この製造依頼はその状態に変更できません');
      if (status === 'canceled' && !reason?.trim()) throw invalid('取り消す理由を入力してください');
      order.status = status;
      if (status === 'received') order.received_at = nowIso();
      if (status === 'completed') order.completed_at = nowIso();
      if (status === 'canceled') {
        order.canceled_at = nowIso();
        order.cancel_reason = (reason ?? '').trim().slice(0, 1000);
      }
      order.lock_version += 1;
      order.updated_at = nowIso();
      if (status === 'received' || status === 'shipped') {
        const title = status === 'received' ? '総代理店が製造依頼を受領しました' : '製造した個体を出荷しました';
        notify(db, { recipient_id: null, audience: 'admin', kind: `manufacturing_order_${status}`, title, body: '案件の「製造・施工」タブで状況を確認できます。', link: '/admin/manufacturing' });
        const dealerId = caseDealerId(db, order.quote_request_id);
        if (dealerId) notify(db, { recipient_id: dealerId, audience: 'dealer', kind: `manufacturing_order_${status}`, title, body: '案件の「製造・施工」タブで状況を確認できます。', link: '/admin/manufacturing' });
      }
      return order.lock_version;
    });
  }
  async updateManufacturingUnit(actor: SessionUser, unitId: string, input: UnitUpdateInput, expectedLockVersion: number) {
    return this.mutate((db) => {
      const unit = (tables(db).units ?? []).find((u) => u.id === unitId);
      if (!unit) throw notFound();
      const access = accessOf(db, actor, unit.quote_request_id);
      if (!access || access === 'customer') throw forbidden('個体の状態を記録できるのは本部・担当代理店・製造の担当だけです');
      const forwardOnlyRoleOk =
        input.status === unit.status ||
        ((input.status === 'in_production' || input.status === 'inspected' || input.status === 'shipped')
          ? access === 'admin' || access === 'manufacturer'
          : input.status === 'installed' || input.status === 'handed_over'
            ? access === 'admin' || access === 'staff'
            : true);
      if (!forwardOnlyRoleOk) throw forbidden('この状態を記録する権限がありません');
      if (unit.lock_version !== expectedLockVersion) throw locked('他の画面で個体の状態が更新されています。再読み込みしてください');
      const order = this.orderOf(db, unit.order_id);
      if (order.status === 'draft' || order.status === 'canceled') throw locked('送っていない（または取り消した）製造依頼の個体は記録できません');
      if (!canSetUnitStatus(access, unit.status, input.status)) throw locked('個体の状態は前へだけ進められます（戻すときは本部へご連絡ください）');
      unit.status = input.status;
      unit.produced_on = input.produced_on ?? unit.produced_on;
      unit.inspected_on = input.inspected_on ?? unit.inspected_on;
      unit.shipped_on = input.shipped_on ?? unit.shipped_on;
      unit.installed_on = input.installed_on ?? unit.installed_on;
      unit.handed_over_on = input.handed_over_on ?? unit.handed_over_on;
      unit.note = input.note;
      unit.lock_version += 1;
      unit.updated_at = nowIso();
      return unit.lock_version;
    });
  }

  // ---------- 工程表 ----------
  async listScheduleItems(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      if (!access) return [];
      return (tables(db).scheduleItems ?? [])
        .filter((i) => i.quote_request_id === requestId && (access !== 'customer' || i.customer_visible))
        .sort((a, b) => a.sort_order - b.sort_order || (a.planned_start ?? '9999').localeCompare(b.planned_start ?? '9999'))
        .map((i) => ({ ...i }));
    });
  }
  async saveScheduleItem(actor: SessionUser, requestId: string, itemId: string | null, input: ScheduleItemInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') throw forbidden('工程表を編集できるのは本部・担当代理店・製造の担当だけです');
      if (access === 'manufacturer' && !MANUFACTURER_SCHEDULE_CATEGORIES.includes(input.category)) {
        throw forbidden('製造の担当が編集できるのは、製造・品質検査・出荷の工程だけです');
      }
      const t = tables(db);
      t.scheduleItems ??= [];
      const canSetVisible = access === 'admin' || access === 'staff';
      let becameVisible = false;
      let row: CaseScheduleItem;
      if (!itemId) {
        const sort = Math.max(-1, ...t.scheduleItems.filter((i) => i.quote_request_id === requestId).map((i) => i.sort_order)) + 1;
        row = { id: randomUUID(), quote_request_id: requestId, ...input, customer_visible: canSetVisible ? input.customer_visible : false, sort_order: sort, lock_version: 1, updated_at: nowIso() };
        t.scheduleItems.push(row);
        becameVisible = row.customer_visible;
      } else {
        const current = t.scheduleItems.find((i) => i.id === itemId);
        if (!current || current.quote_request_id !== requestId) throw notFound();
        if (access === 'manufacturer' && !MANUFACTURER_SCHEDULE_CATEGORIES.includes(current.category)) {
          throw forbidden('製造の担当が編集できるのは、製造・品質検査・出荷の工程だけです');
        }
        if (current.lock_version !== expectedLockVersion) throw locked('他の画面で工程表が更新されています。再読み込みしてください');
        becameVisible = canSetVisible && input.customer_visible && !current.customer_visible;
        Object.assign(current, input, { customer_visible: canSetVisible ? input.customer_visible : current.customer_visible, lock_version: current.lock_version + 1, updated_at: nowIso() });
        row = current;
      }
      if (becameVisible) {
        const request = db.quoteRequests.find((r) => r.id === requestId);
        if (request?.user_id) notify(db, { recipient_id: request.user_id, audience: 'customer', kind: 'case_schedule_updated', title: '工程表を更新しました', body: 'マイページの「ご依頼の進み具合」で、製造・施工の予定をご確認いただけます。', link: `/mypage/cases/${requestId}` });
      }
      return { id: row.id, lock_version: row.lock_version };
    });
  }
  async deleteScheduleItem(actor: SessionUser, itemId: string) {
    this.mutate((db) => {
      const t = tables(db);
      const item = (t.scheduleItems ?? []).find((i) => i.id === itemId);
      const access = item ? accessOf(db, actor, item.quote_request_id) : null;
      if (!item || !access || access === 'customer') throw notFound();
      if (access === 'manufacturer' && !MANUFACTURER_SCHEDULE_CATEGORIES.includes(item.category)) {
        throw forbidden('製造の担当が削除できるのは、製造・品質検査・出荷の工程だけです');
      }
      t.scheduleItems = (t.scheduleItems ?? []).filter((i) => i.id !== itemId);
    });
  }

  // ---------- 施工の記録 ----------
  async listProgressReports(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      if (!access) return [];
      return (tables(db).progressReports ?? [])
        .filter((r) => r.quote_request_id === requestId && (access !== 'customer' || r.customer_visible))
        .sort((a, b) => b.reported_on.localeCompare(a.reported_on) || b.created_at.localeCompare(a.created_at))
        .map((r) => ({ ...r }));
    });
  }
  async addProgressReport(actor: SessionUser, requestId: string, input: ProgressReportInput) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (!access || access === 'customer') throw forbidden('施工の記録を書けるのは本部・担当代理店・製造の担当だけです');
      if (access === 'manufacturer' && !MANUFACTURER_PROGRESS_KINDS.includes(input.kind)) {
        throw forbidden('製造の担当が書けるのは、進み具合と技術支援の記録だけです');
      }
      const t = tables(db);
      if (input.schedule_item_id && !(t.scheduleItems ?? []).some((i) => i.id === input.schedule_item_id && i.quote_request_id === requestId)) {
        throw invalid('工程の指定が正しくありません');
      }
      t.progressReports ??= [];
      const visible = (access === 'admin' || access === 'staff') && input.customer_visible;
      const name = db.profiles.find((p) => p.id === actor.id)?.full_name?.trim();
      const report: CaseProgressReport = {
        id: randomUUID(),
        quote_request_id: requestId,
        ...input,
        customer_visible: visible,
        created_by: actor.id,
        author_name: (name || (access === 'admin' ? '本部' : access === 'manufacturer' ? '総代理店' : '担当代理店')).slice(0, 100),
        created_at: nowIso(),
      };
      t.progressReports.push(report);
      if (visible) {
        const request = db.quoteRequests.find((r) => r.id === requestId);
        if (request?.user_id) notify(db, { recipient_id: request.user_id, audience: 'customer', kind: 'case_progress_reported', title: '施工の様子を更新しました', body: input.title, link: `/mypage/cases/${requestId}` });
      }
      return report.id;
    });
  }
  async setProgressReportVisibility(actor: SessionUser, reportId: string, visible: boolean) {
    this.mutate((db) => {
      const report = (tables(db).progressReports ?? []).find((r) => r.id === reportId);
      if (!report) throw notFound();
      const access = accessOf(db, actor, report.quote_request_id);
      if (access !== 'admin' && access !== 'staff') throw forbidden('お客様へ見せるかを決められるのは本部と担当代理店だけです');
      report.customer_visible = visible;
    });
  }

  // ---------- 完了確認・是正・引渡し（20261013237000 と同じ判定） ----------
  private handoverOf(db: LocalDb, requestId: string): CaseHandover | undefined {
    return (tables(db).handovers ?? []).find((h) => h.quote_request_id === requestId);
  }
  async getHandover(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      if (!viewAccessOf(db, actor, requestId)) return null;
      const row = this.handoverOf(db, requestId);
      return row ? { ...row } : null;
    });
  }
  async listPunchItems(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      if (!viewAccessOf(db, actor, requestId)) return [];
      return (tables(db).punchItems ?? [])
        .filter((p) => p.quote_request_id === requestId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((p) => ({ ...p }));
    });
  }
  async startHandoverInspection(actor: SessionUser, requestId: string, input: HandoverInspectionInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('完成確認を始められるのは本部と担当代理店だけです');
      if (!db.contracts.some((c) => c.quote_request_id === requestId && c.status === 'signed')) throw locked('契約が締結されてから完成確認を始められます');
      const t = tables(db);
      t.handovers ??= [];
      const current = this.handoverOf(db, requestId);
      let version: number;
      if (!current) {
        if (expectedLockVersion !== null) throw locked('他の画面で完了確認が更新されています。再読み込みしてください');
        t.handovers.push({
          quote_request_id: requestId,
          status: 'inspecting',
          ...input,
          customer_confirmation: 'pending',
          customer_confirmed_via: null,
          customer_confirmed_at: null,
          certificate_file_id: null,
          certificate_signed_on: null,
          handed_over_on: null,
          lock_version: 1,
          updated_at: nowIso(),
        });
        version = 1;
      } else {
        if (current.lock_version !== expectedLockVersion) throw locked('他の画面で完了確認が更新されています。再読み込みしてください');
        if (current.status === 'handed_over') throw locked('引渡し済みの案件です');
        // 確認し直すときは、お客様の回答と承諾書の記録を待ちに戻す（是正中の指摘はそのまま残る）
        Object.assign(current, input, {
          status: hasOpenPunchItems(db, requestId) ? 'correcting' : 'inspecting',
          customer_confirmation: 'pending',
          customer_confirmed_via: null,
          customer_confirmed_at: null,
          certificate_file_id: null,
          certificate_signed_on: null,
          lock_version: current.lock_version + 1,
          updated_at: nowIso(),
        });
        version = current.lock_version;
      }
      const customer = customerOf(db, requestId);
      if (customer) {
        notify(db, {
          recipient_id: customer,
          audience: 'customer',
          kind: 'handover_inspection',
          title: '完成内容のご確認をお願いします',
          body: 'マイページの「ご依頼の進み具合」で完成内容をご確認のうえ、「問題なし」か「気になる点がある」をお知らせください。',
          link: `/mypage/cases/${requestId}`,
        });
      }
      return version;
    });
  }
  async confirmHandover(actor: SessionUser, requestId: string, result: 'ok' | 'issues', issues: string[], expectedLockVersion: number) {
    return this.mutate((db) => {
      if (accessOf(db, actor, requestId) !== 'customer') throw forbidden('完成内容の確認はお客様が行います');
      const current = this.handoverOf(db, requestId);
      if (!current || current.status === 'handed_over' || (result === 'ok' && current.status === 'ready')) throw locked('今は完成内容の回答を受け付けていません');
      if (current.lock_version !== expectedLockVersion) throw locked('完了確認が更新されています。再読み込みしてください');
      const t = tables(db);
      let title: string;
      if (result === 'ok') {
        if (hasOpenPunchItems(db, requestId)) throw locked('是正の確認が済んでいない点があります。先に是正の内容をご確認ください');
        Object.assign(current, { customer_confirmation: 'ok', customer_confirmed_via: 'mypage', customer_confirmed_at: nowIso(), status: 'ready' });
        title = 'お客様が完成内容を確認しました（問題なし）';
      } else {
        const lines = issues.map((line) => line.trim());
        if (lines.length < 1 || lines.length > 20) throw invalid('気になる点を 1〜20 件入力してください');
        if (lines.some((line) => !line || line.length > 1000)) throw invalid('気になる点は 1 件 1000 文字以内で入力してください');
        t.punchItems ??= [];
        for (const description of lines) {
          t.punchItems.push({
            id: randomUUID(),
            quote_request_id: requestId,
            description,
            raised_by_customer: true,
            status: 'open',
            fixed_on: null,
            verified_at: null,
            lock_version: 1,
            created_at: nowIso(),
          });
        }
        // 承諾書の記録の後に指摘があったら、是正の後に記録し直す
        Object.assign(current, {
          customer_confirmation: 'issues',
          customer_confirmed_via: 'mypage',
          customer_confirmed_at: nowIso(),
          status: 'correcting',
          certificate_file_id: null,
          certificate_signed_on: null,
        });
        title = `お客様から完成内容への指摘がありました（${lines.length} 件）`;
      }
      current.lock_version += 1;
      current.updated_at = nowIso();
      const link = `/admin/quotes?request=${requestId}`;
      notify(db, { recipient_id: null, audience: 'admin', kind: 'handover_confirmed', title, body: '案件の「引渡し・アフター」タブで確認してください。', link });
      const dealerId = caseDealerId(db, requestId);
      if (dealerId) notify(db, { recipient_id: dealerId, audience: 'dealer', kind: 'handover_confirmed', title, body: '案件の「引渡し・アフター」タブで確認してください。', link });
      return current.lock_version;
    });
  }
  async addPunchItem(actor: SessionUser, requestId: string, description: string, expectedLockVersion: number) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') {
        throw forbidden('是正事項を追加できるのは本部と担当代理店だけです（お客様は完成内容の確認から指摘できます）');
      }
      const text = description.trim();
      if (!text || text.length > 1000) throw invalid('是正事項を 1000 文字以内で入力してください');
      const current = this.handoverOf(db, requestId);
      if (!current || current.status === 'handed_over') throw locked('完成確認を始めてから（引渡しの前に）是正事項を追加できます');
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面で完了確認が更新されています。再読み込みしてください');
      const t = tables(db);
      t.punchItems ??= [];
      const item: CasePunchItem = {
        id: randomUUID(),
        quote_request_id: requestId,
        description: text,
        raised_by_customer: false,
        status: 'open',
        fixed_on: null,
        verified_at: null,
        lock_version: 1,
        created_at: nowIso(),
      };
      t.punchItems.push(item);
      // 確認済み（問題なし）の後に見つかったら、お客様の確認と承諾書の記録を待ちに戻す
      if (current.customer_confirmation === 'ok') {
        Object.assign(current, { customer_confirmation: 'pending', customer_confirmed_via: null, customer_confirmed_at: null });
      }
      Object.assign(current, { status: 'correcting', certificate_file_id: null, certificate_signed_on: null, lock_version: current.lock_version + 1, updated_at: nowIso() });
      return item.id;
    });
  }
  async setPunchItemStatus(actor: SessionUser, itemId: string, status: 'fixed' | 'verified', expectedLockVersion: number) {
    return this.mutate((db) => {
      const item = (tables(db).punchItems ?? []).find((p) => p.id === itemId);
      if (!item) throw notFound();
      const access = accessOf(db, actor, item.quote_request_id);
      if (
        !access ||
        (status !== 'fixed' && status !== 'verified') ||
        (status === 'fixed' && access !== 'admin' && access !== 'staff') ||
        (status === 'verified' && access === 'manufacturer')
      ) {
        throw forbidden('この是正事項をその状態にする権限がありません');
      }
      if (item.lock_version !== expectedLockVersion) throw locked('是正事項が更新されています。再読み込みしてください');
      if (!((item.status === 'open' && status === 'fixed') || (item.status === 'fixed' && status === 'verified'))) throw locked('この是正事項はその状態に変更できません');
      if (isHandedOver(db, item.quote_request_id)) throw locked('引渡し済みの案件です');
      item.status = status;
      if (status === 'fixed') item.fixed_on = todayInJapan();
      if (status === 'verified') item.verified_at = nowIso();
      item.lock_version += 1;
      if (status === 'fixed') {
        const customer = customerOf(db, item.quote_request_id);
        if (customer) {
          notify(db, {
            recipient_id: customer,
            audience: 'customer',
            kind: 'punch_item_fixed',
            title: 'ご指摘の点の是正が終わりました',
            body: 'マイページの「ご依頼の進み具合」で、是正の内容をご確認ください。',
            link: `/mypage/cases/${item.quote_request_id}`,
          });
        }
      }
      return item.lock_version;
    });
  }
  async recordCompletionCertificate(actor: SessionUser, requestId: string, fileId: string, signedOn: string, expectedLockVersion: number) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('工事完了承諾書を記録できるのは本部と担当代理店だけです');
      const current = this.handoverOf(db, requestId);
      if (!current || current.status === 'handed_over') throw locked('完成確認を始めてから（引渡しの前に）記録できます');
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面で完了確認が更新されています。再読み込みしてください');
      if (hasOpenPunchItems(db, requestId)) throw locked('是正の確認が済んでいない是正事項があります');
      const min = new Date(`${current.inspection_on}T00:00:00Z`);
      min.setUTCDate(min.getUTCDate() - 365);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn) || signedOn > todayInJapan() || signedOn < min.toISOString().slice(0, 10)) {
        throw invalid('承諾書の署名日を正しく入力してください（今日以前）');
      }
      if (!tables(db).files.some((f) => f.id === fileId && f.quote_request_id === requestId && f.context === 'handover')) {
        throw invalid('この案件の「完了確認・引渡し」に登録した、署名済みの承諾書の写しを選んでください');
      }
      if (current.customer_confirmation !== 'ok') {
        Object.assign(current, { customer_confirmation: 'ok', customer_confirmed_via: 'certificate', customer_confirmed_at: nowIso() });
      }
      Object.assign(current, { certificate_file_id: fileId, certificate_signed_on: signedOn, status: 'ready', lock_version: current.lock_version + 1, updated_at: nowIso() });
      return current.lock_version;
    });
  }
  async completeHandover(actor: SessionUser, requestId: string, handedOverOn: string, expectedLockVersion: number) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff') throw forbidden('引渡し完了にできるのは本部と担当代理店だけです');
      const current = this.handoverOf(db, requestId);
      if (!current || current.status !== 'ready' || !current.certificate_file_id) {
        throw locked('お客様の確認と工事完了承諾書の記録が済んでから、引渡し完了にできます');
      }
      if (current.lock_version !== expectedLockVersion) throw locked('他の画面で完了確認が更新されています。再読み込みしてください');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(handedOverOn) || handedOverOn > todayInJapan() || handedOverOn < current.inspection_on) {
        throw invalid('引渡し日は完成確認の日から今日までの日付にしてください');
      }
      Object.assign(current, { status: 'handed_over', handed_over_on: handedOverOn, lock_version: current.lock_version + 1, updated_at: nowIso() });
      // 設置済みの個体を引渡し済みにする
      const t = tables(db);
      const activeOrders = new Set((t.orders ?? []).filter((o) => o.quote_request_id === requestId && o.status !== 'canceled').map((o) => o.id));
      for (const unit of t.units ?? []) {
        if (activeOrders.has(unit.order_id) && unit.status === 'installed') {
          Object.assign(unit, { status: 'handed_over', handed_over_on: handedOverOn, lock_version: unit.lock_version + 1, updated_at: nowIso() });
        }
      }
      const customer = customerOf(db, requestId);
      if (customer) {
        notify(db, { recipient_id: customer, audience: 'customer', kind: 'handover_completed', title: 'お引渡しが完了しました', body: 'これからは、マイページから定期点検・修理などのご依頼ができます。', link: `/mypage/cases/${requestId}` });
      }
      notify(db, { recipient_id: null, audience: 'admin', kind: 'handover_completed', title: '引渡しが完了しました', body: '工事完了承諾書の写しは、案件の「引渡し・アフター」タブで確認できます。', link: `/admin/quotes?request=${requestId}` });
      return current.lock_version;
    });
  }

  // ---------- アフター ----------
  /** RLS と同じ：総代理店は回されたものだけ */
  private canReadAfterService(access: CaseAccess | null, row: AfterServiceRequest) {
    return access === 'admin' || access === 'staff' || access === 'customer' || (access === 'manufacturer' && row.escalated_at !== null);
  }
  async listAfterServiceRequests(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      return (tables(db).afterService ?? [])
        .filter((r) => r.quote_request_id === requestId && this.canReadAfterService(access, r))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => ({ ...r }));
    });
  }
  async listAfterServiceBoard(actor: SessionUser): Promise<BoardAfterServiceRequest[]> {
    return this.read((db) =>
      (tables(db).afterService ?? [])
        .filter((r) => {
          const access = viewAccessOf(db, actor, r.quote_request_id);
          return access !== 'customer' && this.canReadAfterService(access, r);
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((r) => {
          const label = caseLabelOf(db, r.quote_request_id);
          return { ...r, case_label: label.label, case_quote_id: label.quote_id, viewer_access: viewAccessOf(db, actor, r.quote_request_id) };
        })
    );
  }
  async createAfterServiceRequest(actor: SessionUser, requestId: string, input: AfterServiceRequestInput) {
    return this.mutate((db) => {
      const access = accessOf(db, actor, requestId);
      if (access !== 'admin' && access !== 'staff' && access !== 'customer') throw forbidden('アフターを登録できるのは、お客様・担当代理店・本部だけです');
      if (!isHandedOver(db, requestId)) throw locked('お引渡しの後にご依頼いただけます');
      const t = tables(db);
      t.afterService ??= [];
      const now = nowIso();
      const row: AfterServiceRequest = {
        id: randomUUID(),
        quote_request_id: requestId,
        ...input,
        status: 'open',
        response: null,
        requested_by: actor.id,
        requested_by_customer: access === 'customer',
        escalated_at: null,
        resolved_at: null,
        lock_version: 1,
        created_at: now,
        updated_at: now,
      };
      t.afterService.push(row);
      if (access === 'customer') {
        const title = `お客様からアフターのご依頼がありました：${input.title}`;
        notify(db, { recipient_id: null, audience: 'admin', kind: 'after_service_requested', title, body: 'アフターの一覧で内容を確認し、対応してください。', link: '/admin/after-service' });
        const dealerId = caseDealerId(db, requestId);
        if (dealerId) notify(db, { recipient_id: dealerId, audience: 'dealer', kind: 'after_service_requested', title, body: 'アフターの一覧で内容を確認し、対応してください。', link: '/admin/after-service' });
      } else {
        const customer = customerOf(db, requestId);
        if (customer) {
          notify(db, { recipient_id: customer, audience: 'customer', kind: 'after_service_registered', title: `アフターの予定を登録しました：${input.title}`, body: 'マイページの「ご依頼の進み具合」でご確認いただけます。', link: `/mypage/cases/${requestId}` });
        }
      }
      return row.id;
    });
  }
  async updateAfterServiceRequest(actor: SessionUser, id: string, input: AfterServiceUpdateInput, expectedLockVersion: number) {
    return this.mutate((db) => {
      const row = (tables(db).afterService ?? []).find((r) => r.id === id);
      if (!row) throw notFound();
      const access = accessOf(db, actor, row.quote_request_id);
      // 回されていないものは、総代理店には存在も分からないようにする
      if (access === 'manufacturer' && !row.escalated_at) throw notFound();
      if (!access || access === 'customer') throw forbidden('このアフターを更新する権限がありません');
      if (access === 'manufacturer' && input.status !== 'escalated' && input.status !== 'resolved') {
        throw forbidden('製造の担当は、回されたアフターの回答と完了だけ記録できます');
      }
      if (row.lock_version !== expectedLockVersion) throw locked('他の画面でアフターが更新されています。再読み込みしてください');
      if (row.status === 'resolved' && input.status !== 'resolved') throw locked('完了したアフターは戻せません。新しいご依頼として登録してください');
      let manufacturer: string | null = null;
      let manufacturingOrg: string | null = null;
      if (input.status === 'escalated' && row.status !== 'escalated') {
        const escalateWorkflow = tables(db).workflows.find((w) => w.quote_request_id === row.quote_request_id);
        manufacturer = escalateWorkflow?.manufacturer_id ?? null;
        manufacturingOrg = escalateWorkflow?.manufacturing_organization_id ?? null;
        if (!manufacturer && !manufacturingOrg) throw locked('製造の担当（総代理店）が決まっていない案件です。先に本部が製造の担当を決めてください');
      }
      const wasResolved = row.status === 'resolved';
      row.status = input.status;
      if (input.response !== undefined) row.response = input.response;
      if (input.status === 'escalated' && !row.escalated_at) row.escalated_at = nowIso();
      row.resolved_at = input.status === 'resolved' ? (row.resolved_at ?? nowIso()) : null;
      row.lock_version += 1;
      row.updated_at = nowIso();
      if (manufacturingOrg) {
        notifyOrganizationManagers(db, manufacturingOrg, { kind: 'after_service_escalated', title: `製造起因のアフターが回ってきました：${row.title}`, body: '修補・部材供給の対応をお願いします。', link: '/admin/after-service' });
      } else if (manufacturer) {
        notify(db, { recipient_id: manufacturer, audience: 'dealer', kind: 'after_service_escalated', title: `製造起因のアフターが回ってきました：${row.title}`, body: '修補・部材供給の対応をお願いします。', link: '/admin/after-service' });
      }
      if (input.status === 'resolved' && !wasResolved) {
        const customer = customerOf(db, row.quote_request_id);
        if (customer) {
          notify(db, { recipient_id: customer, audience: 'customer', kind: 'after_service_resolved', title: `アフターのご依頼に対応しました：${row.title}`, body: 'マイページの「ご依頼の進み具合」で回答をご確認ください。', link: `/mypage/cases/${row.quote_request_id}` });
        }
      }
      return row.lock_version;
    });
  }

  // ---------- 災害時提供の意思 ----------
  async listDisasterConsentTexts(_actor: SessionUser) {
    return this.read((db) => [...(tables(db).consentTexts ?? [])].sort((a, b) => b.version - a.version).map((t) => ({ ...t })));
  }
  async publishDisasterConsentText(actor: SessionUser, input: { title: string; body: string }) {
    return this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('承諾書の文面を登録できるのは本部だけです');
      const title = input.title.trim();
      const body = input.body.trim();
      if (!title || title.length > 100) throw invalid('見出しを 100 文字以内で入力してください');
      if (!body || body.length > 20000) throw invalid('文面を 20000 文字以内で入力してください');
      const t = tables(db);
      t.consentTexts ??= [];
      const version = Math.max(0, ...t.consentTexts.map((x) => x.version)) + 1;
      const id = randomUUID();
      t.consentTexts.push({ id, version, title, body, published_at: nowIso() });
      db.auditLogs.push({
        id: randomUUID(),
        actor_id: actor.id,
        actor_email: actor.email,
        action: 'publish',
        entity: 'disaster_consent_texts',
        entity_id: id,
        summary: `災害時提供の承諾書の文面を登録しました（第${version}版）`,
        created_at: nowIso(),
      });
      return version;
    });
  }
  async listDisasterConsents(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      if (!access || access === 'manufacturer') return [];
      return consentsOf(db, requestId).map((c) => ({ ...c }));
    });
  }
  async setDisasterConsent(actor: SessionUser, requestId: string, input: DisasterConsentInput) {
    return this.mutate((db) => {
      if (accessOf(db, actor, requestId) !== 'customer') throw forbidden('災害時提供の意思はお客様が決めます');
      const conditions = input.conditions?.trim() || null;
      if (input.decision === 'conditional' && !conditions) throw invalid('条件を入力してください');
      if ((conditions ?? '').length > 2000) throw invalid('条件は 2000 文字以内で入力してください');
      const t = tables(db);
      const text = [...(t.consentTexts ?? [])].sort((a, b) => b.version - a.version)[0];
      if (!text) throw locked('承諾書の文面の準備ができてから設定できます');
      if (text.version !== input.text_version) throw locked('承諾書の文面が新しくなりました。再読み込みして最新の文面をご確認ください');
      if (!isHandedOver(db, requestId)) throw locked('お引渡しの後に設定できます');
      t.consents ??= [];
      const row: DisasterConsent = {
        id: randomUUID(),
        quote_request_id: requestId,
        user_id: actor.id,
        text_id: text.id,
        decision: input.decision,
        conditions: input.decision === 'conditional' ? conditions : null,
        created_at: nowIso(),
      };
      t.consents.push(row);
      if (input.decision === 'declined') {
        for (const entry of t.stockLedger ?? []) {
          if (entry.quote_request_id === requestId && entry.registration_status === 'registered') {
            Object.assign(entry, { registration_status: 'suspended', lock_version: entry.lock_version + 1, updated_at: nowIso() });
          }
        }
      }
      const label = input.decision === 'accepted' ? '承諾' : input.decision === 'conditional' ? '条件付き承諾' : '不承諾';
      notify(db, { recipient_id: null, audience: 'admin', kind: 'disaster_consent_set', title: `お客様が災害時提供の意思を設定しました（${label}）`, body: '全国ストック台帳で、登録と提供の可否を確認してください。', link: '/admin/stock-ledger' });
      return row.id;
    });
  }

  // ---------- 全国ストック台帳（本部だけ） ----------
  async listStockLedger(actor: SessionUser): Promise<StockLedgerRow[]> {
    return this.read((db) => {
      if (rank(actor) < 3) return [];
      const t = tables(db);
      const entries = t.stockLedger ?? [];
      return (t.units ?? [])
        .filter((u) => u.status === 'handed_over' || entries.some((e) => e.unit_id === u.id))
        .sort((a, b) => (b.handed_over_on ?? '').localeCompare(a.handed_over_on ?? ''))
        .map((unit) => {
          const label = caseLabelOf(db, unit.quote_request_id);
          const entry = entries.find((e) => e.unit_id === unit.id);
          return {
            unit: { ...unit },
            entry: entry ? { ...entry } : null,
            latest_consent: consentsOf(db, unit.quote_request_id)[0] ?? null,
            case_label: label.label,
            case_quote_id: label.quote_id,
          };
        });
    });
  }
  async saveStockLedgerEntry(actor: SessionUser, unitId: string, input: StockLedgerEntryInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      if (rank(actor) < 3) throw forbidden('全国ストック台帳を編集できるのは本部だけです');
      const t = tables(db);
      const unit = (t.units ?? []).find((u) => u.id === unitId);
      if (!unit) throw notFound();
      if (unit.status !== 'handed_over') throw locked('引渡し済みの個体だけ台帳に載せられます');
      if (input.registration_status === 'registered' && !canRegisterStock(consentsOf(db, unit.quote_request_id)[0]?.decision ?? null)) {
        throw locked('お客様が災害時提供を承諾（または条件付きで承諾）していない個体は登録できません');
      }
      t.stockLedger ??= [];
      const current = t.stockLedger.find((e) => e.unit_id === unitId);
      if ((current?.lock_version ?? null) !== expectedLockVersion) throw locked('他の画面で台帳が更新されています。再読み込みしてください');
      if (!current) {
        const row: StockLedgerEntry = {
          unit_id: unit.id,
          quote_request_id: unit.quote_request_id,
          ...input,
          judged_by: actor.id,
          judged_at: nowIso(),
          lock_version: 1,
          updated_at: nowIso(),
        };
        t.stockLedger.push(row);
        return 1;
      }
      Object.assign(current, input, { judged_by: actor.id, judged_at: nowIso(), lock_version: current.lock_version + 1, updated_at: nowIso() });
      return current.lock_version;
    });
  }

  // ---------- 一時保存（20261014100000 と同じ判定） ----------
  async createGuestPlan(baseModelId: string, plan: GuestPlanInput) {
    return this.mutate((db) => {
      if (!db.models.some((m) => m.id === baseModelId && m.status === 'published')) throw invalid('商品が見つかりません');
      const t = tables(db);
      const now = Date.now();
      // 期限切れの行を消し、混み合い対策（1 分あたりの作成数・有効な一時保存の総数）を確かめる
      t.guestPlans = (t.guestPlans ?? []).filter((g) => Date.parse(g.expires_at) > now);
      if (t.guestPlans.filter((g) => Date.parse(g.created_at) > now - 60_000).length >= 60 || t.guestPlans.length >= 100_000) {
        throw locked('一時保存が混み合っています。少し時間をおいてからお試しください');
      }
      const token = randomBytes(24).toString('base64url');
      const expires_at = new Date(now + GUEST_PLAN_DAYS * 24 * 60 * 60 * 1000).toISOString();
      t.guestPlans.push({ token_hash: sha256(token), base_model_id: baseModelId, plan, created_at: new Date(now).toISOString(), expires_at });
      return { token, expires_at };
    });
  }
  async getGuestPlan(token: string): Promise<GuestPlan | null> {
    if (!GUEST_PLAN_TOKEN.test(token)) return null;
    return this.read((db) => {
      const row = (tables(db).guestPlans ?? []).find((g) => g.token_hash === sha256(token) && Date.parse(g.expires_at) > Date.now());
      return row ? { base_model_id: row.base_model_id, plan: structuredClone(row.plan), expires_at: row.expires_at } : null;
    });
  }

  // ---------- 設置予定地・土地 ----------
  async getSiteProfile(actor: SessionUser, configurationId: string) {
    return this.read((db) => {
      if (!siteProfileAccessOf(db, actor, configurationId)) return null;
      const row = (tables(db).siteProfiles ?? []).find((p) => p.configuration_id === configurationId);
      return row ? { ...row } : null;
    });
  }
  async saveSiteProfile(actor: SessionUser, configurationId: string, input: SiteProfileInput, expectedLockVersion: number | null) {
    return this.mutate((db) => {
      const access = siteProfileAccessOf(db, actor, configurationId);
      if (access !== 'owner' && access !== 'admin') throw forbidden('土地の情報を変更できるのは、お客様ご本人と本部だけです');
      const t = tables(db);
      t.siteProfiles ??= [];
      const current = t.siteProfiles.find((p) => p.configuration_id === configurationId);
      if ((current?.lock_version ?? null) !== expectedLockVersion) throw locked('他の画面で土地の情報が更新されています。再読み込みしてください');
      // 土地の有無に合わない項目は持たない（DB の制約と同じ）
      const owned = input.land_status === 'owned';
      const row: SiteProfile = {
        configuration_id: configurationId,
        land_status: input.land_status,
        site_address: owned ? input.site_address : null,
        area_sqm: owned ? input.area_sqm : null,
        land_category: owned ? input.land_category : null,
        road_access: owned ? input.road_access : null,
        electricity: owned ? input.electricity : null,
        water: owned ? input.water : null,
        drainage: owned ? input.drainage : null,
        desired_area: owned ? null : input.desired_area,
        intended_use: owned ? null : input.intended_use,
        land_budget: owned ? null : input.land_budget,
        note: input.note,
        lock_version: (current?.lock_version ?? 0) + 1,
        updated_at: nowIso(),
      };
      if (current) Object.assign(current, row);
      else t.siteProfiles.push(row);
      return row.lock_version;
    });
  }

  // ---------- 写真・書類 ----------
  async listCaseFiles(actor: SessionUser, requestId: string) {
    return this.read((db) => {
      const access = viewAccessOf(db, actor, requestId);
      if (!access) return [];
      return tables(db)
        .files.filter((f) => f.quote_request_id === requestId && canReadCaseFile(db, actor, access, f))
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
      const access = viewAccessOf(db, actor, file.quote_request_id);
      if (!access || !canReadCaseFile(db, actor, access, file)) return null;
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
      if ((t.handovers ?? []).some((h) => h.certificate_file_id === fileId)) throw locked('工事完了承諾書として記録した写しは削除できません');
      t.files = t.files.filter((f) => f.id !== fileId);
      const abs = path.join(filesDir(), 'case-files', file.storage_path);
      if (fs.existsSync(abs)) fs.rmSync(abs);
    });
  }
}
