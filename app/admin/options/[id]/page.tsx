import { notFound } from 'next/navigation';
import { deleteOptionAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import type { OptionConflict, OptionDependency } from '@/lib/domain/types';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { OptionForm } from '@/components/admin/forms';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { OptionMediaManager } from '@/components/admin/option-media-manager';
import { OptionVariantManager } from '@/components/admin/option-variant-manager';

export default async function EditOptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const option = await store.getOption(id);
  if (!option) notFound();
  const [categories, models, options, variants] = await Promise.all([
    store.listCategories(),
    store.listModels({ includeDraft: true }),
    store.listOptions(),
    store.getOptionVariants(id),
  ]);
  // 関連（前提・競合）は全モデルのバンドルから集める
  const deps: OptionDependency[] = [];
  const confs: OptionConflict[] = [];
  for (const m of models) {
    const b = await store.getCatalogBundle(m.id, { includeDraft: true });
    if (!b) continue;
    for (const d of b.dependencies) if (d.option_id === id && !deps.some((x) => x.id === d.id)) deps.push(d);
    for (const c of b.conflicts) if (c.option_id === id && !confs.some((x) => x.id === c.id)) confs.push(c);
  }
  return (
    <AdminPage
      title={option.name}
      lead={option.code}
      actions={
        <form action={deleteOptionAction}>
          <input type="hidden" name="id" value={option.id} />
          <ConfirmSubmit message={`「${option.name}」を削除しますか？保存済みの仕様で使用中の場合は削除できません。`} className="btn-ghost btn-sm text-danger">削除</ConfirmSubmit>
        </form>
      }
    >
      <BackLink href="/admin/options" label="一覧へ戻る" />
      <FlashMessages sp={sp} />
      <section className="card p-4 sm:p-5" aria-label="商品登録フロー">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">商品登録フロー</h2>
            <p className="mt-1 text-xs text-muted">現在の画面で1〜5まで設定できます。6・7は後続工程で整備します。</p>
          </div>
          <span className="text-xs text-muted">保存しながら順番に確認できます</span>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
          {[
            ['1', '商品特定', '#product-identification'],
            ['2', '商品の詳細', '#product-details'],
            ['3', 'お客様資料', '#customer-materials-main'],
            ['4', 'お客様選択', '#customer-selection'],
            ['5', '価格設定', '#price-settings'],
          ].map(([no, label, href]) => (
            <li key={no}>
              <a href={href} className="block rounded-lg border border-line bg-white px-3 py-2 text-sm hover:border-brown">
                <span className="mr-1 text-xs text-muted">{no}.</span>{label}
              </a>
            </li>
          ))}
          <li className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
            <span className="mr-1 text-xs">6.</span>発注内容確認
          </li>
          <li className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">
            <span className="mr-1 text-xs">7.</span>お客様画面最終確認
          </li>
        </ol>
      </section>
      <OptionForm option={option} categories={categories} models={models} allOptions={options} dependencies={deps} conflicts={confs} />
      <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />
      <OptionMediaManager option={option} />
    </AdminPage>
  );
}
