import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { getPublicBundleBySlug } from '@/lib/data/public-catalog';
import { baseTotalOf, formatManYen, formatYen } from '@/lib/domain/pricing';
import { IMAGE_KIND_LABELS, type ProductImageKind } from '@/lib/domain/types';
import { breadcrumbJsonLd, buildMetadata, productJsonLd } from '@/lib/seo';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Breadcrumbs, ButtonLink, Container, JsonLd } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { Reveal } from '@/components/ui/reveal';
import { ProductGallery } from '@/components/sections/product-gallery';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublicBundleBySlug(slug);
  const model = bundle?.model;
  if (!model) return buildMetadata({ title: '商品が見つかりません', description: '', path: `/products/${slug}`, noindex: true });
  const img = bundle?.images.find((i) => i.kind === 'hero')?.url ?? bundle?.images.find((i) => i.kind === 'exterior')?.url;
  return buildMetadata({
    title: `${model.name}｜折り畳み式木造コンテナの仕様・価格・オプション`,
    description: `${model.name}の外観・室内・平面図、サイズ・仕様、標準装備、追加できるオプション、本体価格${formatManYen(baseTotalOf(model))}〜。この商品で見積シミュレーションを始められます。`,
    path: `/products/${slug}`,
    image: img,
  });
}

const flowSteps = [
  ['見積シミュレーション', 'オプションを選んで概算金額と完成イメージを確認。保存して見積依頼へ。'],
  ['現地確認・正式見積', '搬入路・地盤・法規を確認し、別途工事を含めた正式見積をご案内。'],
  ['製作', '工場で内外装まで仕上げた状態で製作します。'],
  ['運搬・設置', '4tユニックで搬入、現地で展開。設置後に基礎工事。'],
];

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const bundle = await getPublicBundleBySlug(slug);
  if (!bundle) notFound();
  const model = bundle.model;

  const hero = bundle.images.find((i) => i.kind === 'hero') ?? bundle.images.find((i) => i.kind === 'exterior') ?? null;
  const galleryKinds: ProductImageKind[] = ['exterior', 'interior', 'floorplan', 'transport'];
  const gallery = bundle.images.filter((i) => galleryKinds.includes(i.kind) && i.url !== hero?.url);
  const interior = bundle.images.find((i) => i.kind === 'interior') ?? null;
  const optionsByCategory = bundle.categories
    .filter((c) => c.code !== 'sitework')
    .map((c) => ({ category: c, options: bundle.options.filter((o) => o.category_id === c.id) }))
    .filter((g) => g.options.length);

  return (
    <>
      <JsonLd data={productJsonLd(model, [hero?.url, ...gallery.map((g) => g.url)].filter((u): u is string => Boolean(u)))} />
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name, path: `/products/${model.slug}` }])} />

      {/* 全幅ヒーロー */}
      <section className="relative isolate min-h-[70svh] overflow-hidden bg-forest-deep text-white">
        {hero ? (
          <SmartImage src={hero.url} alt={hero.alt} fill priority sizes="100vw" className="object-cover object-center" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/60">画像準備中</div>
        )}
        <div className="absolute inset-0 scrim-b" aria-hidden="true" />
        <div className="container-x relative flex min-h-[70svh] flex-col justify-end pb-12 pt-10 sm:pb-16">
          <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name }]} />
          <p className="label-en mt-8 text-white/75">Base model</p>
          <h1 className="mt-2 text-5xl text-white sm:text-7xl">{model.name}</h1>
          <p className="mt-4 max-w-xl text-white/85 sm:text-lg">{model.tagline}</p>
        </div>
      </section>

      {/* 価格・主要仕様・CTA */}
      <section className="border-b border-line bg-ivory">
        <Container className="grid gap-8 py-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <p className="text-xs text-muted">本体価格計（本体一式＋諸費用・税別）</p>
              <p className="font-serif text-5xl">{formatManYen(baseTotalOf(model))}〜</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-3">
              {model.specs.slice(0, 3).map((s) => (
                <div key={s.label}>
                  <dt className="text-muted">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={`/simulator/${model.slug}`} size="lg">
              この商品で見積を作る
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/contact" variant="secondary">相談する</ButtonLink>
          </div>
        </Container>
        <Container className="pb-6">
          <p className="text-xs text-muted">{PRICE_DISCLAIMER}</p>
        </Container>
      </section>

      {/* 特徴（編集的） */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <p className="label-en text-forest">Concept</p>
            <h2 className="mt-4 text-3xl sm:text-4xl">{model.name} の特徴</h2>
            <p className="mt-6 text-ink-soft leading-[1.9]">{model.description}</p>
          </Reveal>
          <div className="lg:col-span-7">
            {interior && (
              <Reveal variant="image">
                <div className="relative aspect-[3/2] overflow-hidden">
                  <SmartImage src={interior.url} alt={interior.alt} fill sizes="(min-width: 1024px) 58vw, 100vw" className="object-cover" />
                </div>
              </Reveal>
            )}
            <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {model.features.map((f) => (
                <Reveal key={f.title}>
                  <dt className="font-serif text-xl">{f.title}</dt>
                  <dd className="mt-1 text-sm text-ink-soft">{f.body}</dd>
                </Reveal>
              ))}
            </dl>
          </div>
        </Container>
      </section>

      {/* ギャラリー */}
      {gallery.length > 0 && (
        <section className="bg-ivory py-20 sm:py-28">
          <Container>
            <Reveal>
              <p className="label-en text-forest">Gallery</p>
              <h2 className="mt-4 text-3xl sm:text-4xl">外観・室内・図面</h2>
            </Reveal>
            <div className="mt-10">
              <ProductGallery images={gallery.map((g) => ({ url: g.url, alt: g.alt, caption: g.caption, kind: IMAGE_KIND_LABELS[g.kind] }))} />
            </div>
          </Container>
        </section>
      )}

      {/* 仕様・標準装備 */}
      <section className="py-20 sm:py-28">
        <Container className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl">サイズ・仕様</h2>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {model.specs.map((s) => (
                <div key={s.label} className="grid grid-cols-[9rem_1fr] gap-4 py-3 text-sm sm:grid-cols-[11rem_1fr]">
                  <dt className="text-muted">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={100}>
            <h2 className="text-3xl">標準装備</h2>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {model.standard_equipment.map((e) => (
                <li key={e} className="flex items-start gap-2 text-sm">
                  <Check className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" />
                  {e}
                </li>
              ))}
            </ul>
            <h2 className="mt-10 text-3xl">用途</h2>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
              {model.use_cases.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </Reveal>
        </Container>
      </section>

      {/* オプション */}
      <section className="bg-ivory py-20 sm:py-28">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <Reveal>
              <p className="label-en text-forest">Options</p>
              <h2 className="mt-4 text-3xl sm:text-4xl">追加できる設備</h2>
              <p className="mt-2 text-ink-soft">価格は税別（諸費用別）。シミュレーターで選ぶと完成イメージと合計金額に反映されます。</p>
            </Reveal>
            <ButtonLink href={`/simulator/${model.slug}`} variant="secondary">シミュレーターで選ぶ</ButtonLink>
          </div>
          <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {optionsByCategory.map(({ category, options }) => (
              <div key={category.id}>
                <p className="border-b border-line pb-2 font-semibold">{category.name}</p>
                <ul className="divide-y divide-line/60 text-sm">
                  {options.map((o) => (
                    <li key={o.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span>{o.name}</span>
                      <span className="shrink-0 text-ink-soft">{o.price_on_request ? '要見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* 流れ＋CTA */}
      <section className="py-20 sm:py-28">
        <Container>
          <h2 className="text-3xl">施工・設置の流れ</h2>
          <ol className="mt-8 divide-y divide-line border-y border-line">
            {flowSteps.map(([t, b], i) => (
              <li key={t} className="grid grid-cols-[3rem_10rem_1fr] items-baseline gap-4 py-4">
                <span className="font-serif text-2xl text-gold">0{i + 1}</span>
                <span className="font-semibold">{t}</span>
                <span className="text-sm text-ink-soft">{b}</span>
              </li>
            ))}
          </ol>
          <div className="mt-14 bg-forest p-10 text-center text-white sm:p-16">
            <p className="text-2xl sm:text-3xl">{model.name} で見積シミュレーションを始める</p>
            <p className="mt-3 text-white/75">会員登録なしで試せます。保存・見積依頼の際にログインしてください。</p>
            <ButtonLink href={`/simulator/${model.slug}`} size="lg" className="mt-6 bg-white text-ink hover:bg-ivory">
              この商品で見積を作る
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
