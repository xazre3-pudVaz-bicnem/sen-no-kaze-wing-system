import Link from 'next/link';
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
  const requestedTab = sp.tab;
  const tab = requestedTab === 'customer' || requestedTab === 'sales' ? requestedTab : 'product';
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
      <section className="card p-4 sm:p-5" aria-label="商品編集メニュー">
        <div>
          <h2 className="font-semibold">この商品の設定</h2>
          <p className="mt-1 text-xs text-muted">作業したい項目を選ぶと、その内容だけを表示します。</p>
        </div>
        <nav className="mt-4 grid gap-2 md:grid-cols-3" aria-label="商品編集タブ">
          {[
            ['product', '1', '商品情報', '商品名・メーカー・画像・メーカー資料'],
            ['customer', '2', 'お客様表示・選択', '色・柄・仕様・追加金額'],
            ['sales', '3', '販売・詳細設定', '商品価格・対象モデル・公開設定'],
          ].map(([key, no, label, note]) => {
            const active = tab === key;
            return (
              <Link
                key={key}
                href={`?tab=${key}`}
                aria-current={active ? 'page' : undefined}
                className={`block h-full rounded-xl border px-4 py-3 transition ${
                  active
                    ? 'border-brown bg-ivory/70 ring-1 ring-brown/20'
                    : 'border-line bg-white hover:border-brown hover:bg-ivory/30'
                }`}
              >
                <span className="text-xs font-semibold text-brown">{no}</span>
                <span className="ml-2 font-semibold">{label}</span>
                <span className="mt-1 block text-xs text-muted">{note}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      {tab === 'product' && (
        <>
          <OptionForm
            mode="product"
            option={option}
            categories={categories}
            models={models}
            allOptions={options}
            dependencies={deps}
            conflicts={confs}
          />
          <OptionMediaManager option={option} />
        </>
      )}

      {tab === 'customer' && (
        <OptionVariantManager option={option} groups={variants.groups} choices={variants.choices} />
      )}

      {tab === 'sales' && (
        <OptionForm
          mode="sales"
          option={option}
          categories={categories}
          models={models}
          allOptions={options}
          dependencies={deps}
          conflicts={confs}
        />
      )}
    </AdminPage>
  );
}
