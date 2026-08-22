import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getPublicBundleBySlug } from '@/lib/data/public-catalog';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { ELEVATIONS, MODEL_WING01_ID } from '@/lib/seed/catalog';
import { JsonLd } from '@/components/ui';
import { SimulatorApp, type SimulatorInitial } from '@/components/simulator/simulator-app';

type Params = Promise<{ slug: string }>;
type Search = Promise<{ c?: string; resume?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublicBundleBySlug(slug);
  const model = bundle?.model;
  return buildMetadata({
    title: model ? `${model.name} 見積シミュレーター｜オプションを選んで概算金額と完成イメージを確認` : '見積シミュレーター',
    description: `${model?.name ?? 'Wing'}のベースにトイレ・お風呂・キッチン・エアコン・ウッドデッキなどのオプションを加え、完成イメージと概算金額をその場で確認。保存して後から再編集、見積依頼・見積書PDFの発行まで。`,
    path: `/simulator/${slug}`,
  });
}

export default async function SimulatorPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const { c, resume } = await searchParams;
  const bundle = await getPublicBundleBySlug(slug);
  if (!bundle) notFound();
  const model = bundle.model;
  const user = await getSessionUser();

  let initial: SimulatorInitial | null = null;
  let loadError: string | null = null;
  if (c) {
    if (!user) {
      loadError = '保存した仕様を開くにはログインが必要です。';
    } else {
      const store = await getStore();
      const found = await store.getConfiguration(c, user);
      if (!found) loadError = '保存した仕様が見つからないか、閲覧権限がありません。';
      else
        initial = {
          id: found.configuration.id,
          name: found.configuration.name,
          option_ids: found.items.map((i) => i.option_id),
          status: found.configuration.status,
        };
    }
  }

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name, path: `/products/${model.slug}` }, { name: '見積シミュレーター', path: `/simulator/${model.slug}` }])} />
      <SimulatorApp
        bundle={bundle}
        elevations={model.id === MODEL_WING01_ID ? ELEVATIONS : []}
        initial={initial}
        loadError={loadError}
        resume={resume === '1'}
        user={user ? { id: user.id, name: user.full_name || user.email } : null}
      />
    </>
  );
}
