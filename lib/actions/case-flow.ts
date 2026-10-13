'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { StoreError, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { flushNotificationsSafely } from '@/lib/mail/send';
import {
  CaseFlowValidationError,
  normalizeAppointmentInput,
  normalizeCaseFileInput,
  normalizeCaseNoteInput,
  normalizeDealerProfileInput,
  normalizeSiteSurveyInput,
  SITE_LAND_FIELDS,
  SITE_LEGAL_FIELDS,
} from '@/lib/domain/case-flow';

/**
 * 案件の進行（フェーズ4〜7）の画面の操作。権限・状態の判定は DB（RPC・RLS）が正本で、ここでは入力の形だけを整える。
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
