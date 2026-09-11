import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteProductImageAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { IMAGE_KIND_LABELS } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { ModelForm, ProductImageForm } from '@/components/admin/forms';
import { ModelSimulatorImages, type SimulatorImageSection } from '@/components/admin/model-simulator-images';
import { cn } from '@/lib/utils';

type EditorTab = 'basic' | 'plans' | 'product-images' | 'simulator-images';

const TABS: { key: EditorTab; label: string; lead: string }[] = [
  { key: 'basic', label: '基本情報', lead: '商品名・価格・説明・サイズ・仕様など' },
  { key: 'plans', label: 'プラン・表示設定', lead: '住宅用・ホテル用・初期プラン・平面図見出し' },
  { key: 'product-images', label: '商品画像', lead: '商品一覧・商品詳細で使う画像' },
  { key: 'simulator-images', label: 'シミュレーター画像', lead: '平面図・立面図・完成イメージ・施工事例' },
];

function tabHref(modelId: string, tab: EditorTab) {
  return `/admin/models/${modelId}?tab=${tab}`;
}

export default async function EditModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const bundle = await store.getCatalogBundle(id, { includeDraft: true });
  if (!bundle) notFound();

  const { model, images } = bundle;
  const activeTab = TABS.some((tab) => tab.key === sp.tab) ? (sp.tab as EditorTab) : 'basic';
  const simSection: SimulatorImageSection =
    sp.section === 'completion' || sp.section === 'elevation' || sp.section === 'case'
      ? sp.section
      : 'floorplan';
  const productPageImages = images.filter((img) => img.kind !== 'elevation' && img.kind !== 'case');

  return (
    <AdminPage
      title={model.name}
      lead="この商品に関する設定を1か所で管理します。"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href={`/products/${model.slug}`} target="_blank" className="btn-secondary btn-sm">公開ページを見る</Link>
          <Link href={`/simulator/${model.slug}`} target="_blank" className="btn-secondary btn-sm">シミュレーターを見る</Link>
        </div>
      }
    >
      <BackLink href="/admin/models" label="ベースコンテナ一覧へ戻る" />
      <FlashMessages sp={sp} />

      <nav className="overflow-x-auto border-b border-line" aria-label={`${model.name} 編集メニュー`}>
        <div className="flex min-w-max gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Link
                key={tab.key}
                href={tabHref(model.id, tab.key)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'min-w-40 border-b-2 px-4 py-3 text-left transition',
                  active
                    ? 'border-forest bg-forest/5 text-forest'
                    : 'border-transparent text-ink-soft hover:border-line hover:bg-ivory/50 hover:text-ink'
                )}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className="mt-0.5 block text-[0.68rem] leading-snug text-muted">{tab.lead}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {activeTab === 'basic' && <ModelForm model={model} mode="basic" />}

      {activeTab === 'plans' && <ModelForm model={model} mode="plans" />}

      {activeTab === 'product-images' && (
        <section className="space-y-5">
          <div>
            <h2 className="text-xl font-semibold">商品画像</h2>
            <p className="mt-1 text-sm text-muted">商品一覧・商品詳細ページで使う外観、室内、平面図、輸送・設置画像を管理します。</p>
          </div>

          {productPageImages.length > 0 ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {productPageImages.map((img) => (
                <li key={img.id} className="card overflow-hidden">
                  <div className="relative aspect-[16/10] bg-sand">
                    <SmartImage src={img.url} alt={img.alt} fill sizes="33vw" className="object-cover" />
                    <span className="absolute top-2 left-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-white">
                      {img.kind === 'floorplan' ? '平面図（商品紹介用）' : IMAGE_KIND_LABELS[img.kind]}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2 p-3 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{img.caption || img.alt || '（キャプションなし）'}</p>
                      <p className="truncate text-muted">{img.url}</p>
                    </div>
                    <form action={deleteProductImageAction}>
                      <input type="hidden" name="id" value={img.id} />
                      <input type="hidden" name="base_model_id" value={model.id} />
                      <input type="hidden" name="redirect_to" value={tabHref(model.id, 'product-images')} />
                      <button type="submit" className="text-danger hover:underline">削除</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">商品画像はまだ登録されていません。</div>
          )}

          <ProductImageForm
            modelId={model.id}
            allowedKinds={['hero', 'exterior', 'interior', 'floorplan', 'transport']}
            title="商品画像を追加"
          />
        </section>
      )}

      {activeTab === 'simulator-images' && (
        <ModelSimulatorImages
          bundle={bundle}
          section={simSection}
          missingOnly={sp.filter === 'missing'}
        />
      )}
    </AdminPage>
  );
}
