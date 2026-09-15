'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';

function ensureAvailable() {
  if (isLocalMode()) {
    throw new Error('旧本体移行監査はSupabase接続環境で利用できます。');
  }
}

function errorMessage(error: { message?: string | null } | null) {
  return (error?.message ?? '処理に失敗しました。')
    .replace(/^(VALIDATION|FORBIDDEN|LOCKED|NOT_FOUND|STALE|CONFLICT):\s*/i, '');
}

function migrationUrl(batchId?: string, extra?: string) {
  const params = new URLSearchParams();
  if (batchId) params.set('batch', batchId);
  if (extra) params.set(extra, '1');
  const query = params.toString();
  return query ? `/admin/base-migration?${query}` : '/admin/base-migration';
}

export async function createLegacyBaseMigrationBatchAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const description = z.string().trim().max(300).catch('').parse(formData.get('description') ?? '');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_legacy_base_migration_batch', {
    p_description: description || null,
  });
  if (error || !data) {
    redirect(`/admin/base-migration?error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect(migrationUrl(String(data), 'created'));
}

const decisionVersionSchema = z.string().regex(/^\d+$/).transform(Number);

const mappingSchema = z.object({
  batch_id: z.uuid(),
  mapping_id: z.uuid(),
  expected_version: decisionVersionSchema,
  target_classification: z.enum(['base', 'interior_exterior', 'option', 'sitework', 'review']),
  target_group_label: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export async function setLegacyBaseMappingDecisionAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = mappingSchema.safeParse({
    batch_id: formData.get('batch_id'),
    mapping_id: formData.get('mapping_id'),
    expected_version: formData.get('expected_version'),
    target_classification: formData.get('target_classification'),
    target_group_label: formData.get('target_group_label') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect('/admin/base-migration?error=入力内容が不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_legacy_base_mapping_decision', {
    p_batch_id: parsed.data.batch_id,
    p_mapping_id: parsed.data.mapping_id,
    p_expected_version: parsed.data.expected_version,
    p_target_classification: parsed.data.target_classification,
    p_target_group_label: parsed.data.target_group_label || null,
    p_note: parsed.data.note || null,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data.batch_id)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect(migrationUrl(parsed.data.batch_id, 'saved'));
}

const specSchema = z.object({
  batch_id: z.uuid(),
  base_model_id: z.uuid(),
  legacy_spec_code: z.string().trim().min(1).max(80),
  expected_version: decisionVersionSchema,
  proposed_group_key: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(500).optional(),
});

export async function setLegacyBaseSpecMappingAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = specSchema.safeParse({
    batch_id: formData.get('batch_id'),
    base_model_id: formData.get('base_model_id'),
    legacy_spec_code: formData.get('legacy_spec_code'),
    expected_version: formData.get('expected_version'),
    proposed_group_key: formData.get('proposed_group_key'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) redirect('/admin/base-migration?error=仕様対応の入力内容が不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_legacy_base_spec_mapping', {
    p_batch_id: parsed.data.batch_id,
    p_base_model_id: parsed.data.base_model_id,
    p_legacy_spec_code: parsed.data.legacy_spec_code,
    p_expected_version: parsed.data.expected_version,
    p_proposed_group_key: parsed.data.proposed_group_key,
    p_reason: parsed.data.reason || null,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data.batch_id)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect(migrationUrl(parsed.data.batch_id, 'saved'));
}

const duplicateSchema = z.object({
  batch_id: z.uuid(),
  check_id: z.uuid(),
  expected_version: decisionVersionSchema,
  resolution: z.enum(['use_legacy', 'use_existing', 'keep_both', 'not_duplicate']),
});

export async function resolveLegacyEstimateDuplicateAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = duplicateSchema.safeParse({
    batch_id: formData.get('batch_id'),
    check_id: formData.get('check_id'),
    expected_version: formData.get('expected_version'),
    resolution: formData.get('resolution'),
  });
  if (!parsed.success) redirect('/admin/base-migration?error=重複候補の入力内容が不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('resolve_legacy_estimate_duplicate', {
    p_batch_id: parsed.data.batch_id,
    p_check_id: parsed.data.check_id,
    p_expected_version: parsed.data.expected_version,
    p_resolution: parsed.data.resolution,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data.batch_id)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect(migrationUrl(parsed.data.batch_id, 'saved'));
}

export async function finalizeLegacyBaseMigrationReviewAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = z.uuid().safeParse(formData.get('batch_id'));
  if (!parsed.success) redirect('/admin/base-migration?error=移行バッチIDが不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('finalize_legacy_base_migration_review', {
    p_batch_id: parsed.data,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect(migrationUrl(parsed.data, 'ready'));
}

export async function materializeLegacyBaseDraftsAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = z.uuid().safeParse(formData.get('batch_id'));
  if (!parsed.success) redirect('/admin/base-migration?error=移行バッチIDが不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('materialize_legacy_base_migration_drafts', {
    p_batch_id: parsed.data,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  revalidatePath('/admin/base-masters');
  redirect(migrationUrl(parsed.data, 'drafted'));
}

export async function cancelLegacyBaseMigrationBatchAction(formData: FormData): Promise<void> {
  await requireUser('/admin/base-migration');
  ensureAvailable();

  const parsed = z.uuid().safeParse(formData.get('batch_id'));
  if (!parsed.success) redirect('/admin/base-migration?error=移行バッチIDが不正です');

  const supabase = await createClient();
  const { error } = await supabase.rpc('cancel_legacy_base_migration_batch', {
    p_batch_id: parsed.data,
  });
  if (error) {
    redirect(`${migrationUrl(parsed.data)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath('/admin/base-migration');
  redirect('/admin/base-migration?cancelled=1');
}
