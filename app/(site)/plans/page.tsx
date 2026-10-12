import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getPublicCatalog } from '@/lib/data/public-catalog';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { Breadcrumbs, ButtonLink, Container, JsonLd } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { Reveal } from '@/components/ui/reveal';

export const metadata = buildMetadata({
  title: '商品・仕様・間取り｜Wing・BOX・Flatを比較',
  description:
    'Wing・BOX・Flatの用途別仕様を、平面図と完成イメージで比較できます。ホテル仕様・住宅仕様・事務所・店舗用などの違いを確認してから見積シミュレーターへ進めます。',
  path: '/plans',
  image: '/images/plan/wing-isometric.jpg',
});

const planCaptionHints: Record<string, string[]> = {
  'wing-01:hotel': ['ホテル仕様'],
  'wing-01:residence': ['住宅仕様'],
  'wing-01:office': ['事務所'],
  'box:hotel-single': ['シングルホテル'],
  'box:water-kit': ['水回り'],
  'flat:office': ['6.8帖', '事務所'],
};

function displayModelName(name: string) {
  return name === 'フラット' ? 'Flat' : name;
}

function floorplanForPreset(
  modelSlug: string,
  presetCode: string,
  floorplans: { url: string; alt: string; caption: string | null }[]
) {
  const hints = planCaptionHints[`${modelSlug}:${presetCode}`] ?? [];
  const matched = floorplans.find((image) => hints.some((hint) => image.caption?.includes(hint)));
  if (matched) return matched;
  return floorplans.length === 1 ? floorplans[0] : null;
}

export default async function PlansPage() {
  const { models, bundles } = await getPublicCatalog();

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り', path: '/plans' }])} />

      <Container className="pt-8 sm:pt-10">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り' }]} />
        <Reveal className="max-w-3xl pb-6 pt-8 sm:pb-8 sm:pt-10">
          <p className="label-en text-forest">Plans &amp; styles</p>
          <h1 className="mt-3 text-3xl sm:text-4xl">平面図とパースから仕様を選ぶ</h1>
          <p className="mt-3 text-sm leading-7 text-ink-soft sm:text-base">
            Wing・BOX・Flatの間取りと完成イメージを見比べて、用途に合う仕様を選べます。
          </p>
        </Reveal>

        {models.length > 0 && (
          <nav aria-label="商品モデル" className="sticky top-0 z-20 -mx-4 border-y border-line bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
            <div className="flex gap-2 overflow-x-auto">
              {models.map((model) => (
                <Link
                  key={model.id}
                  href={`#model-${model.slug}`}
                  className="shrink-0 rounded-full border border-line bg-white px-4 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-forest hover:text-forest"
                >
                  {displayModelName(model.name)}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </Container>

      {models.length === 0 ? (
        <Container className="pb-20">
          <p className="py-12 text-center text-muted">現在公開中の商品はありません。</p>
        </Container>
      ) : (
        <div className="pb-16 sm:pb-20">
          {models.map((model, modelIndex) => {
            const bundle = bundles[model.id];
            if (!bundle) return null;
            const images = bundle.images;
            const hero = images.find((image) => image.kind === 'hero') ?? images.find((image) => image.kind === 'exterior') ?? null;
            const floorplans = images
              .filter((image) => image.kind === 'floorplan')
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((image) => ({ url: image.url, alt: image.alt, caption: image.caption }));
            const presets = model.presets ?? [];
            const modelName = displayModelName(model.name);

            return (
              <section
                key={model.id}
                id={`model-${model.slug}`}
                className={`scroll-mt-20 border-t border-line ${modelIndex % 2 === 0 ? 'bg-ivory' : 'bg-white'}`}
              >
                <Container className="py-9 sm:py-12">
                  <Reveal className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="label-en text-forest">Model {String(modelIndex + 1).padStart(2, '0')}</p>
                      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <h2 className="text-3xl sm:text-4xl">{modelName}</h2>
                        <p className="text-sm text-ink-soft">{model.tagline}</p>
                      </div>
                    </div>
                    <Link href={`/products/${model.slug}`} className="text-sm font-semibold text-forest underline underline-offset-4">
                      商品詳細を見る
                    </Link>
                  </Reveal>

                  <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.7fr)] lg:items-start">
                    <Reveal variant="image">
                      <div className="overflow-hidden rounded-xl border border-line bg-white">
                        <div className="relative aspect-[4/3] bg-sand">
                          {hero ? (
                            <SmartImage
                              src={hero.url}
                              alt={hero.alt}
                              fill
                              sizes="(min-width: 1024px) 34vw, 100vw"
                              className="object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted">参考パース準備中</div>
                          )}
                          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-ink shadow-sm">
                            参考パース
                          </span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs text-muted">{hero?.caption ?? `${modelName} 完成イメージ`} ※モデル共通の参考パースです。</p>
                    </Reveal>

                    {presets.length === 0 ? (
                      <p className="rounded-xl border border-line bg-white p-5 text-sm text-muted">現在、公開中の用途別仕様はありません。</p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {presets.map((preset) => {
                          const floorplan = floorplanForPreset(model.slug, preset.code, floorplans);
                          return (
                            <article key={preset.code} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                                <h3 className="font-serif text-lg">{preset.name}</h3>
                                <span className="shrink-0 text-[11px] font-semibold text-forest">平面図</span>
                              </div>
                              {floorplan ? (
                                <a
                                  href={floorplan.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="relative block aspect-[4/3] bg-[#f5f2eb]"
                                  aria-label={`${modelName} ${preset.name}の平面図を拡大`}
                                >
                                  <SmartImage
                                    src={floorplan.url}
                                    alt={floorplan.alt}
                                    fill
                                    sizes="(min-width: 1280px) 22vw, (min-width: 640px) 43vw, 100vw"
                                    className="object-contain p-2"
                                  />
                                </a>
                              ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-[#f5f2eb] px-4 text-center text-sm text-muted">
                                  平面図準備中
                                </div>
                              )}
                              {floorplan?.caption && <p className="truncate px-4 py-2 text-xs text-muted">{floorplan.caption}</p>}
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-5 flex justify-end">
                    <ButtonLink href={`/simulator/${model.slug}`}>
                      {modelName} の見積シミュレーターへ
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </ButtonLink>
                  </div>
                </Container>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
