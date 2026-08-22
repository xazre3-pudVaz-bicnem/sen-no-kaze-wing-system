import Image from 'next/image';
import Link from 'next/link';
import { Phone } from 'lucide-react';
import { faqs } from '@/data/faq';
import { getStore } from '@/lib/data/store';
import { buildMetadata, faqJsonLd, organizationJsonLd } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { ButtonLink, Container, JsonLd } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { Reveal } from '@/components/ui/reveal';
import { HomeHero } from '@/components/sections/home-hero';
import { StorySection } from '@/components/sections/story';
import { BrandsSection } from '@/components/sections/brands';
import { ProductChapters } from '@/components/sections/product-chapters';
import { LivingSection } from '@/components/sections/living';
import { InstallSection } from '@/components/sections/install';

export const metadata = buildMetadata({
  title: '折り畳み式木造コンテナ Wing｜4tユニックで運び30分で展開する別荘・宿泊施設',
  description:
    '折り畳み式木造コンテナ「Wing」は4tユニック1台で運搬、現地で約30分で展開し18.72㎡の空間に。傾斜地にも設置でき建築確認申請にも対応。見積シミュレーターで仕様と概算金額をその場で確認。',
  path: '/',
  image: '/og-image.jpg',
  keywords: ['折り畳み式コンテナ', '木造コンテナ', 'コンテナハウス', 'トレーラーハウス', '小屋', '別荘', 'グランピング', 'Wing', '千の風プロジェクト'],
});

export default async function HomePage() {
  const store = await getStore();
  const models = await store.listModels();
  const bundles = await Promise.all(models.map((m) => store.getCatalogBundle(m.id)));
  const primary = models[0] ?? null;
  const simulatorHref = primary ? `/simulator/${primary.slug}` : '/products';
  const chapters = models.map((m, i) => ({
    model: m,
    image: bundles[i]?.images.find((img) => img.kind === 'exterior') ?? bundles[i]?.images.find((img) => img.kind === 'hero') ?? null,
  }));
  const cases = bundles[0]?.images.filter((i) => i.kind === 'case') ?? [];

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={faqJsonLd(faqs)} />

      <HomeHero simulatorHref={simulatorHref} />
      <StorySection />
      <BrandsSection />

      {/* 商品章 */}
      <section id="models" className="scroll-mt-16">
        <div className="container-x py-16 sm:py-24">
          <Reveal className="max-w-2xl">
            <p className="label-en text-forest">Models</p>
            <h2 className="mt-4 text-3xl sm:text-5xl">3つのベースモデル。</h2>
            <p className="mt-5 text-ink-soft sm:text-lg">折り畳んで運ぶ Wing、客室に向く BOX、事務所に向くフラット。いずれも工場で仕上げ、設備はシミュレーターで選べます。</p>
          </Reveal>
        </div>
        <ProductChapters items={chapters} />
      </section>

      <LivingSection simulatorHref={simulatorHref} />
      <InstallSection />

      {/* 施工事例 */}
      {cases.length > 0 && (
        <section id="cases" className="scroll-mt-16 bg-paper py-20 sm:py-28">
          <Container>
            <Reveal className="max-w-2xl">
              <p className="label-en text-forest">Works</p>
              <h2 className="mt-4 text-3xl sm:text-5xl">景色のいちばん良い場所に。</h2>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {cases.map((c, i) => (
                <Reveal key={c.id} variant="image" delay={i * 80}>
                  <figure>
                    <div className="relative aspect-[4/3] overflow-hidden">
                      <SmartImage src={c.url} alt={c.alt} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
                    </div>
                    <figcaption className="mt-3 text-sm text-ink-soft">{c.caption}</figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 bg-ivory py-20 sm:py-28">
        <Container className="grid gap-10 lg:grid-cols-[1fr_2fr]">
          <Reveal>
            <p className="label-en text-forest">FAQ</p>
            <h2 className="mt-4 text-3xl sm:text-4xl">よくある質問</h2>
          </Reveal>
          <div className="divide-y divide-line border-y border-line">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-base font-semibold sm:text-lg [&::-webkit-details-marker]:hidden">
                  <span>{f.q}</span>
                  <span aria-hidden="true" className="mt-1 shrink-0 text-muted transition-transform group-open:rotate-45">＋</span>
                </summary>
                <p className="mt-3 text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="relative isolate overflow-hidden bg-forest-deep text-white">
        <Image src="/images/exterior/cove-night.jpg" alt="" aria-hidden="true" fill sizes="100vw" className="object-cover opacity-35" />
        <Container className="relative py-24 text-center sm:py-32">
          <p className="label-en text-gold">Start</p>
          <h2 className="mt-4 text-3xl text-white sm:text-5xl">あなたの土地に、Wing を置いてみる。</h2>
          <p className="mx-auto mt-5 max-w-xl text-white/80">オプションを選ぶだけで、完成イメージと概算金額がその場で分かります。保存しておけば、いつでも続きから。</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href={simulatorHref} size="lg" className="bg-white text-ink hover:bg-ivory">
              見積シミュレーションを始める
            </ButtonLink>
            <Link href="/contact" className="btn btn-lg border border-white/40 text-white hover:bg-white/10">
              相談する
            </Link>
          </div>
          <p className="mt-8 inline-flex items-center gap-2 text-sm text-white/75">
            <Phone className="size-4" aria-hidden="true" />
            お電話でも：
            <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-xl tracking-wider text-white">
              {COMPANY.tel}
            </a>
          </p>
        </Container>
      </section>
    </>
  );
}
