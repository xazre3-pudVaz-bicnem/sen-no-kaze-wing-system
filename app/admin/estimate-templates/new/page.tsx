import { notFound } from 'next/navigation';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { AdminPage, BackLink } from '@/components/admin/ui';
import {
  NewEstimateTemplateForm,
  type EstimateBaseMasterChoice,
  type InitialEstimateTarget,
  type StandardEstimateDraftInitialData,
} from '@/components/admin/new-estimate-template-form';
import { estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { BASE_BREAKDOWN_ITEMS, BASE_BREAKDOWN_TOTALS } from '@/lib/seed/base-breakdown';
import { LEGACY_FIRE_SPEC_CATEGORY_CODE } from '@/lib/domain/types';

async function loadPublishedBaseMasters(): Promise<{
  items: EstimateBaseMasterChoice[];
  sourceReady: boolean;
}> {
  if (isLocalMode()) return { items: [], sourceReady: false };

  const supabase = await createClient();
  const { data: masters, error: masterError } = await supabase
    .from('base_masters')
    .select('id, base_model_id, owner_organization_id, name, fire_spec_code, current_published_revision_id')
    .eq('status', 'active')
    .not('current_published_revision_id', 'is', null)
    .order('name');

  if (masterError) return { items: [], sourceReady: false };

  const masterRows = masters ?? [];
  const revisionIds = masterRows
    .map((master) => master.current_published_revision_id)
    .filter((id): id is string => Boolean(id));

  if (revisionIds.length === 0) return { items: [], sourceReady: true };

  const organizationIds = [...new Set(masterRows.map((master) => master.owner_organization_id))];
  const [
    { data: revisions, error: revisionError },
    { data: lines, error: lineError },
    { data: organizations, error: organizationError },
  ] = await Promise.all([
    supabase
      .from('base_master_revisions')
      .select('id, base_master_id, version, status, line_subtotal, expense_amount, total')
      .in('id', revisionIds)
      .eq('status', 'published'),
    supabase
      .from('base_master_revision_lines')
      .select('id, revision_id, section, name, quantity, unit, unit_price, amount, remark, sort_order')
      .in('revision_id', revisionIds)
      .order('sort_order'),
    organizationIds.length
      ? supabase.from('organizations').select('id, name, organization_type, status').in('id', organizationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (revisionError || lineError || organizationError) return { items: [], sourceReady: false };

  const revisionMap = new Map((revisions ?? []).map((revision) => [revision.id, revision] as const));
  const organizationMap = new Map(
    (organizations ?? []).map((organization) => [
      organization.id,
      {
        name: organization.name,
        type: organization.organization_type,
        status: organization.status,
      },
    ] as const)
  );
  const linesByRevision = new Map<string, EstimateBaseMasterChoice['lines']>();

  for (const raw of lines ?? []) {
    const revisionLines = linesByRevision.get(raw.revision_id) ?? [];
    revisionLines.push({
      id: raw.id,
      section: raw.section,
      name: raw.name,
      quantity: Number(raw.quantity),
      unit: raw.unit ?? '',
      unitPrice: Number(raw.unit_price),
      amount: Number(raw.amount),
      remark: raw.remark ?? '',
    });
    linesByRevision.set(raw.revision_id, revisionLines);
  }

  return {
    sourceReady: true,
    items: masterRows.flatMap((master) => {
      const revisionId = master.current_published_revision_id;
      if (!revisionId) return [];
      const revision = revisionMap.get(revisionId);
      const owner = organizationMap.get(master.owner_organization_id);
      if (!revision || owner?.type !== 'headquarters' || owner.status !== 'active') return [];
      return [{
        id: master.id,
        revisionId,
        revisionVersion: Number(revision.version),
        modelId: master.base_model_id,
        ownerName: owner.name ?? '—',
        name: master.name,
        fireSpec: master.fire_spec_code === 'fire' ? 'fire' as const : 'non_fire' as const,
        lineSubtotal: Number(revision.line_subtotal),
        expenseAmount: Number(revision.expense_amount),
        total: Number(revision.total),
        lines: linesByRevision.get(revisionId) ?? [],
      }];
    }),
  };
}

function customerSelectionLabel(code: string): string {
  if (code === 'standard_fixed') return '標準・固定';
  if (code === 'optional') return '任意オプション';
  if (code === 'hidden') return 'お客様には表示しない';
  if (code === 'standard_changeable') return '標準・変更可';
  return '—';
}

async function loadStandardEstimateDraft(revisionId: string): Promise<{
  draft: StandardEstimateDraftInitialData;
  baseMaster: EstimateBaseMasterChoice;
  target: InitialEstimateTarget;
} | null> {
  if (isLocalMode() || !revisionId) return null;

  const supabase = await createClient();
  const { data: revision, error: revisionError } = await supabase
    .from('standard_estimate_revisions')
    .select(
      'id, standard_estimate_master_id, base_master_revision_id, status, tax_rate, standard_adjustment_amount, standard_adjustment_reason, lock_version'
    )
    .eq('id', revisionId)
    .eq('status', 'draft')
    .maybeSingle();

  if (revisionError || !revision) return null;

  const { data: master, error: masterError } = await supabase
    .from('standard_estimate_masters')
    .select('id, owner_organization_id, base_model_id, base_master_id, spec_code, name, status')
    .eq('id', revision.standard_estimate_master_id)
    .eq('status', 'active')
    .maybeSingle();

  if (masterError || !master) return null;

  const [
    { data: baseMaster, error: baseMasterError },
    { data: baseRevision, error: baseRevisionError },
    { data: baseLines, error: baseLinesError },
    { data: draftLines, error: draftLinesError },
  ] = await Promise.all([
    supabase
      .from('base_masters')
      .select('id, base_model_id, owner_organization_id, name, fire_spec_code, status')
      .eq('id', master.base_master_id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('base_master_revisions')
      .select('id, base_master_id, version, status, line_subtotal, expense_amount, total')
      .eq('id', revision.base_master_revision_id)
      .in('status', ['published', 'superseded'])
      .maybeSingle(),
    supabase
      .from('base_master_revision_lines')
      .select('id, revision_id, section, name, quantity, unit, unit_price, amount, remark, sort_order')
      .eq('revision_id', revision.base_master_revision_id)
      .order('sort_order'),
    supabase
      .from('standard_estimate_revision_lines')
      .select(
        'id, line_key, section_code, group_label, name, quantity, unit, unit_price, amount, remark, sort_order, source_kind, option_id, customer_selection'
      )
      .eq('revision_id', revision.id)
      .order('sort_order'),
  ]);

  if (
    baseMasterError ||
    baseRevisionError ||
    baseLinesError ||
    draftLinesError ||
    !baseMaster ||
    !baseRevision ||
    baseMaster.id !== master.base_master_id ||
    baseRevision.base_master_id !== baseMaster.id ||
    baseMaster.base_model_id !== master.base_model_id
  ) {
    return null;
  }

  const { data: owner, error: ownerError } = await supabase
    .from('organizations')
    .select('id, name, organization_type, status')
    .eq('id', master.owner_organization_id)
    .eq('organization_type', 'headquarters')
    .eq('status', 'active')
    .maybeSingle();

  if (
    ownerError ||
    !owner ||
    baseMaster.owner_organization_id !== owner.id
  ) {
    return null;
  }

  const fireSpec = baseMaster.fire_spec_code === 'fire' ? 'fire' as const : 'non_fire' as const;

  return {
    target: {
      modelId: master.base_model_id,
      specCode: master.spec_code,
      fireSpec,
    },
    baseMaster: {
      id: baseMaster.id,
      revisionId: baseRevision.id,
      revisionVersion: Number(baseRevision.version),
      modelId: baseMaster.base_model_id,
      ownerName: owner.name,
      name: baseMaster.name,
      fireSpec,
      lineSubtotal: Number(baseRevision.line_subtotal),
      expenseAmount: Number(baseRevision.expense_amount),
      total: Number(baseRevision.total),
      lines: (baseLines ?? []).map((line) => ({
        id: line.id,
        section: line.section,
        name: line.name,
        quantity: Number(line.quantity),
        unit: line.unit ?? '',
        unitPrice: Number(line.unit_price),
        amount: Number(line.amount),
        remark: line.remark ?? '',
      })),
    },
    draft: {
      revisionId: revision.id,
      lockVersion: Number(revision.lock_version),
      name: master.name,
      modelId: master.base_model_id,
      baseMasterId: master.base_master_id,
      baseMasterRevisionId: revision.base_master_revision_id,
      specCode: master.spec_code,
      taxRate: Number(revision.tax_rate),
      adjustment: Number(revision.standard_adjustment_amount),
      adjustmentReason: revision.standard_adjustment_reason ?? '',
      lines: (draftLines ?? []).map((line) => ({
        id: line.id,
        lineKey: line.line_key,
        optionId: line.option_id,
        section: line.section_code,
        groupLabel: line.group_label ?? '',
        name: line.name,
        quantity: Number(line.quantity),
        unit: line.unit ?? '',
        saleUnitPrice: Number(line.unit_price),
        remark: line.remark ?? '',
        source: line.source_kind === 'product' ? 'product' as const : 'free' as const,
        customerSelection: customerSelectionLabel(line.customer_selection),
      })),
    },
  };
}

export default async function NewEstimateTemplatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireCatalogEditor('/admin/estimate-templates/new');
  const sp = await searchParams;
  const store = await getStore();
  const draftId = (sp.draft ?? '').trim();
  const [models, options, categories, baseMasterResult, draftResult] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.listCategories(),
    loadPublishedBaseMasters(),
    draftId ? loadStandardEstimateDraft(draftId) : Promise.resolve(null),
  ]);

  if (draftId && !draftResult) notFound();
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));

  const requestedModel = models.find((model) => model.id === sp.model) ?? null;
  const requestedSpec =
    requestedModel
      ? estimateTemplatesFor(requestedModel).find((item) => item.code === sp.spec) ?? null
      : null;
  const requestedFire =
    sp.fire === 'fire' || sp.fire === 'non_fire' ? sp.fire : null;
  const initialTarget: InitialEstimateTarget | null =
    draftResult?.target ??
    (requestedModel && requestedSpec && requestedFire
      ? {
          modelId: requestedModel.id,
          specCode: requestedSpec.code,
          fireSpec: requestedFire,
        }
      : null);

  const baseMasters = draftResult
    ? [
        draftResult.baseMaster,
        ...baseMasterResult.items.filter((item) => item.id !== draftResult.baseMaster.id),
      ]
    : baseMasterResult.items;

  const sampleWing = models.find((model) => model.slug === 'wing-01') ?? null;
  const sampleTotals = BASE_BREAKDOWN_TOTALS['wing-01:hotel'] ?? null;
  const sampleBaseMaster: EstimateBaseMasterChoice | null =
    sampleWing && sampleTotals
      ? {
          id: 'sample-wing-hotel-base',
          revisionId: 'sample-wing-hotel-revision',
          revisionVersion: 0,
          modelId: sampleWing.id,
          ownerName: '画面確認用・保存なし',
          name: 'Wing ホテル仕様（画面確認用）',
          fireSpec: 'non_fire',
          lineSubtotal: sampleTotals.lines,
          expenseAmount: sampleTotals.expense,
          total: sampleTotals.total,
          lines: BASE_BREAKDOWN_ITEMS
            .filter((line) => line.model_slug === 'wing-01' && line.spec_code === 'hotel')
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((line) => ({
              id: 'sample-' + line.id,
              section: line.section,
              name: line.name,
              quantity: line.quantity,
              unit: line.unit ?? '',
              unitPrice: line.unit_price,
              amount: line.amount,
              remark: line.remark ?? '',
            })),
        }
      : null;

  return (
    <AdminPage
      title={draftResult ? '見積書の下書きを編集' : '見積書を新規作成'}
      lead={
        draftResult
          ? '保存済みの下書きを編集します。基準本体Revisionと用途・仕様は固定されています。'
          : '基準本体を選び、仕様・適用地域を設定してExcel形式の明細編集へ進みます。'
      }
    >
      <BackLink href="/admin/estimate-templates" label="見積書作成・管理へ戻る" />

      <NewEstimateTemplateForm
        role={actor.role}
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          specs: estimateTemplatesFor(model).map((item) => ({ code: item.code, name: item.name })),
        }))}
        baseMasters={baseMasters}
        baseMasterSourceReady={baseMasterResult.sourceReady || Boolean(draftResult)}
        sampleBaseMaster={sampleBaseMaster}
        initialTarget={initialTarget}
        initialDraft={draftResult?.draft ?? null}
        products={options
          .filter((option) => option.status === 'published' && categoryMap.get(option.category_id)?.code !== LEGACY_FIRE_SPEC_CATEGORY_CODE)
          .map((option) => ({
            id: option.id,
            categoryId: option.category_id,
            categoryCode: categoryMap.get(option.category_id)?.code ?? '',
            categoryName: categoryMap.get(option.category_id)?.name ?? '未分類',
            name: option.name,
            manufacturer: option.manufacturer ?? '',
            modelNo: option.model_no ?? '',
            sizeNote: option.size_note ?? '',
            price: option.price,
            priceOnRequest: option.price_on_request,
            imageUrl: option.image_url,
          }))}
      />
    </AdminPage>
  );
}
