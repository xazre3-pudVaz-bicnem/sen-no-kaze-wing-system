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
import { EstimateTemplateExcelDemo } from '@/components/admin/estimate-template-excel-demo';

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
}) {
  if (templates.length === 0) {
    return (
      <button type="button" className="btn-secondary btn-sm" disabled>
        作成済み見積書（0件）
      </button>
    );
  }

  return (
    <details className="relative">
      <summary className="btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        作成済み見積書（{templates.length}件）
      </summary>
      <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-[min(92vw,42rem)] overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-xl">
        <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
          <div>
            <p className="text-sm font-semibold">作成済み見積書</p>
            <p className="mt-0.5 text-[11px] text-muted">開く見積書を選択します。</p>
          </div>
          <span className="text-[11px] text-muted">{templates.length}件</span>
        </div>
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

  const selectedTemplate =
    templates.find((template) => template.id === sp.estimate) ??
    templates[0] ??
    null;

  if (!selectedTemplate) {
    return (
      <AdminPage
        title="見積書作成・管理"
        lead="見積書を開いたらすぐ、Excelに近い明細編集から作業を始めます。"
        actions={
          <div className="flex flex-wrap gap-2">
            <SavedEstimateMenu templates={templates} models={models} />
            <Link href="/admin/estimate-templates/new" className="btn-primary btn-sm">
              ＋ 新しい見積書を作成
            </Link>
          </div>
        }
      >
        <Alert tone="info">
          現在は正式な見積書データが未登録のため、作成画面を直接表示しています。
          画面内の変更はまだDBへ保存されません。
        </Alert>
        <EstimateTemplateExcelDemo />
      </AdminPage>
    );
  }

  const [bundle, catalogBundle] = await Promise.all([
    store.getEstimateTemplateBundle(selectedTemplate.base_model_id, selectedTemplate.spec_code),
    store.getCatalogBundle(selectedTemplate.base_model_id),
  ]);

  const model = models.find((row) => row.id === selectedTemplate.base_model_id) ?? null;
  const categoryMap = new Map(categories.map((category) => [category.id, category] as const));

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
          右上の「作成済み見積書」から別の見積書を開けます。
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
      lead="開いたらすぐ明細を編集できる、Excelに近い見積書作成画面です。"
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
            title="正式見積書の標準指定接続後に利用できます"
          >
            この見積書を標準に設定
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

          <span className="text-xs text-muted">別の見積書は右上の「作成済み見積書」から開けます。</span>
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
