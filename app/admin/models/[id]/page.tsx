import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deleteProductImageAction } from '@/lib/actions/admin';
import { getStore } from '@/lib/data/store';
import { IMAGE_KIND_LABELS } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { AdminPage, BackLink, FlashMessages } from '@/components/admin/ui';
import { ModelForm, ProductImageForm } from '@/components/admin/forms';

export default async function EditModelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const store = await getStore();
  const bundle = await store.getCatalogBundle(id, { includeDraft: true });
  if (!bundle) notFound();
  const { model, images } = bundle;
  return (
    <AdminPage title={model.name} lead={`/products/${model.slug}`} actions={<Link href={`/products/${model.slug}`} target="_blank" className="btn-secondary btn-sm">公開ページを見る</Link>}>
      <BackLink href="/admin/models" label="一覧へ戻る" />
      <FlashMessages sp={sp} />
      <ModelForm model={model} />

      <section className="space-y-4">
        <h2 className="text-lg">商品画像（{images.length}）</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => (
            <li key={img.id} className="card overflow-hidden">
              <div className="relative aspect-[16/10] bg-sand">
                <SmartImage src={img.url} alt={img.alt} fill sizes="33vw" className="object-cover" />
                <span className="absolute top-2 left-2 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-white">{IMAGE_KIND_LABELS[img.kind]}</span>
              </div>
              <div className="flex items-start justify-between gap-2 p-3 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{img.caption || img.alt || '（キャプションなし）'}</p>
                  <p className="truncate text-muted">{img.url}</p>
                </div>
                <form action={deleteProductImageAction}>
                  <input type="hidden" name="id" value={img.id} />
                  <input type="hidden" name="base_model_id" value={model.id} />
                  <button type="submit" className="text-danger hover:underline">削除</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <ProductImageForm modelId={model.id} />
      </section>
    </AdminPage>
  );
}
