import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { BASE_ESTIMATE_SPEC_CODE, estimateTemplatesFor } from '@/lib/domain/estimate-template';
import { formatYen } from '@/lib/domain/pricing';
import { buildPresetSelection } from '@/lib/domain/preset';
import { FREE_PRODUCT_CATEGORY_CODE } from '@/lib/domain/types';
import { Alert } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { BaseBreakdownForm } from '@/components/admin/base-breakdown-form';
import { OptionPriceSheet, type PriceSheetRow } from '@/components/admin/option-price-sheet';
import { cn } from '@/lib/utils';

/**
 * 本体内訳マスター（分類表見積書）。
 * 「本体のみ」は用途別 preset の省略形ではなく、専用の見積Excelを基準に独立管理する。
 * 用途別は本体内訳の下にオプション・別途工事も続け、分類表見積書と同じ形で確認する。
 */
export default async function BaseBreakdownPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCatalogEditor();
  const sp = await searchParams;
  const store = await getStore();
  const [models, allItems] = await Promise.all([store.listModels({ includeDraft: true }), store.listBaseBreakdownItems()]);

  const model = models.find((m) => m.id === sp.model) ?? models[0];
  const specs = model ? estimateTemplatesFor(model) : [];
  const specCode = specs.some((p) => p.code === sp.spec) ? (sp.spec as string) : (specs[0]?.code ?? BASE_ESTIMATE_SPEC_CODE);
  const specName = specs.find((p) => p.code === specCode)?.name ?? specCode;
  const items = allItems.filter((b) => b.base_model_id === model?.id && b.spec_code === specCode);
  const rate = model?.expense_rate ?? 0.15;
  const baseLines = items.reduce((s, b) => s + b.amount, 0);

  // 用途別標準見積だけ、本体の下に標準構成の「オプション」「別途工事」を続ける。
  // 「本体のみ」は用途別 preset を流用せず、本体見積Excel由来の内訳だけを表示する。
  let optionRows: PriceSheetRow[] = [];
  let siteworkRows: PriceSheetRow[] = [];
  if (model) {
    const bundle = await store.getCatalogBundle(model.id, { includeDraft: false });
    const preset = bundle?.model.presets?.find((p) => p.code === specCode);
    if (bundle && preset) {
      const ctx = { options: bundle.options, categories: bundle.categories, dependencies: bundle.dependencies, conflicts: bundle.conflicts };
      const ids = new Set(buildPresetSelection(ctx, preset));
      const catOf = new Map(bundle.categories.map((c) => [c.id, c]));
      const rows = bundle.options
        .filter((o) => ids.has(o.id))
        .map((o) => {
          const cat = catOf.get(o.category_id);
          return {
            id: o.id,
            name: o.name,
            category: cat?.name ?? 'その他',
            price: o.price,
            price_on_request: o.price_on_request,
            installation: o.is_installation || cat?.code === FREE_PRODUCT_CATEGORY_CODE,
          };
        });
      optionRows = rows.filter((r) => !r.installation);
      siteworkRows = rows.filter((r) => r.installation);
    }
  }

  return (
    <AdminPage
      title="本体内訳マスター"
      lead="実際の見積書を基準に、本体のみ／ホテル仕様／住宅仕様／事務所・店舗用を分けて管理します。ここを直すと、これから作られる見積に反映されます。"
    >
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
        {specs.map((p) => (
          <Link
            key={p.code}
            href={`/admin/base-breakdown?model=${model?.id}&spec=${p.code}`}
            className={cn(
              'rounded-full border px-4 py-1.5 text-sm font-medium',
              p.code === specCode ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
            )}
            data-testid={`breakdown-spec-${p.code}`}
          >
            {p.name}
          </Link>
        ))}
      </div>

      {specCode === BASE_ESTIMATE_SPEC_CODE && items.length === 0 && (
        <Alert tone="warn">
          「本体のみ」の見積内訳はまだ登録されていません。実際の「本体」見積Excelの内容を確認してから登録してください。
        </Alert>
      )}

      {model && (
        <>
          <p className="text-sm text-ink-soft">
            {model.name}／{specName}：本体 {items.length} 行・本体一式 {formatYen(baseLines)}（諸費用{Math.round(rate * 100)}%は自動加算）
          </p>
          <BaseBreakdownForm key={`${model.id}:${specCode}`} modelId={model.id} specCode={specCode} items={items} expenseRate={rate} />
          <OptionPriceSheet
            key={`opt-${model.id}:${specCode}`}
            options={optionRows}
            sitework={siteworkRows}
            baseLines={baseLines}
            expenseRate={rate}
            specName={`${model.name}・${specName}`}
          />
        </>
      )}
    </AdminPage>
  );
}
