import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Check } from 'lucide-react';
import { getStore } from '@/lib/data/store';
import { baseTotalOf, formatManYen, formatYen } from '@/lib/domain/pricing';
import { IMAGE_KIND_LABELS, type ProductImageKind } from '@/lib/domain/types';
import { breadcrumbJsonLd, buildMetadata, productJsonLd } from '@/lib/seo';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Breadcrumbs, ButtonLink, Container, JsonLd, Section } from '@/components/ui';
import { ProductGallery } from '@/components/sections/product-gallery';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStore();
  const model = await store.getModelBySlug(slug);
  if (!model) return buildMetadata({ title: '商品が見つかりません', description: '', path: `/products/${slug}`, noindex: true });
  const bundle = await store.getCatalogBundle(model.id);
  const img = bundle?.images.find((i) => i.kind === 'exterior')?.url;
  return buildMetadata({
    title: `${model.name}｜折り畳み式木造コンテナの仕様・価格・オプション`,
    description: `${model.name}の外観・室内・平面図、サイズ・仕様、標準装備、追加できるオプション、本体価格${formatManYen(baseTotalOf(model))}〜。この商品で見積シミュレーションを始められます。`,
    path: `/products/${slug}`,
    image: img,
  });
}

const flowSteps = [
  ['見積シミュレーション', 'オプションを選んで概算金額と完成イメージを確認。保存して見積依頼へ。'],
  ['現地確認・正式見積', '搬入路・地盤・法規を確認し、運送費・工事費を含めた正式見積をご案内。'],
  ['製作', '工場で内外装まで仕上げた状態で製作します。'],
  ['運搬・設置', '4tユニックで搬入、現地で約30分で展開。設置後に基礎工事。'],
];

export default async function ProductDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const store = await getStore();
  const model = await store.getModelBySlug(slug);
  if (!model) notFound();
  const bundle = await store.getCatalogBundle(model.id);
  if (!bundle) notFound();

  const galleryKinds: ProductImageKind[] = ['exterior', 'interior', 'floorplan', 'transport'];
  const gallery = bundle.images.filter((i) => galleryKinds.includes(i.kind));
  const optionsByCategory = bundle.categories.map((c) => ({ category: c, options: bundle.options.filter((o) => o.category_id === c.id) })).filter((g) => g.options.length);

  return (
    <>
      <JsonLd data={productJsonLd(model, gallery.map((g) => g.url))} />
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name, path: `/products/${model.slug}` }])} />

      <Container className="pt-8 sm:pt-12">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name }]} />
      </Container>

      <Container className="grid gap-10 py-8 lg:grid-cols-[1.3fr_1fr] lg:gap-14">
        <ProductGallery images={gallery.map((g) => ({ url: g.url, alt: g.alt, caption: g.caption, kind: IMAGE_KIND_LABELS[g.kind] }))} />
        <div className="lg:sticky lg:top-28 lg:self-start">
          <p className="eyebrow">Base model</p>
          <h1 className="mt-2 text-4xl sm:text-5xl">{model.name}</h1>
          <p className="mt-4 text-ink-soft">{model.tagline}</p>
          <div className="mt-6 rounded-2xl bg-sand p-5">
            <p className="text-sm text-muted">本体価格計（本体一式＋諸費用・税別）</p>
            <p className="font-serif text-4xl">{formatManYen(baseTotalOf(model))}〜</p>
            <p className="mt-2 text-xs text-muted">{PRICE_DISCLAIMER}</p>
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <ButtonLink href={`/simulator/${model.slug}`} size="lg">
              この商品で見積を作る
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/contact" variant="secondary">相談する</ButtonLink>
          </div>
          <ul className="mt-6 space-y-2 text-sm text-ink-soft">
            {model.use_cases.map((u) => (
              <li key={u} className="flex items-center gap-2"><Check className="size-4 text-success" aria-hidden="true" />{u}</li>
            ))}
          </ul>
        </div>
      </Container>

      <Section className="bg-sand/60">
        <Container>
          <h2 className="text-3xl">{model.name} の特徴</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {model.features.map((f) => (
              <div key={f.title} className="card p-6">
                <p className="font-serif text-xl">{f.title}</p>
                <p className="mt-2 text-sm text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
          <p className="prose-wing mt-10 max-w-3xl text-ink-soft">{model.description}</p>
        </Container>
      </Section>

      <Section>
        <Container className="grid gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl">サイズ・仕様</h2>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {model.specs.map((s) => (
                <div key={s.label} className="grid grid-cols-[9rem_1fr] gap-4 py-3 text-sm sm:grid-cols-[11rem_1fr]">
                  <dt className="text-muted">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h2 className="text-3xl">標準装備</h2>
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {model.standard_equipment.map((e) => (
                <li key={e} className="flex items-start gap-2 text-sm"><Check className="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />{e}</li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <Section className="bg-sand/60">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl">追加できるオプション</h2>
              <p className="mt-2 text-ink-soft">価格は税別。シミュレーターで選ぶと完成イメージと合計金額に反映されます。</p>
            </div>
            <ButtonLink href={`/simulator/${model.slug}`} variant="secondary">シミュレーターで選ぶ</ButtonLink>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {optionsByCategory.filter(({ category }) => category.code !== 'sitework').map(({ category, options }) => (
              <div key={category.id} className="card p-6">
                <p className="font-semibold">{category.name}</p>
                {category.description && <p className="text-xs text-muted">{category.description}</p>}
                <ul className="mt-3 divide-y divide-line text-sm">
                  {options.map((o) => (
                    <li key={o.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span>
                        {o.name}
                        {o.is_default && <span className="ml-2 rounded bg-sand px-1.5 py-0.5 text-[0.65rem] text-muted">標準選択</span>}
                      </span>
                      <span className="shrink-0 text-ink-soft">{o.price_on_request ? '要見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="text-3xl">施工・設置の流れ</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-4">
            {flowSteps.map(([t, b], i) => (
              <li key={t} className="card p-6">
                <p className="font-serif text-3xl text-wood">0{i + 1}</p>
                <p className="mt-2 font-semibold">{t}</p>
                <p className="mt-2 text-sm text-ink-soft">{b}</p>
              </li>
            ))}
          </ol>
          <div className="mt-12 rounded-3xl bg-navy p-8 text-center text-white sm:p-12">
            <p className="text-2xl sm:text-3xl">{model.name} で見積シミュレーションを始める</p>
            <p className="mt-3 text-white/75">会員登録なしで試せます。保存・見積依頼の際にログインしてください。</p>
            <ButtonLink href={`/simulator/${model.slug}`} size="lg" className="mt-6 bg-white text-ink hover:bg-wood-light">
              この商品で見積を作る
              <ArrowRight className="size-5" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </>
  );
}
