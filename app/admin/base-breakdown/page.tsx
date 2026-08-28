import Link from 'next/link';
import { requireCatalogEditor } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { Alert } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';
import { BaseBreakdownForm } from '@/components/admin/base-breakdown-form';
import { cn } from '@/lib/utils';

/**
 * 本体内訳マスター（分類表見積書）。
 * モデル×仕様ごとに本体工事の明細（売価）を持ち、見積作成時に本体の行として展開される。
 */
export default async function BaseBreakdownPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireCatalogEditor();
  const sp = await searchParams;
  const store = await getStore();
  const [models, allItems] = await Promise.all([store.listModels({ includeDraft: true }), store.listBaseBreakdownItems()]);

  const model = models.find((m) => m.id === sp.model) ?? models[0];
  const specs = model?.presets ?? [];
  const specCode = specs.some((p) => p.code === sp.spec) ? (sp.spec as string) : (specs[0]?.code ?? 'hotel');
  const items = allItems.filter((b) => b.base_model_id === model?.id && b.spec_code === specCode);
  const rate = model?.expense_rate ?? 0.15;

  return (
    <AdminPage
      title="本体内訳マスター"
      lead="分類表見積書（本体工事の明細・売価）です。ここを直すと、これから作られる見積の本体明細と本体一式の金額が変わります。"
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

      {model && (
        <>
          <p className="text-sm text-ink-soft">
            {model.name}／{specs.find((p) => p.code === specCode)?.name ?? specCode}：現在 {items.length} 行・
            本体一式 {formatYen(items.reduce((s, b) => s + b.amount, 0))}（諸費用{Math.round(rate * 100)}%は自動加算）
          </p>
          <BaseBreakdownForm key={`${model.id}:${specCode}`} modelId={model.id} specCode={specCode} items={items} expenseRate={rate} />
        </>
      )}
    </AdminPage>
  );
}
