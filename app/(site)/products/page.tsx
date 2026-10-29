import { getPublicCatalog } from '@/lib/data/public-catalog';
import { getPublicBaseTotals } from '@/lib/data/standard-estimate-sale-views';
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
  // 本体価格計は商品ページ・SEO と同じ価格元（スイッチの後は公開中の v2.5 の標準見積）
  const baseTotals = await getPublicBaseTotals(models);
  const listingImageBySlug: Record<string, { url: string; alt: string }> = {
    'wing-01': {
      url: '/images/cases/box-lakeside-family.jpg',
      alt: '緑に囲まれたデッキ付きのWingで過ごす人々',
    },
    box: {
      url: '/images/products/box-white.jpg',
      alt: '白いガルバリウム外壁のBOX',
    },
    flat: {
      url: '/images/cases/flat-entrance.jpg',
      alt: '住宅の玄関先に設置された黒いFlat',
    },
  };

  const chapters = models.map((m) => {
    const imgs = bundles[m.id]?.images ?? [];
    const image = imgs.find((img) => img.kind === 'exterior') ?? imgs.find((img) => img.kind === 'hero') ?? null;
    const override = listingImageBySlug[m.slug];
    return {
      model: m,
      image: image && override ? { ...image, ...override } : image,
      baseTotal: baseTotals[m.id] ?? null,
    };
  });

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }])} />
      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧' }]} />
        <h1 className="sr-only">商品一覧</h1>
        <Reveal className="max-w-2xl pt-12 pb-4 sm:pt-16 sm:pb-6">
          <p className="label-en text-forest">Products</p>
        </Reveal>
      </Container>
      {models.length === 0 ? (
        <Container className="pb-24">
          <p className="py-16 text-center text-muted">現在公開中の商品はありません。</p>
        </Container>
      ) : (
        <ProductChapters items={chapters} headingLevel={2} />
      )}
    </>
  );
}
