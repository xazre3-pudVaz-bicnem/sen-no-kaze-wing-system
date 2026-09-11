import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { BASE_ESTIMATE_SPEC_CODE, estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { formatYen } from '@/lib/domain/pricing';
import { Alert } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { BaseBreakdownForm } from '@/components/admin/base-breakdown-form';
import { EstimateTemplateImportForm } from '@/components/admin/estimate-template-import-form';
import { cn } from '@/lib/utils';

/**
 * 標準見積Excelと本体明細の管理。
 * 標準見積の価格源はExcel。preset＋商品価格から標準見積を再構成しない。
 * 本体明細だけは base_breakdown_items を正本として従来どおり編集できる。
 */
export default async function BaseBreakdownPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCatalogEditor();
  const sp = await searchParams;
  const store = await getStore();
  const [models, allItems, allTemplates] = await Promise.all([
    store.listModels({ includeDraft: true }),
    store.listBaseBreakdownItems(),
    store.listEstimateTemplates(),
  ]);

  const model = models.find((m) => m.id === sp.model) ?? models[0];
  const imported = allTemplates
    .filter((row) => row.base_model_id === model?.id)
    .sort((a, b) => {
      const order = new Map([
        ['base', 0],
        ['hotel', 1],
        ['residence', 2],
        ['office', 3],
      ]);
      return (order.get(a.spec_code) ?? 99) - (order.get(b.spec_code) ?? 99) || a.spec_code.localeCompare(b.spec_code);
    });
  const fallback = model ? estimateTemplatesFor(model) : [];
  const tabs =
    imported.length > 0
      ? imported.map((row) => ({ code: row.spec_code, name: row.name }))
      : fallback.map((row) => ({ code: row.code, name: row.name }));
  const specCode = tabs.some((row) => row.code === sp.spec) ? (sp.spec as string) : (tabs[0]?.code ?? BASE_ESTIMATE_SPEC_CODE);
  const specName = tabs.find((row) => row.code === specCode)?.name ?? specCode;
  const template = imported.find((row) => row.spec_code === specCode);
  const templateBundle = model && template ? await store.getEstimateTemplateBundle(model.id, specCode) : null;
  const baseSection = templateBundle?.sections.find((row) => row.code === 'base') ?? null;
  const items = allItems.filter((row) => row.base_model_id === model?.id && row.spec_code === specCode);
  const rate = model?.expense_rate ?? 0.15;
  const baseLines = items.reduce((sum, row) => sum + row.amount, 0);

  return (
    <AdminPage
      title="標準見積・本体内訳"
      lead="実物の分類表見積Excelを価格の正本として管理します。本体明細は本体内訳マスター、内外装工事・オプション・別途は標準見積テンプレートとして保持します。"
    >
      <EstimateTemplateImportForm />

      {sp.saved && <Alert tone="success">保存しました。新しく作られる見積から反映されます。</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {models.map((m) => (
          <Link
            key={m.id}
            href={`/admin/base-breakdown?model=${m.id}`}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium',
              m.id === model?.id ? 'border-brown bg-brown text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
            )}
          >
            {m.name}
          </Link>
        ))}
        <span className="mx-2 text-muted">／</span>
        {tabs.map((row) => (
          <Link
            key={row.code}
            href={`/admin/base-breakdown?model=${model?.id}&spec=${row.code}`}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium',
              row.code === specCode ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
            )}
            data-testid={`breakdown-spec-${row.code}`}
          >
            {row.name}
          </Link>
        ))}
      </div>

      {model && imported.length === 0 && (
        <Alert tone="warn">
          この本体には標準見積Excelがまだ登録されていません。上の「標準見積Excelの取込」で、まず検算してから登録してください。
        </Alert>
      )}

      {template && (
        <section className="card grid gap-3 p-5 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">標準見積</p>
            <p className="font-semibold">{model?.name}／{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Excel原本</p>
            <p className="font-semibold">{template.source_sheet_name}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs text-muted">標準見積 税込合計</p>
            <p className="font-serif text-xl tabular-nums">{formatYen(template.total)}</p>
          </div>
        </section>
      )}

      {model && (
        <>
          <div>
            <h2 className="font-semibold">本体明細</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {model.name}／{specName}：{items.length} 行・本体明細 {formatYen(baseLines)}
              （本体諸費用{Math.round(rate * 100)}%は標準見積Excelの検算対象です）
            </p>
          </div>
          <BaseBreakdownForm
            key={`${model.id}:${specCode}`}
            modelId={model.id}
            specCode={specCode}
            items={items}
            expenseRate={rate}
            lockedByTemplate={Boolean(template)}
            expenseAmountOverride={baseSection?.expense_amount}
            totalOverride={baseSection?.total}
          />
          <Alert tone="info">
            標準見積はExcel原本を正本として固定します。標準見積そのものは直接編集せず、変更時はExcelを修正して再取込します。
            案件ごとの見積は標準見積をコピーした後、代理店以上が管理画面で編集できる設計です。
          </Alert>
        </>
      )}
    </AdminPage>
  );
}
