import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { faqItems } from '@/data/site-content';
import { getPublicCatalog } from '@/lib/data/public-catalog';
import { buildMetadata, faqJsonLd, organizationJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/ui';
import { Reveal } from '@/components/ui/reveal';
import { RuleHeading } from '@/components/ui/section-heading';
import { HomeHero } from '@/components/sections/home-hero';
import { ConceptMovieSection } from '@/components/sections/concept-movie';
import { OriginSection } from '@/components/sections/origin';
import { WoodenContainerSection } from '@/components/sections/wooden-container';
import { ProductChapters } from '@/components/sections/product-chapters';
import { UseCaseSlider } from '@/components/sections/use-case-slider';
import { CostSection } from '@/components/sections/cost';
import { ConsultationSection } from '@/components/sections/consultation';
import { OwnersSection } from '@/components/sections/owners';
import { FaqSection } from '@/components/sections/faq-section';
import { NewsSection } from '@/components/sections/news-section';
import { ContactSection } from '@/components/sections/contact-section';

export const metadata = buildMetadata({
  title: '千の風プロジェクト｜折畳木造コンテナホテル Wing',
  description:
    '折り畳み式木造コンテナ「Wing」。4tユニック1台で運び、現地で約30分で展開。傾斜地・遊休地にも造成を抑えて設置でき、宿泊施設・店舗・事務所に。見積シミュレーターで仕様と概算金額をその場で確認できます。',
  path: '/',
  image: '/og-image.jpg',
  keywords: ['折り畳み式コンテナ', '木造コンテナ', 'コンテナホテル', 'コンテナハウス', '宿泊事業', '遊休地活用', '傾斜地', 'Wing', '千の風プロジェクト', '技術の杜'],
});

export default async function HomePage() {
  const { models, bundles } = await getPublicCatalog();
  const primary = models[0] ?? null;
  const simulatorHref = primary ? `/simulator/${primary.slug}` : '/products';
  const chapters = models.map((m) => {
    const imgs = bundles[m.id]?.images ?? [];
    return { model: m, image: imgs.find((img) => img.kind === 'exterior') ?? imgs.find((img) => img.kind === 'hero') ?? null };
  });

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={faqJsonLd(faqItems.map((f) => ({ q: f.q, a: f.a })))} />

      <HomeHero />
      <ConceptMovieSection />
      <OriginSection />
      <WoodenContainerSection />

      {/* ラインナップ（価格・見積シミュレーターへの導線） */}
      <section id="models" className="scroll-mt-20">
        <div className="container-x bg-paper py-16 sm:py-20">
          <RuleHeading
            labelEn="LINE UP"
            title="ベースモデルと価格"
            lead={'Wing（片ウィング）、BOX、フラットの3モデル。設備はシミュレーターで選べます。\n表示は本体価格計（本体一式＋諸費用・税別）です。'}
            tone="light"
            className="max-w-2xl"
          />
        </div>
        <ProductChapters items={chapters} />
      </section>

      <UseCaseSlider />
      <CostSection simulatorHref={simulatorHref} />
      <ConsultationSection />
      <OwnersSection />
      <FaqSection />
      <NewsSection />

      {/* 見積シミュレーターへの導線 */}
      <section className="bg-forest py-16 text-center text-white sm:py-20">
        <div className="container-x">
          <Reveal>
            <p className="label-en text-gold">SIMULATOR</p>
            <h2 className="mt-4 text-2xl text-white sm:text-4xl">仕様を選んで、概算見積をその場で。</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/80 sm:text-base">
              ユニットバス、トイレ、キッチン、エアコン、デッキ。選ぶたびに完成イメージと金額が変わります。保存した仕様から見積書PDFの発行までオンラインで完結します。
            </p>
            <Link href={simulatorHref} className="btn-gold btn-lg mt-8">
              見積シミュレーションを始める
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
      </section>

      <ContactSection />
    </>
  );
}
