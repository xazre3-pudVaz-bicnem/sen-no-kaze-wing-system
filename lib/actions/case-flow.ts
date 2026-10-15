'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { siteProfileInputFromForm } from '@/lib/data/case-flow/site-profile-from-form';
import { flushNotificationsSafely } from '@/lib/mail/send';
import {
  CASE_FILE_MAX_BYTES,
  CaseFlowValidationError,
  normalizeAfterServiceRequestInput,
  normalizeAfterServiceUpdateInput,
  normalizeCertificateSignedOn,
  normalizeDisasterConsentInput,
  normalizeDisasterConsentTextInput,
  normalizeHandedOverOn,
  normalizeHandoverInspectionInput,
  normalizeHandoverIssues,
  normalizePunchDescription,
  normalizeStockLedgerEntryInput,
  type AfterServiceStatus,
  normalizeChangeRequestMessage,
  normalizeManufacturingOrderInput,
  normalizePaperContractInput,
  normalizeProgressReportInput,
  normalizeScheduleItemInput,
  normalizeUnitInput,
  type UnitStatus,
  normalizeAppointmentInput,
  normalizeCaseFileInput,
  normalizeCaseNoteInput,
  normalizeDealerProfileInput,
  normalizeSiteSurveyInput,
  SITE_LAND_FIELDS,
  SITE_LEGAL_FIELDS,
} from '@/lib/domain/case-flow';

/**
 * 案件の進行（フェーズ4〜15）の画面の操作。権限・状態の判定は DB（RPC・RLS）が正本で、ここでは入力の形だけを整える。
 */

export interface CaseFlowActionState {
  ok: boolean;
  message?: string;
  error?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function uuid(formData: FormData, key: string): string {
  const value = text(formData, key).trim();
  if (!UUID.test(value)) throw new CaseFlowValidationError('対象が正しくありません。画面を再読み込みしてください');
  return value;
}

function optionalUuid(formData: FormData, key: string): string | null {
  const value = text(formData, key).trim();
  if (!value) return null;
  if (!UUID.test(value)) throw new CaseFlowValidationError('選択内容が正しくありません');
  return value;
}

function intOrNull(formData: FormData, key: string): number | null {
  const value = text(formData, key).trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new CaseFlowValidationError('数値の形式が正しくありません');
  return Number(value);
}

function errorMessage(e: unknown): string {
  if (e instanceof CaseFlowValidationError || e instanceof StoreError) return e.message;
  console.error('[wing] case flow action failed', e);
  return '処理に失敗しました。時間をおいてもう一度お試しください';
}

async function actor(nextPath: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

function revalidateCase(quoteId: string | null, requestId: string | null) {
  revalidatePath('/admin/quotes');
  if (quoteId) {
    revalidatePath(`/admin/quotes/${quoteId}`);
    revalidatePath(`/mypage/quotes/${quoteId}`);
  }
  if (requestId) revalidatePath(`/mypage/cases/${requestId}`);
  revalidatePath('/admin/appointments');
}

/** 画面の datetime-local（日本時間）を ISO 8601 にする */
function jstLocalToIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) throw new CaseFlowValidationError('日時の形式が正しくありません');
  return new Date(`${v}:00+09:00`).toISOString();
}

// ---------- 代理店の公開情報 ----------

export async function saveDealerProfileAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/dealers');
  try {
    const dealerId = uuid(formData, 'dealer_id');
    const lines = (key: string) =>
      text(formData, key)
        .split(/[\n,、]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const input = normalizeDealerProfileInput({
      display_name: text(formData, 'display_name'),
      intro: text(formData, 'intro'),
      service_prefectures: formData.getAll('service_prefectures').map(String),
      service_municipalities: lines('service_municipalities'),
      services: formData.getAll('services').map(String),
      qualifications: text(formData, 'qualifications'),
      track_record: text(formData, 'track_record'),
      completed_count: intOrNull(formData, 'completed_count'),
      phone: text(formData, 'phone'),
      website_url: text(formData, 'website_url'),
    });
    const store = await getCaseFlowStore();
    await store.saveDealerProfile(user, dealerId, input, intOrNull(formData, 'expected_lock_version'));
    revalidatePath('/admin/dealers');
    revalidatePath(`/admin/dealers/${dealerId}`);
    revalidatePath('/dealers');
    return { ok: true, message: '代理店の情報を保存しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setDealerProfilePublishedAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/dealers');
  let dealerId = '';
  let result = 'published';
  try {
    dealerId = uuid(formData, 'dealer_id');
    const published = text(formData, 'published') === 'true';
    const store = await getCaseFlowStore();
    await store.setDealerProfilePublished(user, dealerId, published, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    result = published ? 'published' : 'unpublished';
  } catch (e) {
    redirect(`/admin/dealers/${dealerId}?error=${encodeURIComponent(errorMessage(e))}`);
  }
  revalidatePath('/admin/dealers');
  revalidatePath('/dealers');
  redirect(`/admin/dealers/${dealerId}?done=${result}`);
}

// ---------- 受付・担当 ----------

export async function acknowledgeCaseAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.acknowledgeCase(user, requestId);
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=acknowledged`);
}

export async function assignCasePrimaryStaffAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.assignCasePrimaryStaff(user, requestId, optionalUuid(formData, 'staff_id'));
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=primary`);
}

export async function setCaseManufacturerAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.setCaseManufacturer(user, requestId, optionalUuid(formData, 'manufacturer_id'));
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=manufacturer`);
}

// ---------- 営業担当組織・製造担当組織（本部だけ。20261015130000） ----------

export async function setCaseSalesOrganizationAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.setCaseSalesOrganization(user, requestId, optionalUuid(formData, 'organization_id'));
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=sales`);
}

export async function setCaseManufacturingOrganizationAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.setCaseManufacturingOrganization(user, requestId, optionalUuid(formData, 'organization_id'));
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=manufacturing`);
}

// ---------- 日程 ----------

export async function proposeAppointmentAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const candidates = [1, 2, 3, 4, 5]
      .map((n) => {
        const starts = jstLocalToIso(text(formData, `candidate_${n}_starts`));
        const ends = jstLocalToIso(text(formData, `candidate_${n}_ends`));
        return starts ? { starts_at: starts, ends_at: ends } : null;
      })
      .filter((c): c is { starts_at: string; ends_at: string | null } => c !== null);
    const input = normalizeAppointmentInput(
      {
        purpose: text(formData, 'purpose'),
        method: text(formData, 'method'),
        candidates,
        location: text(formData, 'location'),
        note: text(formData, 'note'),
        confirm: text(formData, 'confirm') === 'on',
      },
      new Date()
    );
    const store = await getCaseFlowStore();
    await store.proposeCaseAppointment(user, requestId, input);
    await flushNotificationsSafely();
    revalidateCase(text(formData, 'quote_id'), requestId);
    return { ok: true, message: input.confirm ? '日時を確定し、お客様へお知らせしました。' : '候補の日時をお客様へ送りました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function confirmAppointmentAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const appointmentId = uuid(formData, 'appointment_id');
    const index = intOrNull(formData, 'candidate_index');
    if (index === null) throw new CaseFlowValidationError('候補の日時を選んでください');
    const store = await getCaseFlowStore();
    await store.confirmCaseAppointment(user, appointmentId, index, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateCase(text(formData, 'quote_id') || null, text(formData, 'request_id') || null);
    return { ok: true, message: '日時を確定しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function requestAppointmentChangeAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const appointmentId = uuid(formData, 'appointment_id');
    const store = await getCaseFlowStore();
    await store.requestCaseAppointmentChange(user, appointmentId, text(formData, 'customer_note'), intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateCase(null, text(formData, 'request_id') || null);
    return { ok: true, message: 'ご要望を担当へお送りしました。新しい候補をお待ちください。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setAppointmentStatusAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const appointmentId = uuid(formData, 'appointment_id');
    const status = text(formData, 'status');
    if (status !== 'done' && status !== 'canceled') throw new CaseFlowValidationError('状態の指定が正しくありません');
    const store = await getCaseFlowStore();
    await store.setCaseAppointmentStatus(user, appointmentId, status, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateCase(quoteId, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=appointment`);
}

// ---------- 現地確認 ----------

export async function saveSiteSurveyAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const land: Record<string, string> = {};
    for (const { key } of SITE_LAND_FIELDS) land[key] = text(formData, `land_${key}`);
    const legal: Record<string, string> = {};
    for (const { key } of SITE_LEGAL_FIELDS) legal[key] = text(formData, `legal_${key}`);
    const input = normalizeSiteSurveyInput({
      surveyed_on: text(formData, 'surveyed_on'),
      surveyor_name: text(formData, 'surveyor_name'),
      land,
      legal,
      survey_notes: text(formData, 'survey_notes'),
    });
    const store = await getCaseFlowStore();
    await store.saveSiteSurvey(user, requestId, input, intOrNull(formData, 'expected_lock_version'));
    revalidateCase(text(formData, 'quote_id'), requestId);
    return { ok: true, message: '現地確認の内容を保存しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setSiteSurveyStatusAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const requestId = uuid(formData, 'request_id');
    const status = text(formData, 'status');
    if (status !== 'completed' && status !== 'draft') throw new CaseFlowValidationError('状態の指定が正しくありません');
    const store = await getCaseFlowStore();
    await store.setSiteSurveyStatus(user, requestId, status, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateCase(quoteId, requestId);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=site&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=site&done=survey`);
}

// ---------- 社内の記録 ----------

export async function addCaseNoteAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeCaseNoteInput({
      kind: text(formData, 'kind'),
      body: text(formData, 'body'),
      verdict: text(formData, 'verdict'),
      estimated_cost: intOrNull(formData, 'estimated_cost'),
      parent_id: text(formData, 'parent_id'),
    });
    const store = await getCaseFlowStore();
    await store.addCaseNote(user, requestId, input);
    await flushNotificationsSafely();
    revalidateCase(text(formData, 'quote_id'), requestId);
    return { ok: true, message: '記録しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------- 見積の修正依頼（フェーズ9） ----------

export async function requestQuoteChangeAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const quoteId = uuid(formData, 'quote_id');
    const message = normalizeChangeRequestMessage(text(formData, 'message'));
    const store = await getCaseFlowStore();
    await store.requestQuoteChange(user, quoteId, message);
    await flushNotificationsSafely();
    revalidateCase(quoteId, text(formData, 'request_id') || null);
    return { ok: true, message: '修正のご依頼をお送りしました。担当よりご連絡いたします。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function resolveQuoteChangeAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    const resolution = text(formData, 'resolution').trim();
    if (resolution.length > 1000) throw new CaseFlowValidationError('対応内容は 1000 文字以内で入力してください');
    await store.resolveQuoteChangeRequest(user, uuid(formData, 'change_request_id'), resolution || null);
    await flushNotificationsSafely();
    revalidateCase(quoteId, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=estimate&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=estimate&done=change`);
}

// ---------- 書面で締結した契約（フェーズ10） ----------

export async function recordPaperContractAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  if (user.role !== 'admin') return { ok: false, error: '書面の契約を記録できるのは本部だけです' };
  try {
    const quoteId = uuid(formData, 'quote_id');
    const input = normalizePaperContractInput(
      { signer_name: text(formData, 'signer_name'), signer_email: text(formData, 'signer_email'), signed_on: text(formData, 'signed_on') },
      new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
    );
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) throw new CaseFlowValidationError('署名済みの契約書（PDF）を選んでください');
    if (file.type !== 'application/pdf') throw new CaseFlowValidationError('契約書は PDF で登録してください');
    if (file.size > CASE_FILE_MAX_BYTES) throw new CaseFlowValidationError('契約書は 20MB 以下にしてください');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // PDF の先頭の印（%PDF-）を確かめる（種類の申告だけを信用しない）
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new CaseFlowValidationError('PDF ファイルを選んでください');
    }
    const store = await getCaseFlowStore();
    await store.recordPaperContract(user, quoteId, input, bytes);
    await flushNotificationsSafely();
    revalidateCase(quoteId, text(formData, 'request_id') || null);
    return { ok: true, message: '書面の契約を記録しました。お客様のマイページからも契約書を開けます。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function voidPaperContractAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    await store.voidPaperContract(user, uuid(formData, 'contract_id'), text(formData, 'reason'));
    revalidateCase(quoteId, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(`/admin/quotes/${quoteId}?tab=documents&error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(`/admin/quotes/${quoteId}?tab=documents&done=paper_void`);
}

// ---------- 製造依頼と個体（フェーズ11） ----------

const todayJst = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

function productionBack(quoteId: string, query: string) {
  return quoteId ? `/admin/quotes/${quoteId}?tab=production&${query}` : `/admin/manufacturing?${query}`;
}

export async function saveManufacturingOrderAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const input = normalizeManufacturingOrderInput(
      {
        unit_count: text(formData, 'unit_count'),
        requested_delivery_on: text(formData, 'requested_delivery_on'),
        spec_note: text(formData, 'spec_note'),
        supply_note: text(formData, 'supply_note'),
      },
      todayJst()
    );
    const store = await getCaseFlowStore();
    const orderId = optionalUuid(formData, 'order_id');
    if (orderId) {
      await store.updateManufacturingOrder(user, orderId, input, intOrNull(formData, 'expected_lock_version') ?? 0);
    } else {
      await store.createManufacturingOrder(user, uuid(formData, 'request_id'), input);
    }
    revalidateCase(text(formData, 'quote_id') || null, text(formData, 'request_id') || null);
    revalidatePath('/admin/manufacturing');
    return { ok: true, message: orderId ? '製造依頼を保存しました。' : '製造依頼を作りました。内容を確認して、総代理店へ送ってください。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function sendManufacturingOrderAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    await store.sendManufacturingOrder(user, uuid(formData, 'order_id'), intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateCase(quoteId || null, text(formData, 'request_id') || null);
    revalidatePath('/admin/manufacturing');
  } catch (e) {
    redirect(productionBack(quoteId, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(productionBack(quoteId, 'done=order_sent'));
}

export async function setManufacturingOrderStatusAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/manufacturing');
  const quoteId = text(formData, 'quote_id');
  try {
    const status = text(formData, 'status');
    if (!['received', 'in_production', 'shipped', 'completed', 'canceled'].includes(status)) throw new CaseFlowValidationError('状態の指定が正しくありません');
    const store = await getCaseFlowStore();
    await store.setManufacturingOrderStatus(
      user,
      uuid(formData, 'order_id'),
      status as 'received' | 'in_production' | 'shipped' | 'completed' | 'canceled',
      intOrNull(formData, 'expected_lock_version') ?? 0,
      text(formData, 'reason') || null
    );
    await flushNotificationsSafely();
    revalidateCase(quoteId || null, text(formData, 'request_id') || null);
    revalidatePath('/admin/manufacturing');
  } catch (e) {
    redirect(productionBack(quoteId, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(productionBack(quoteId, 'done=order_status'));
}

export async function updateManufacturingUnitAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/manufacturing');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    const current = text(formData, 'current_status') as UnitStatus;
    const status = text(formData, 'status');
    // 画面は「状態」と「その状態になった日」だけを送る。日付は状態ごとの欄へ振り分ける
    const dateKey: Record<string, string> = {
      in_production: 'produced_on',
      inspected: 'inspected_on',
      shipped: 'shipped_on',
      installed: 'installed_on',
      handed_over: 'handed_over_on',
    };
    const statusDate = text(formData, 'status_date');
    const input = normalizeUnitInput(
      {
        status,
        produced_on: text(formData, 'produced_on'),
        inspected_on: text(formData, 'inspected_on'),
        shipped_on: text(formData, 'shipped_on'),
        installed_on: text(formData, 'installed_on'),
        handed_over_on: text(formData, 'handed_over_on'),
        ...(statusDate && dateKey[status] ? { [dateKey[status]]: statusDate } : {}),
        note: text(formData, 'note'),
      },
      current
    );
    await store.updateManufacturingUnit(user, uuid(formData, 'unit_id'), input, intOrNull(formData, 'expected_lock_version') ?? 0);
    revalidateCase(quoteId || null, text(formData, 'request_id') || null);
    revalidatePath('/admin/manufacturing');
  } catch (e) {
    redirect(productionBack(quoteId, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(productionBack(quoteId, 'done=unit'));
}

// ---------- 工程表（フェーズ12） ----------

export async function saveScheduleItemAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeScheduleItemInput({
      category: text(formData, 'category'),
      title: text(formData, 'title'),
      planned_start: text(formData, 'planned_start'),
      planned_end: text(formData, 'planned_end'),
      actual_start: text(formData, 'actual_start'),
      actual_end: text(formData, 'actual_end'),
      status: text(formData, 'status'),
      customer_visible: text(formData, 'customer_visible') === 'on',
      note: text(formData, 'note'),
    });
    const store = await getCaseFlowStore();
    await store.saveScheduleItem(user, requestId, optionalUuid(formData, 'item_id'), input, intOrNull(formData, 'expected_lock_version'));
    await flushNotificationsSafely();
    revalidateCase(text(formData, 'quote_id') || null, requestId);
    return { ok: true, message: '工程表を保存しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deleteScheduleItemAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    await store.deleteScheduleItem(user, uuid(formData, 'item_id'));
    revalidateCase(quoteId || null, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(productionBack(quoteId, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(productionBack(quoteId, 'done=schedule_deleted'));
}

// ---------- 施工の記録（フェーズ13） ----------

export async function addProgressReportAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeProgressReportInput(
      {
        kind: text(formData, 'kind'),
        title: text(formData, 'title'),
        body: text(formData, 'body'),
        reported_on: text(formData, 'reported_on'),
        schedule_item_id: text(formData, 'schedule_item_id'),
        customer_visible: text(formData, 'customer_visible') === 'on',
      },
      todayJst()
    );
    const store = await getCaseFlowStore();
    await store.addProgressReport(user, requestId, input);
    await flushNotificationsSafely();
    revalidateCase(text(formData, 'quote_id') || null, requestId);
    return { ok: true, message: '記録しました。写真は記録の下から登録できます。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function setProgressReportVisibilityAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  const quoteId = text(formData, 'quote_id');
  try {
    const store = await getCaseFlowStore();
    await store.setProgressReportVisibility(user, uuid(formData, 'report_id'), text(formData, 'visible') === 'true');
    revalidateCase(quoteId || null, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(productionBack(quoteId, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(productionBack(quoteId, 'done=report_visibility'));
}

// ---------- 完了確認・是正・引渡し（フェーズ14） ----------

/** 戻り先：画面が渡した戻り先（管理画面・マイページの中だけ）か、案件画面の「引渡し・アフター」タブ */
function handoverBack(formData: FormData, query: string, fallback = '/admin/after-service') {
  const back = text(formData, 'back');
  const quoteId = text(formData, 'quote_id');
  const base =
    back.startsWith('/admin/') || back.startsWith('/mypage/')
      ? back
      : UUID.test(quoteId)
        ? `/admin/quotes/${quoteId}?tab=handover`
        : fallback;
  return `${base}${base.includes('?') ? '&' : '?'}${query}`;
}

function revalidateHandover(formData: FormData, requestId: string | null) {
  revalidateCase(text(formData, 'quote_id') || null, requestId);
  revalidatePath('/admin/after-service');
  revalidatePath('/admin/stock-ledger');
}

export async function startHandoverInspectionAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeHandoverInspectionInput(
      { inspection_on: text(formData, 'inspection_on'), inspection_summary: text(formData, 'inspection_summary') },
      todayJst()
    );
    const store = await getCaseFlowStore();
    await store.startHandoverInspection(user, requestId, input, intOrNull(formData, 'expected_lock_version'));
    await flushNotificationsSafely();
    revalidateHandover(formData, requestId);
    return { ok: true, message: '完成確認を記録し、お客様へ確認をお願いしました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function confirmHandoverAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const requestId = uuid(formData, 'request_id');
    const result = text(formData, 'result');
    if (result !== 'ok' && result !== 'issues') throw new CaseFlowValidationError('回答の内容が正しくありません');
    const issues = result === 'issues' ? normalizeHandoverIssues(text(formData, 'issues')) : [];
    const store = await getCaseFlowStore();
    await store.confirmHandover(user, requestId, result, issues, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateHandover(formData, requestId);
    return {
      ok: true,
      message: result === 'ok' ? 'ご確認ありがとうございます。担当より、お引渡しの日程をご連絡いたします。' : '気になる点をお送りしました。担当が是正してご連絡いたします。',
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function addPunchItemAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const store = await getCaseFlowStore();
    await store.addPunchItem(user, requestId, normalizePunchDescription(text(formData, 'description')), intOrNull(formData, 'expected_lock_version') ?? 0);
    revalidateHandover(formData, requestId);
  } catch (e) {
    redirect(handoverBack(formData, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(handoverBack(formData, 'done=punch_added'));
}

export async function setPunchItemStatusAction(formData: FormData): Promise<void> {
  const user = await actor('/mypage');
  try {
    const status = text(formData, 'status');
    if (status !== 'fixed' && status !== 'verified') throw new CaseFlowValidationError('状態の指定が正しくありません');
    const store = await getCaseFlowStore();
    await store.setPunchItemStatus(user, uuid(formData, 'item_id'), status, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateHandover(formData, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(handoverBack(formData, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(handoverBack(formData, 'done=punch_status'));
}

export async function recordCompletionCertificateAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const signedOn = normalizeCertificateSignedOn(text(formData, 'signed_on'), todayJst(), text(formData, 'inspection_on'));
    const store = await getCaseFlowStore();
    await store.recordCompletionCertificate(user, requestId, uuid(formData, 'file_id'), signedOn, intOrNull(formData, 'expected_lock_version') ?? 0);
    revalidateHandover(formData, requestId);
  } catch (e) {
    redirect(handoverBack(formData, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(handoverBack(formData, 'done=certificate'));
}

export async function completeHandoverAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/quotes');
  try {
    const requestId = uuid(formData, 'request_id');
    const handedOverOn = normalizeHandedOverOn(text(formData, 'handed_over_on'), todayJst(), text(formData, 'inspection_on'));
    const store = await getCaseFlowStore();
    await store.completeHandover(user, requestId, handedOverOn, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateHandover(formData, requestId);
    revalidatePath('/admin/manufacturing');
  } catch (e) {
    redirect(handoverBack(formData, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(handoverBack(formData, 'done=handed_over'));
}

// ---------- アフター（フェーズ15） ----------

export async function createAfterServiceRequestAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeAfterServiceRequestInput({ kind: text(formData, 'kind'), title: text(formData, 'title'), body: text(formData, 'body') });
    const store = await getCaseFlowStore();
    await store.createAfterServiceRequest(user, requestId, input);
    await flushNotificationsSafely();
    revalidateHandover(formData, requestId);
    return { ok: true, message: user.role === 'customer' ? 'ご依頼を受け付けました。担当よりご連絡いたします。' : 'アフターを登録しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateAfterServiceRequestAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/after-service');
  try {
    const current = text(formData, 'current_status') as AfterServiceStatus;
    const raw: Record<string, unknown> = { status: text(formData, 'status') };
    if (formData.has('response')) raw.response = text(formData, 'response');
    const input = normalizeAfterServiceUpdateInput(raw, current);
    const store = await getCaseFlowStore();
    await store.updateAfterServiceRequest(user, uuid(formData, 'after_service_id'), input, intOrNull(formData, 'expected_lock_version') ?? 0);
    await flushNotificationsSafely();
    revalidateHandover(formData, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(handoverBack(formData, `error=${encodeURIComponent(errorMessage(e))}`));
  }
  redirect(handoverBack(formData, 'done=after_service'));
}

// ---------- 災害時提供の意思・全国ストック台帳（フェーズ15） ----------

export async function setDisasterConsentAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const requestId = uuid(formData, 'request_id');
    const input = normalizeDisasterConsentInput({
      decision: text(formData, 'decision'),
      conditions: text(formData, 'conditions'),
      text_version: text(formData, 'text_version'),
    });
    const store = await getCaseFlowStore();
    await store.setDisasterConsent(user, requestId, input);
    await flushNotificationsSafely();
    revalidateHandover(formData, requestId);
    return { ok: true, message: 'ご意思を記録しました。いつでも変更できます。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function publishDisasterConsentTextAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/admin/disaster-consent');
  if (user.role !== 'admin') return { ok: false, error: '承諾書の文面を登録できるのは本部だけです' };
  try {
    if (text(formData, 'confirmed') !== 'on') throw new CaseFlowValidationError('先方が確定した文面であることを確認して、チェックを入れてください');
    const input = normalizeDisasterConsentTextInput({ title: text(formData, 'title'), body: text(formData, 'body') });
    const store = await getCaseFlowStore();
    const version = await store.publishDisasterConsentText(user, input);
    revalidatePath('/admin/disaster-consent');
    revalidatePath('/admin/stock-ledger');
    revalidatePath('/mypage', 'layout');
    return { ok: true, message: `承諾書の文面を第${version}版として登録しました。引渡し済みのお客様のマイページに表示されます。` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function saveStockLedgerEntryAction(formData: FormData): Promise<void> {
  const user = await actor('/admin/stock-ledger');
  try {
    const input = normalizeStockLedgerEntryInput(
      {
        registration_status: text(formData, 'registration_status'),
        operating_status: text(formData, 'operating_status'),
        last_inspection_on: text(formData, 'last_inspection_on'),
        immediate_available: text(formData, 'immediate_available') === 'on',
        transportable: text(formData, 'transportable') === 'on',
        supply_72h: text(formData, 'supply_72h') === 'on',
        supply_7d: text(formData, 'supply_7d') === 'on',
        location_prefecture: text(formData, 'location_prefecture'),
        location_municipality: text(formData, 'location_municipality'),
        note: text(formData, 'note'),
      },
      todayJst()
    );
    const store = await getCaseFlowStore();
    await store.saveStockLedgerEntry(user, uuid(formData, 'unit_id'), input, intOrNull(formData, 'expected_lock_version'));
    revalidatePath('/admin/stock-ledger');
  } catch (e) {
    redirect(`/admin/stock-ledger?error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect('/admin/stock-ledger?done=saved');
}

// ---------- 設置予定地・土地（フェーズ3） ----------

export async function saveSiteProfileAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const configurationId = uuid(formData, 'configuration_id');
    const input = siteProfileInputFromForm(formData);
    if (!input) throw new CaseFlowValidationError('土地の有無を選んでください');
    const store = await getCaseFlowStore();
    await store.saveSiteProfile(user, configurationId, input, intOrNull(formData, 'expected_lock_version'));
    revalidatePath(`/mypage/configurations/${configurationId}/land`);
    revalidatePath(`/mypage/configurations/${configurationId}/request-quote`);
    revalidatePath('/mypage', 'layout');
    return { ok: true, message: '設置予定地・土地の情報を保存しました。見積を依頼すると、担当の代理店にも伝わります。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// ---------- 写真・書類 ----------

export async function uploadCaseFileAction(_prev: CaseFlowActionState, formData: FormData): Promise<CaseFlowActionState> {
  const user = await actor('/mypage');
  try {
    const requestId = uuid(formData, 'request_id');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) throw new CaseFlowValidationError('ファイルを選んでください');
    const input = normalizeCaseFileInput({
      context: text(formData, 'context'),
      context_id: text(formData, 'context_id'),
      file_name: file.name || 'file',
      content_type: file.type,
      size_bytes: file.size,
      caption: text(formData, 'caption'),
      customer_visible: text(formData, 'customer_visible') === 'on',
    });
    const store = await getCaseFlowStore();
    await store.uploadCaseFile(user, requestId, input, new Uint8Array(await file.arrayBuffer()));
    revalidateCase(text(formData, 'quote_id') || null, requestId);
    return { ok: true, message: 'ファイルを登録しました。' };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deleteCaseFileAction(formData: FormData): Promise<void> {
  const user = await actor('/mypage');
  const back = text(formData, 'back');
  const safeBack = back.startsWith('/admin/') || back.startsWith('/mypage') ? back : '/mypage';
  try {
    const store = await getCaseFlowStore();
    await store.deleteCaseFile(user, uuid(formData, 'file_id'));
    revalidateCase(text(formData, 'quote_id') || null, text(formData, 'request_id') || null);
  } catch (e) {
    redirect(`${safeBack}${safeBack.includes('?') ? '&' : '?'}error=${encodeURIComponent(errorMessage(e))}`);
  }
  redirect(safeBack);
}
