import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getStore } from '@/lib/data/store';
import { baseTotalOf, formatManYen } from '@/lib/domain/pricing';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { Breadcrumbs, ButtonLink, Container, JsonLd, Section, SectionHeading } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

export const metadata = buildMetadata({
  title: '商品一覧｜折り畳み式木造コンテナ Wing のベースモデル',
  description: 'Wing のベースモデル一覧。外観・概要・参考価格を比較し、用途に合うモデルから見積シミュレーションを始められます。',
  path: '/products',
});

export default async function ProductsPage() {
  const store = await getStore();
  const models = await store.listModels();
  const bundles = await Promise.all(models.map((m) => store.getCatalogBundle(m.id)));
  const allUseCases = [...new Set(models.flatMap((m) => m.use_cases))];

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }])} />
      <Section className="pb-10">
        <Container>
          <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧' }]} />
          <SectionHeading as="h1" eyebrow="Products" title="ベースモデル一覧" lead="まずベースとなるコンテナを選び、シミュレーターでオプションを加えていきます。価格は本体の参考価格（税別）です。" className="mt-6" />
        </Container>
      </Section>

      {allUseCases.length > 0 && (
        <Container className="pb-8">
          <p className="mb-3 text-sm font-semibold text-ink-soft">用途から探す</p>
          <div className="flex flex-wrap gap-2">
            {allUseCases.map((u) => (
              <Link key={u} href={`#usecase-${encodeURIComponent(u)}`} className="rounded-full border border-line bg-white px-4 py-2 text-sm hover:border-ink/40">
                {u}
              </Link>
            ))}
          </div>
        </Container>
      )}

      <Container className="pb-20">
        {models.length === 0 ? (
          <p className="card p-10 text-center text-muted">現在公開中の商品はありません。</p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            {models.map((m, i) => {
              const hero = bundles[i]?.images.find((img) => img.kind === 'exterior') ?? bundles[i]?.images[0];
              return (
                <article key={m.id} className="card overflow-hidden">
                  <Link href={`/products/${m.slug}`} className="relative block aspect-[16/10]">
                    {hero ? (
                      <SmartImage src={hero.url} alt={hero.alt} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-sand text-muted">画像準備中</div>
                    )}
                  </Link>
                  <div className="p-7">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h2 className="text-2xl sm:text-3xl">
                        <Link href={`/products/${m.slug}`} className="hover:underline">{m.name}</Link>
                      </h2>
                      <p className="text-sm text-muted">
                        本体価格計 <span className="font-serif text-2xl text-ink">{formatManYen(baseTotalOf(m))}〜</span>（税別）
                      </p>
                    </div>
                    <p className="mt-2 text-ink-soft">{m.tagline}</p>
                    <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {m.specs.slice(0, 4).map((s) => (
                        <div key={s.label}>
                          <dt className="text-muted">{s.label}</dt>
                          <dd>{s.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <ul className="mt-5 flex flex-wrap gap-2">
                      {m.use_cases.map((u) => (
                        <li key={u} id={`usecase-${u}`} className="rounded-full bg-sand px-3 py-1 text-xs text-ink-soft">{u}</li>
                      ))}
                    </ul>
                    <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                      <ButtonLink href={`/products/${m.slug}`} variant="secondary">詳細を見る</ButtonLink>
                      <ButtonLink href={`/simulator/${m.slug}`}>
                        この商品で見積を作る
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </ButtonLink>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Container>
    </>
  );
}
