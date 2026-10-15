'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { requireCatalogEditor } from '@/lib/auth/session';
import { CATALOG_TAG } from '@/lib/data/public-catalog';
import { getStore, isLocalMode, type OptionInput } from '@/lib/data/store';
import type { ProductLifecycleOption } from '@/lib/domain/product-lifecycle';
import { createClient } from '@/lib/supabase/server';

function optionIdFrom(formData: FormData): string {
  const value = String(formData.get('option_id') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('商品IDが正しくありません。');
  }
  return value;
}

function refreshOptionPages(optionId: string) {
  updateTag(CATALOG_TAG);
  revalidatePath('/admin/ledger');
  revalidatePath(`/admin/options/${optionId}`);
  revalidatePath('/admin/estimate-templates');
  revalidatePath('/admin/quotes/new');
}

async function patchLocalOption(optionId: string, patch: Partial<ProductLifecycleOption>) {
  const store = await getStore();
  const option = (await store.getOption(optionId)) as ProductLifecycleOption | null;
  if (!option) throw new Error('商品が見つかりません。');
  const {
    created_at: _createdAt,
    updated_at: _updatedAt,
    gallery_images: _galleryImages,
    ...input
  } = option;
  await store.upsertOption({ ...input, ...patch } as OptionInput);
}

async function assertArchiveDoesNotBreakCurrentStandard(optionId: string, optionCode: string) {
  const db = await createClient();

  const baselineResult = await db
    .from('standard_estimate_revision_baseline_items')
    .select('revision_id')
    .eq('option_id', optionId);
  if (baselineResult.error) throw new Error('標準見積の使用状況を確認できませんでした。');
  const revisionIds = [...new Set((baselineResult.data ?? []).map((row) => row.revision_id).filter(Boolean))];
  if (revisionIds.length) {
    const currentResult = await db
      .from('standard_estimate_masters')
      .select('id')
      .in('current_published_revision_id', revisionIds)
      .limit(1);
    if (currentResult.error) throw new Error('標準見積の使用状況を確認できませんでした。');
    if ((currentResult.data ?? []).length) {
      throw new Error('現在公開中の標準見積で使用中の商品です。先に新しい標準見積の版で商品を差し替えてから取扱終了にしてください。');
    }
  }

  // legacy標準見積も、現在なお管理画面・互換処理から参照され得るため黙って候補から外さない。
  const legacyTemplateResult = await db.from('estimate_templates').select('id, baseline_option_ids');
  if (legacyTemplateResult.error) throw new Error('標準見積の使用状況を確認できませんでした。');
  const usedByLegacyTemplate = (legacyTemplateResult.data ?? []).some((template) =>
    Array.isArray(template.baseline_option_ids) && template.baseline_option_ids.includes(optionId)
  );
  if (usedByLegacyTemplate) {
    throw new Error('既存の標準見積で使用中の商品です。標準見積側の差し替えを確認してから取扱終了にしてください。');
  }

  const dependencyResult = await db
    .from('option_dependencies')
    .select('id')
    .eq('requires_option_id', optionId)
    .limit(1);
  if (dependencyResult.error) throw new Error('商品の依存関係を確認できませんでした。');
  if ((dependencyResult.data ?? []).length) {
    throw new Error('ほかの商品がこの商品を必要条件として使用しています。依存関係を整理してから取扱終了にしてください。');
  }

  const presetResult = await db.from('base_models').select('presets');
  if (presetResult.error) throw new Error('本体の標準構成を確認できませんでした。');
  const usedByPreset = (presetResult.data ?? []).some((model) => {
    const presets = Array.isArray(model.presets) ? model.presets : [];
    return presets.some((preset) => {
      if (!preset || typeof preset !== 'object') return false;
      const codes = Array.isArray((preset as { option_codes?: unknown }).option_codes)
        ? ((preset as { option_codes: unknown[] }).option_codes)
        : [];
      return codes.includes(optionCode);
    });
  });
  if (usedByPreset) {
    throw new Error('本体の標準構成で使用中の商品です。先に標準構成を差し替えてから取扱終了にしてください。');
  }
}

export async function setOptionSimulatorVisibilityAction(formData: FormData): Promise<void> {
  const optionId = optionIdFrom(formData);
  await requireCatalogEditor(`/admin/options/${optionId}`);
  const simulatorVisible = formData.get('simulator_visible') === 'on';

  if (isLocalMode()) {
    await patchLocalOption(optionId, { simulator_visible: simulatorVisible });
  } else {
    const db = await createClient();
    const { data, error } = await db
      .from('options')
      .update({ simulator_visible: simulatorVisible })
      .eq('id', optionId)
      .eq('status', 'published')
      .select('id')
      .maybeSingle();
    if (error) throw new Error('シミュレーター表示設定を保存できませんでした。DB反映状況を確認してください。');
    if (!data) throw new Error('登録済みの商品だけシミュレーター表示を変更できます。');
  }

  refreshOptionPages(optionId);
}

export async function endOptionHandlingAction(formData: FormData): Promise<void> {
  const optionId = optionIdFrom(formData);
  await requireCatalogEditor(`/admin/options/${optionId}`);

  if (isLocalMode()) {
    const store = await getStore();
    const option = (await store.getOption(optionId)) as ProductLifecycleOption | null;
    if (!option || option.status !== 'published') throw new Error('登録済みの商品だけ取扱終了にできます。');
    await patchLocalOption(optionId, { archived_at: new Date().toISOString() });
  } else {
    const db = await createClient();
    const current = await db.from('options').select('id, code, status, archived_at').eq('id', optionId).maybeSingle();
    if (current.error) throw new Error('商品の状態を確認できませんでした。');
    if (!current.data || current.data.status !== 'published') throw new Error('登録済みの商品だけ取扱終了にできます。');
    if (current.data.archived_at) {
      refreshOptionPages(optionId);
      return;
    }

    await assertArchiveDoesNotBreakCurrentStandard(optionId, current.data.code);

    const { error } = await db.from('options').update({ archived_at: new Date().toISOString() }).eq('id', optionId);
    if (error) throw new Error('取扱終了を保存できませんでした。DB反映状況を確認してください。');
  }

  refreshOptionPages(optionId);
}

export async function resumeOptionHandlingAction(formData: FormData): Promise<void> {
  const optionId = optionIdFrom(formData);
  await requireCatalogEditor(`/admin/options/${optionId}`);

  if (isLocalMode()) {
    const store = await getStore();
    const option = (await store.getOption(optionId)) as ProductLifecycleOption | null;
    if (!option || option.status !== 'published') throw new Error('登録済みの商品だけ取扱を再開できます。');
    await patchLocalOption(optionId, { archived_at: null });
  } else {
    const db = await createClient();
    const { data, error } = await db
      .from('options')
      .update({ archived_at: null })
      .eq('id', optionId)
      .eq('status', 'published')
      .select('id')
      .maybeSingle();
    if (error) throw new Error('取扱再開を保存できませんでした。DB反映状況を確認してください。');
    if (!data) throw new Error('登録済みの商品だけ取扱を再開できます。');
  }

  refreshOptionPages(optionId);
}
