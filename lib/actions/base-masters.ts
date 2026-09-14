'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireCatalogEditor } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

export interface BaseMasterActionState {
  ok: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const createSchema = z.object({
  base_model_id: z.uuid(),
  owner_organization_id: z.uuid(),
  name: z.string().trim().min(1, '本体名を入力してください').max(120),
  fire_spec_code: z.enum(['non_fire', 'fire']),
});

const lineSchema = z.object({
  line_key: z.preprocess((v) => (v === '' || v == null ? null : v), z.uuid().nullable()),
  section: z.string().trim().min(1, '工事区分を入力してください').max(80),
  name: z.string().trim().min(1, '品名を入力してください').max(160),
  quantity: z.coerce.number().gt(0).max(999999),
  unit: z.string().trim().max(20).nullable().optional(),
  unit_price: z.coerce.number().int().min(0).max(100_000_000),
  remark: z.string().trim().max(300).nullable().optional(),
});

const saveSchema = z.object({
  revision_id: z.uuid(),
  master_id: z.uuid(),
  name: z.string().trim().min(1, '本体名を入力してください').max(120),
  fire_spec_code: z.enum(['non_fire', 'fire']),
  expense_method: z.enum(['rate', 'fixed', 'none']),
  expense_rate_percent: z.coerce.number().min(0).max(100),
  expense_amount: z.coerce.number().int().min(0).max(100_000_000),
  lines: z.array(lineSchema).max(500),
});

function collectErrors(error: z.ZodError): Record<string, string[] | undefined> {
  const out: Record<string, string[] | undefined> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function fail(message: string): BaseMasterActionState {
  return { ok: false, error: message };
}

function dbFail(error: { message?: string | null } | null): BaseMasterActionState {
  const raw = error?.message?.trim() || '処理中にエラーが発生しました。';
  return fail(raw.replace(/^(VALIDATION|FORBIDDEN|LOCKED|NOT_FOUND):\s*/i, ''));
}

function localUnavailable(): BaseMasterActionState | null {
  return isLocalMode() ? fail('本体マスターのRevision機能はSupabase接続環境で利用できます。') : null;
}

export async function createBaseMasterDraftAction(
  _prev: BaseMasterActionState,
  formData: FormData
): Promise<BaseMasterActionState> {
  await requireCatalogEditor('/admin/base-masters');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;

  const parsed = createSchema.safeParse({
    base_model_id: formData.get('base_model_id'),
    owner_organization_id: formData.get('owner_organization_id'),
    name: formData.get('name'),
    fire_spec_code: formData.get('fire_spec_code'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: collectErrors(parsed.error) };

  const supabase = await createClient();
  const { data: revisionId, error } = await supabase.rpc('create_base_master_draft', {
    p_base_model_id: parsed.data.base_model_id,
    p_owner_organization_id: parsed.data.owner_organization_id,
    p_name: parsed.data.name,
    p_fire_spec_code: parsed.data.fire_spec_code,
    p_cloned_from_revision_id: null,
  });
  if (error || !revisionId) return dbFail(error);

  const { data: revision, error: revisionError } = await supabase
    .from('base_master_revisions')
    .select('base_master_id')
    .eq('id', revisionId)
    .maybeSingle();
  if (revisionError || !revision?.base_master_id) return dbFail(revisionError);

  revalidatePath('/admin/base-masters');
  redirect(`/admin/base-masters/${revision.base_master_id}?created=1`);
}

export async function startBaseMasterDraftAction(
  _prev: BaseMasterActionState,
  formData: FormData
): Promise<BaseMasterActionState> {
  await requireCatalogEditor('/admin/base-masters');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;

  const masterId = String(formData.get('master_id') ?? '');
  if (!z.uuid().safeParse(masterId).success) return fail('本体IDが不正です。');

  const supabase = await createClient();
  const { error } = await supabase.rpc('start_base_master_draft', { p_base_master_id: masterId });
  if (error) return dbFail(error);

  revalidatePath(`/admin/base-masters/${masterId}`);
  redirect(`/admin/base-masters/${masterId}?draft=1`);
}

export async function saveBaseMasterDraftAction(
  _prev: BaseMasterActionState,
  formData: FormData
): Promise<BaseMasterActionState> {
  await requireCatalogEditor('/admin/base-masters');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;

  let lines: unknown = [];
  try {
    lines = JSON.parse(String(formData.get('lines_json') ?? '[]'));
  } catch {
    return fail('明細の読み取りに失敗しました。');
  }

  const parsed = saveSchema.safeParse({
    revision_id: formData.get('revision_id'),
    master_id: formData.get('master_id'),
    name: formData.get('name'),
    fire_spec_code: formData.get('fire_spec_code'),
    expense_method: formData.get('expense_method'),
    expense_rate_percent: formData.get('expense_rate_percent') || 0,
    expense_amount: formData.get('expense_amount') || 0,
    lines,
  });
  if (!parsed.success) return { ok: false, fieldErrors: collectErrors(parsed.error) };

  const expenseRate = parsed.data.expense_method === 'rate'
    ? parsed.data.expense_rate_percent / 100
    : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_base_master_draft', {
    p_revision_id: parsed.data.revision_id,
    p_name: parsed.data.name,
    p_fire_spec_code: parsed.data.fire_spec_code,
    p_expense_method: parsed.data.expense_method,
    p_expense_rate: expenseRate,
    p_expense_amount: parsed.data.expense_method === 'fixed' ? parsed.data.expense_amount : 0,
    p_lines: parsed.data.lines,
  });
  if (error) return dbFail(error);

  revalidatePath('/admin/base-masters');
  revalidatePath(`/admin/base-masters/${parsed.data.master_id}`);
  redirect(`/admin/base-masters/${parsed.data.master_id}?saved=1`);
}

export async function publishBaseMasterDraftAction(
  _prev: BaseMasterActionState,
  formData: FormData
): Promise<BaseMasterActionState> {
  await requireCatalogEditor('/admin/base-masters');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;

  const revisionId = String(formData.get('revision_id') ?? '');
  const masterId = String(formData.get('master_id') ?? '');
  if (!z.uuid().safeParse(revisionId).success || !z.uuid().safeParse(masterId).success) {
    return fail('本体またはDraft IDが不正です。');
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_base_master_draft', { p_revision_id: revisionId });
  if (error) return dbFail(error);

  revalidatePath('/admin/base-masters');
  revalidatePath(`/admin/base-masters/${masterId}`);
  redirect(`/admin/base-masters/${masterId}?published=1`);
}

export async function discardBaseMasterDraftAction(
  _prev: BaseMasterActionState,
  formData: FormData
): Promise<BaseMasterActionState> {
  await requireCatalogEditor('/admin/base-masters');
  const unavailable = localUnavailable();
  if (unavailable) return unavailable;

  const revisionId = String(formData.get('revision_id') ?? '');
  if (!z.uuid().safeParse(revisionId).success) return fail('Draft IDが不正です。');

  const supabase = await createClient();
  const { error } = await supabase.rpc('discard_base_master_draft', { p_revision_id: revisionId });
  if (error) return dbFail(error);

  revalidatePath('/admin/base-masters');
  redirect('/admin/base-masters?discarded=1');
}
