import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
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

      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り' }]} />
        <Reveal className="max-w-3xl pb-10 pt-12 sm:pb-14 sm:pt-16">
          <p className="label-en text-forest">Plans &amp; styles</p>
          <h1 className="mt-4 text-4xl sm:text-5xl">平面図と完成イメージから仕様を選ぶ</h1>
          <p className="mt-6 leading-[1.9] text-ink-soft">
            ホテル仕様・住宅仕様・事務所向けなど、用途によって標準の設備や間取りが異なります。
            ここで各仕様の違いを確認してから、見積シミュレーターで詳しい設備や仕上げを選べます。
          </p>
        </Reveal>

        {models.length > 0 && (
          <nav aria-label="商品モデル" className="sticky top-0 z-20 -mx-4 border-y border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
            <div className="flex gap-2 overflow-x-auto">
              {models.map((model) => (
                <Link
                  key={model.id}
                  href={`#model-${model.slug}`}
                  className="shrink-0 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft transition hover:border-forest hover:text-forest"
                >
                  {displayModelName(model.name)}
                </Link>
              ))}
            </div>
          </nav>
        )}
      </Container>

      {models.length === 0 ? (
        <Container className="pb-24">
          <p className="py-16 text-center text-muted">現在公開中の商品はありません。</p>
        </Container>
      ) : (
        <div className="pb-24 sm:pb-32">
          {models.map((model, modelIndex) => {
            const bundle = bundles[model.id];
            if (!bundle) return null;
            const images = bundle.images;
            const hero = images.find((image) => image.kind === 'hero') ?? images.find((image) => image.kind === 'exterior') ?? null;
            const interior = images.find((image) => image.kind === 'interior') ?? null;
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
                className={`scroll-mt-24 border-t border-line ${modelIndex % 2 === 0 ? 'bg-ivory' : 'bg-white'}`}
              >
                <Container className="py-16 sm:py-24">
                  <Reveal className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="max-w-3xl">
                      <p className="label-en text-forest">Model {String(modelIndex + 1).padStart(2, '0')}</p>
                      <h2 className="mt-3 text-4xl sm:text-5xl">{modelName}</h2>
                      <p className="mt-4 text-lg text-ink-soft">{model.tagline}</p>
                      <p className="mt-5 leading-[1.9] text-ink-soft">{model.description}</p>
                    </div>
                    <ButtonLink href={`/products/${model.slug}`} variant="secondary">
                      {modelName}の商品詳細を見る
                    </ButtonLink>
                  </Reveal>

                  <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
                    <Reveal variant="image">
                      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-sand">
                        {hero ? (
                          <SmartImage
                            src={hero.url}
                            alt={hero.alt}
                            fill
                            sizes="(min-width: 1024px) 64vw, 100vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted">完成イメージ準備中</div>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted">{hero?.caption ?? `${modelName} 完成イメージ`} ※モデル共通の参考パースです。</p>
                    </Reveal>
                    <Reveal variant="image" delay={80}>
                      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-sand lg:h-full lg:aspect-auto lg:min-h-[18rem]">
                        {interior ? (
                          <SmartImage
                            src={interior.url}
                            alt={interior.alt}
                            fill
                            sizes="(min-width: 1024px) 32vw, 100vw"
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted">室内イメージ準備中</div>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted">{interior?.caption ?? `${modelName} 室内イメージ`}</p>
                    </Reveal>
                  </div>

                  <div className="mt-14">
                    <div className="max-w-2xl">
                      <p className="label-en text-forest">Styles</p>
                      <h3 className="mt-3 text-3xl">用途に合わせた仕様</h3>
                      <p className="mt-3 text-sm leading-7 text-ink-soft">
                        平面図は現在登録されている図面を表示しています。図面が準備中の仕様は、標準設備の内容を確認してシミュレーターへ進めます。
                      </p>
                    </div>

                    {presets.length === 0 ? (
                      <p className="mt-8 rounded-xl border border-line bg-white p-6 text-sm text-muted">現在、公開中の用途別仕様はありません。</p>
                    ) : (
                      <div className="mt-8 grid gap-6 lg:grid-cols-2">
                        {presets.map((preset) => {
                          const floorplan = floorplanForPreset(model.slug, preset.code, floorplans);
                          return (
                            <article key={preset.code} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
                              <div className="relative aspect-[16/10] bg-[#f5f2eb]">
                                {floorplan ? (
                                  <SmartImage
                                    src={floorplan.url}
                                    alt={floorplan.alt}
                                    fill
                                    sizes="(min-width: 1024px) 45vw, 100vw"
                                    className="object-contain p-3"
                                  />
                                ) : (
                                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted">
                                    <span className="font-semibold text-ink-soft">平面図準備中</span>
                                    <span className="text-xs">仕様内容は下記の説明をご確認ください。</span>
                                  </div>
                                )}
                              </div>
                              <div className="p-6 sm:p-7">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-forest">{modelName}</p>
                                <h4 className="mt-2 font-serif text-2xl">{preset.name}</h4>
                                <p className="mt-3 leading-7 text-ink-soft">{preset.description}</p>
                                {floorplan?.caption && <p className="mt-3 text-xs text-muted">{floorplan.caption}</p>}
                                <div className="mt-5 flex items-start gap-2 rounded-xl bg-ivory px-4 py-3 text-sm text-ink-soft">
                                  <Check className="mt-0.5 size-4 shrink-0 text-forest" aria-hidden="true" />
                                  <span>この仕様は見積シミュレーターで選択できます。</span>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-12 rounded-2xl bg-forest px-6 py-8 text-white sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-10">
                    <div>
                      <p className="text-2xl font-serif sm:text-3xl">{modelName} の仕様を見積で確認する</p>
                      <p className="mt-2 text-sm leading-6 text-white/75">仕様を選んだあと、設備・仕上げ・設置予定地を変更して概算見積を確認できます。</p>
                    </div>
                    <ButtonLink href={`/simulator/${model.slug}`} size="lg" className="mt-6 bg-white text-ink hover:bg-ivory sm:mt-0">
                      見積シミュレーターへ
                      <ArrowRight className="size-5" aria-hidden="true" />
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
