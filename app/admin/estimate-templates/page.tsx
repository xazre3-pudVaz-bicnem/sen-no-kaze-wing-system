import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';
import { EstimateTemplateDetailTabs } from '@/components/admin/estimate-template-detail-tabs';
import { StandardEstimateSimulatorPreview } from '@/components/admin/standard-estimate-simulator-preview';
import {
  EstimateTemplateExcelDemo,
  type EstimateTemplateExcelDemoProduct,
} from '@/components/admin/estimate-template-excel-demo';
import { ESTIMATE_DEMO_SAMPLES, estimateDemoSampleById } from '@/components/admin/estimate-template-demo-samples';

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅・単身者',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

const SECTION_LABELS = {
  interior_exterior: '内外装工事',
  option: 'オプション',
  sitework: '別途',
} as const;

type SectionCode = keyof typeof SECTION_LABELS;

function estimateHref(id: string) {
  const params = new URLSearchParams({ estimate: id });
  return `/admin/estimate-templates?${params.toString()}`;
}

function sampleEstimateHref(id: string) {
  const params = new URLSearchParams({ sample: id });
  return `/admin/estimate-templates?${params.toString()}`;
}

function formatWholeYen(value: number) {
  return formatYen(Math.round(value));
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function SavedEstimateMenu({
  templates,
  models,
  selectedId,
  selectedSampleId,
}: {
  templates: {
    id: string;
    name: string;
    base_model_id: string;
    spec_code: string;
    total: number;
    updated_at: string;
  }[];
  models: { id: string; name: string }[];
  selectedId?: string | null;
  selectedSampleId?: string | null;
}) {
  const totalCount = templates.length + ESTIMATE_DEMO_SAMPLES.length;

  return (
    <details className="relative">
      <summary className="btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        見積書一覧（{totalCount}件）
      </summary>
      <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-[min(92vw,42rem)] overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-xl">
        <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
          <div>
            <p className="text-sm font-semibold">見積書一覧</p>
            <p className="mt-0.5 text-[11px] text-muted">シミュレーターで選択できる標準見積と、作成済み見積書をここで確認します。</p>
          </div>
          <span className="text-[11px] text-muted">{totalCount}件</span>
        </div>

        <div className="mb-2 rounded-lg border border-line bg-sand/25 px-3 py-2">
          <p className="text-[10px] font-semibold tracking-wide text-muted">シミュレーター標準</p>
          <p className="mt-1 text-xs font-semibold">シミュレーターの選択対象</p>
          <p className="mt-0.5 text-[11px] text-muted">
            標準に指定された正式見積書だけを、見積シミュレーターの選択肢に表示します。初期表示を決める設定ではありません。現在は指定機能の接続準備中です。
          </p>
        </div>

        <div className="border-t border-line pt-2">
          <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted">作成済み見積書</p>
          {templates.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted">正式保存済みの見積書はまだありません。</p>
          )}
          {templates.length > 0 && (
          <div className="divide-y divide-line">
          {templates.map((template) => {
            const active = template.id === selectedId;
            const templateModel = models.find((item) => item.id === template.base_model_id);
            return (
              <Link
                key={template.id}
                href={estimateHref(template.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'grid gap-1 rounded-lg bg-forest/5 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                    : 'grid gap-1 rounded-lg px-3 py-2.5 text-sm hover:bg-sand/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                }
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{template.name}</span>
                    {active && <Badge tone="neutral">表示中</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {templateModel?.name ?? '—'} ／ {SPEC_LABELS[template.spec_code] ?? template.spec_code}
                    <span className="ml-2">更新 {formatUpdatedAt(template.updated_at)}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3 sm:justify-end">
                  <strong className="tabular-nums">{formatYen(template.total)}</strong>
                  <span className="text-xs font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                </span>
              </Link>
            );
          })}
          </div>
          )}
        </div>
        <div className="mt-2 border-t border-line pt-2">
          <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted">画面確認用サンプル</p>
          <div className="divide-y divide-line">
            {ESTIMATE_DEMO_SAMPLES.map((sample) => {
              const active = sample.id === selectedSampleId;
              return (
                <Link
                  key={sample.id}
                  href={sampleEstimateHref(sample.id)}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 'grid gap-1 rounded-lg bg-sky-50 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                      : 'grid gap-1 rounded-lg px-3 py-2.5 text-sm hover:bg-sand/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                  }
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{sample.name}</span>
                      <Badge tone="neutral">サンプル</Badge>
                      {active && <Badge tone="neutral">表示中</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {sample.model} ／ {sample.spec}
                      <span className="ml-2">Excel: {sample.sourceSheet}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 sm:justify-end">
                    <strong className="tabular-nums">{formatWholeYen(sample.sourceTotal)}</strong>
                    <span className="text-xs font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </details>
  );
}

export default async function EstimateTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireCatalogEditor('/admin/estimate-templates');
  const sp = await searchParams;
  const store = await getStore();

  const [models, templates, options, categories] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listEstimateTemplates(),
    store.listOptions(),
    store.listCategories(),
  ]);
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));
  const demoProducts: EstimateTemplateExcelDemoProduct[] = options
    .filter((option) => option.status === 'published')
    .map((option) => ({
      id: option.id,
      category: categoryMap.get(option.category_id)?.name ?? '未分類',
      categoryCode: categoryMap.get(option.category_id)?.code ?? '',
      name: option.name,
      manufacturer: option.manufacturer ?? '',
      modelNo: option.model_no ?? '',
      price: option.price,
      priceOnRequest: option.price_on_request,
      imageUrl: option.image_url,
    }));

  const selectedSample = estimateDemoSampleById(sp.sample);
  const selectedTemplate = selectedSample
    ? null
    : templates.find((template) => template.id === sp.estimate) ??
      templates[0] ??
      null;

  if (!selectedTemplate) {
    return (
      <AdminPage
        title="見積書作成・管理"
        actions={
          <div className="flex flex-wrap gap-2">
            <SavedEstimateMenu templates={templates} models={models} selectedSampleId={selectedSample?.id} />
            <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
              ＋ 新しい見積書を作成
            </Link>
          </div>
        }
      >
        <Alert tone="info">
          {selectedSample
            ? `「${selectedSample.sourceSheet}」を元にした画面確認用サンプルです。Excelの金額明細と別途見積項目を表示し、0円の未選択候補は除外しています。DBには保存されません。`
            : '現在は正式な見積書データが未登録のため、作成画面を直接表示しています。画面内の変更はまだDBへ保存されません。'}
        </Alert>
        <EstimateTemplateExcelDemo
          key={selectedSample?.id ?? 'new-estimate-demo'}
          sampleId={selectedSample?.id}
          products={demoProducts}
        />
      </AdminPage>
    );
  }

  const [bundle, catalogBundle] = await Promise.all([
    store.getEstimateTemplateBundle(selectedTemplate.base_model_id, selectedTemplate.spec_code),
    store.getCatalogBundle(selectedTemplate.base_model_id),
  ]);

  const model = models.find((row) => row.id === selectedTemplate.base_model_id) ?? null;

  if (!bundle) {
    return (
      <AdminPage
        title="見積書作成・管理"
        lead="見積書をExcelに近い操作感で作成・編集します。"
        actions={
          <div className="flex flex-wrap gap-2">
            <SavedEstimateMenu templates={templates} models={models} selectedId={selectedTemplate.id} />
            <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
              ＋ 新しい見積書を作成
            </Link>
          </div>
        }
      >
        <Alert tone="warn">選択した見積書の明細を読み込めませんでした。別の見積書を選択してください。</Alert>
        <section className="card p-4 text-sm text-muted">
          右上の「見積書一覧」から別の見積書を開けます。
        </section>
      </AdminPage>
    );
  }

  const baseSection = bundle.sections.find((section) => section.code === 'base');
  const baseTotal =
    baseSection?.total ??
    bundle.base_breakdown_items.reduce((sum, row) => sum + row.amount, 0);

  const sections: EstimateTemplateWorkbenchSection[] = (Object.keys(SECTION_LABELS) as SectionCode[]).map((code) => {
    const section = bundle.sections.find((row) => row.code === code);
    return {
      code,
      label: SECTION_LABELS[code],
      expenseLabel: section?.expense_label ?? null,
      expenseAmount: section?.expense_amount ?? 0,
    };
  });

  const initialLines: EstimateTemplateWorkbenchLine[] = bundle.lines.map((line) => ({
    id: line.id,
    section: line.section_code,
    groupLabel: line.group_label ?? '',
    name: line.name,
    quantity: line.quantity ?? 1,
    unit: line.unit ?? '',
    saleUnitPrice: line.unit_price ?? 0,
    remark: line.remark ?? '',
    source: 'legacy',
    customerSelection: '—',
  }));

  const products = options
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
    }));

  const returnSection =
    sp.return_section === 'interior_exterior' ||
    sp.return_section === 'option' ||
    sp.return_section === 'sitework'
      ? sp.return_section
      : undefined;

  const workspaceReturnPath = `/admin/estimate-templates?estimate=${selectedTemplate.id}`;

  const unavailablePreview = (
    <section className="card px-5 py-8 text-center">
      <p className="font-semibold">この見積書の表示データを準備中です</p>
      <p className="mt-1 text-sm text-muted">編集画面は利用できます。見積書・プランボード表示は正式接続後に確認できます。</p>
    </section>
  );

  return (
    <AdminPage
      title="見積書作成・管理"
      actions={
        <div className="flex flex-wrap gap-2">
          <SavedEstimateMenu templates={templates} models={models} selectedId={selectedTemplate.id} />
          <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
            ＋ 新しい見積書を作成
          </Link>
          <button type="button" className="btn-secondary btn-sm" disabled title="正式な複製保存の接続後に利用できます">
            複製
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled
            title="シミュレーターの選択対象となる標準指定の接続後に利用できます"
          >
            シミュレーター標準に設定
          </button>
        </div>
      }
    >
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-muted">編集中の見積書</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{selectedTemplate.name}</h2>
              <Badge tone="neutral">編集画面</Badge>
            </div>
          </div>

          <span className="text-xs text-muted">別の見積書は右上の「見積書一覧」から開けます。</span>
        </div>

        <div className="flex flex-wrap divide-x divide-line text-xs">
          <span className="px-4 py-2">商品 <strong className="ml-1">{model?.name ?? '—'}</strong></span>
          <span className="px-4 py-2">仕様 <strong className="ml-1">{SPEC_LABELS[selectedTemplate.spec_code] ?? selectedTemplate.spec_code}</strong></span>
          <span className="px-4 py-2">現在額 <strong className="ml-1">{formatYen(selectedTemplate.total)}</strong></span>
        </div>
      </section>

      <Alert tone="info">
        現在はExcel型編集画面をメイン画面として確認する段階です。画面内の明細変更はまだDBへ保存されません。
      </Alert>

      <EstimateTemplateDetailTabs
        editContent={
          <EstimateTemplateWorkbench
            templateId={selectedTemplate.id}
            role={actor.role}
            baseLines={bundle.base_breakdown_items.map((line) => ({
              id: line.id,
              section: line.section,
              name: line.name,
              quantity: line.quantity,
              unit: line.unit ?? '',
              unitPrice: line.unit_price,
              amount: line.amount,
              remark: line.remark ?? '',
            }))}
            baseTotal={baseTotal}
            initialLines={initialLines}
            sections={sections}
            products={products}
            createdOptionId={sp.created_option}
            returnSection={returnSection}
            returnPath={workspaceReturnPath}
            taxRate={selectedTemplate.tax_rate}
            adjustment={selectedTemplate.adjustment}
          />
        }
        estimateContent={
          catalogBundle ? (
            <StandardEstimateSimulatorPreview
              bundle={catalogBundle}
              specCode={selectedTemplate.spec_code}
              template={bundle}
              initialContentTab="estimate"
              showContentTabs={false}
              showEditLink={false}
              previewOnly
            />
          ) : unavailablePreview
        }
        planContent={
          catalogBundle ? (
            <StandardEstimateSimulatorPreview
              bundle={catalogBundle}
              specCode={selectedTemplate.spec_code}
              template={bundle}
              initialContentTab="plan"
              showContentTabs={false}
              showEditLink={false}
              previewOnly
            />
          ) : unavailablePreview
        }
      />
    </AdminPage>
  );
}
