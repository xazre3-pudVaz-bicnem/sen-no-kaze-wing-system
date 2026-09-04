import { faqItems } from '@/data/site-content';
import { buildMetadata, faqJsonLd, organizationJsonLd } from '@/lib/seo';
import { JsonLd } from '@/components/ui';
import { HomeHero } from '@/components/sections/home-hero';
import { FeaturesSection } from '@/components/sections/features-section';
import { OriginSection } from '@/components/sections/origin';
import { FoldingTechSection } from '@/components/sections/folding-tech';
import { QualitySection } from '@/components/sections/quality-section';
import { ProductShowcase } from '@/components/sections/product-showcase';
import { ComboPlansSection } from '@/components/sections/combo-plans';
import { EstimateCtaSection } from '@/components/sections/estimate-cta';
import { FaqSection } from '@/components/sections/faq-section';
import { NewsSection } from '@/components/sections/news-section';
import { ContactSection } from '@/components/sections/contact-section';

export const metadata = buildMetadata({
  title: '千の風プロジェクト｜世界初⁉不陸調整 折畳み式木造コンテナ Wing・BOX・Flat',
  description:
    '世界初⁉不陸調整の折り畳み式木造コンテナ（特許出願中）。確認申請・住宅ローンに対応し、傾斜地にも最小限の造成で設置。Wing・BOX・Flatの3商品と組合せプランを、見積シミュレーターで概算確認できます。',
  path: '/',
  image: '/og-image.jpg',
  keywords: ['不陸調整', '折り畳み式コンテナ', '木造コンテナ', 'コンテナホテル', 'コンテナハウス', '宿泊事業', '遊休地活用', '傾斜地', 'Wing', 'BOX', 'Flat', '千の風プロジェクト', '技術の杜'],
});

/** トップページ（2026-09-01 先方修正案の構成：ヒーロー → 動画 → 特徴 → 原点 → 品質 → 商品 → 組合せ → 見積 → 代理店募集） */
export default function HomePage() {
  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={faqJsonLd(faqItems.map((f) => ({ q: f.q, a: f.a })))} />

      <HomeHero />
      <FeaturesSection />
      <OriginSection />
      <FoldingTechSection />
      <QualitySection />
      <ProductShowcase />
      <ComboPlansSection />
      <EstimateCtaSection />
      <FaqSection />
      <NewsSection />
      <ContactSection />
    </>
  );
}
