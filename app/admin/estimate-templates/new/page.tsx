import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore, isLocalMode } from '@/lib/data/store';
import { createClient } from '@/lib/supabase/server';
import { AdminPage, BackLink } from '@/components/admin/ui';
import {
  NewEstimateTemplateForm,
  type EstimateBaseMasterChoice,
} from '@/components/admin/new-estimate-template-form';
import { BASE_BREAKDOWN_ITEMS, BASE_BREAKDOWN_TOTALS } from '@/lib/seed/base-breakdown';

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
      ? supabase.from('organizations').select('id, name').in('id', organizationIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (revisionError || lineError || organizationError) return { items: [], sourceReady: false };

  const revisionMap = new Map((revisions ?? []).map((revision) => [revision.id, revision] as const));
  const organizationMap = new Map((organizations ?? []).map((organization) => [organization.id, organization.name] as const));
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
      if (!revision) return [];
      return [{
        id: master.id,
        revisionId,
        revisionVersion: Number(revision.version),
        modelId: master.base_model_id,
        ownerName: organizationMap.get(master.owner_organization_id) ?? '—',
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

export default async function NewEstimateTemplatePage() {
  const actor = await requireCatalogEditor('/admin/estimate-templates/new');
  const store = await getStore();
  const [models, options, categories, baseMasterResult] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.listCategories(),
    loadPublishedBaseMasters(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));

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
      title="標準見積を新規作成"
      lead="基準本体を選び、仕様・適用地域を設定してExcel形式の明細編集へ進みます。"
    >
      <BackLink href="/admin/estimate-templates" label="標準見積一覧へ戻る" />

      <NewEstimateTemplateForm
        role={actor.role}
        models={models.map((model) => ({
          id: model.id,
          name: model.name,
          specs: model.presets.map((preset) => ({ code: preset.code, name: preset.name })),
        }))}
        baseMasters={baseMasterResult.items}
        baseMasterSourceReady={baseMasterResult.sourceReady}
        sampleBaseMaster={sampleBaseMaster}
        products={options
          .filter((option) => option.status === 'published')
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
