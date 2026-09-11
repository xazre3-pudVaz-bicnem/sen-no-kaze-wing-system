import { getPublicCatalog } from '@/lib/data/public-catalog';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { Reveal } from '@/components/ui/reveal';
import { ProductChapters } from '@/components/sections/product-chapters';

export const metadata = buildMetadata({
  title: '商品一覧｜折り畳み式木造コンテナ Wing のベースモデル',
  description: 'Wing・BOX・フラットの3つのベースモデル。外観・概要・本体価格を比較し、用途に合うモデルから見積シミュレーションを始められます。',
  path: '/products',
  image: '/images/products/wing-lakeside-deck.jpg',
});

export default async function ProductsPage() {
  const { models, bundles } = await getPublicCatalog();
  const chapters = models.map((m) => {
    const imgs = bundles[m.id]?.images ?? [];
    return { model: m, image: imgs.find((img) => img.kind === 'exterior') ?? imgs.find((img) => img.kind === 'hero') ?? null };
  });

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }])} />
      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧' }]} />
        <Reveal className="max-w-2xl pt-12 pb-4 sm:pt-16 sm:pb-6">
          <p className="label-en text-forest">Products</p>
        </Reveal>
      </Container>
      {models.length === 0 ? (
        <Container className="pb-24">
          <p className="py-16 text-center text-muted">現在公開中の商品はありません。</p>
        </Container>
      ) : (
        <ProductChapters items={chapters} headingLevel={2} hideFirstImage />
      )}
    </>
  );
}
