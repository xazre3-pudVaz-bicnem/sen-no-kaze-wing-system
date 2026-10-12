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

type PlanImage = { url: string; alt: string; caption: string | null };

function displayModelName(name: string) {
  return name === 'フラット' ? 'Flat' : name;
}

function imageForPreset(modelSlug: string, presetCode: string, images: PlanImage[]) {
  const hints = planCaptionHints[`${modelSlug}:${presetCode}`] ?? [];
  return images.find((image) => hints.some((hint) => image.caption?.includes(hint))) ?? null;
}

export default async function PlansPage() {
  const { models, bundles } = await getPublicCatalog();

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り', path: '/plans' }])} />

      <Container className="pt-7 sm:pt-9">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り' }]} />
        <Reveal className="max-w-3xl pb-5 pt-7 sm:pb-6 sm:pt-8">
          <p className="label-en text-forest">Plans &amp; styles</p>
          <h1 className="mt-2.5 text-3xl sm:text-4xl">平面図とパースから仕様を選ぶ</h1>
          <p className="mt-2.5 text-sm leading-6 text-ink-soft sm:text-base">
            各仕様のパースと平面図をセットで見比べられます。
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
        <Container className="pb-16">
          <p className="py-10 text-center text-muted">現在公開中の商品はありません。</p>
        </Container>
      ) : (
        <div className="pb-14 sm:pb-16">
          {models.map((model, modelIndex) => {
            const bundle = bundles[model.id];
            if (!bundle) return null;
            const images = bundle.images;
            const floorplans = images
              .filter((image) => image.kind === 'floorplan')
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((image) => ({ url: image.url, alt: image.alt, caption: image.caption }));
            const perspectives = images
              .filter((image) => image.kind === 'hero' || image.kind === 'exterior' || image.kind === 'interior')
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((image) => ({ url: image.url, alt: image.alt, caption: image.caption }));
            const commonPerspective = perspectives[0] ?? null;
            const presets = model.presets ?? [];
            const modelName = displayModelName(model.name);

            return (
              <section
                key={model.id}
                id={`model-${model.slug}`}
                className={`scroll-mt-20 border-t border-line ${modelIndex % 2 === 0 ? 'bg-ivory' : 'bg-white'}`}
              >
                <Container className="py-7 sm:py-9">
                  <Reveal className="flex flex-wrap items-end justify-between gap-2.5">
                    <div>
                      <p className="label-en text-forest">Model {String(modelIndex + 1).padStart(2, '0')}</p>
                      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 className="text-3xl sm:text-4xl">{modelName}</h2>
                        <p className="text-sm text-ink-soft">{model.tagline}</p>
                      </div>
                    </div>
                    <Link href={`/products/${model.slug}`} className="text-sm font-semibold text-forest underline underline-offset-4">
                      商品詳細を見る
                    </Link>
                  </Reveal>

                  {presets.length === 0 ? (
                    <p className="mt-4 rounded-xl border border-line bg-white p-4 text-sm text-muted">現在、公開中の用途別仕様はありません。</p>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {presets.map((preset) => {
                        const floorplan = imageForPreset(model.slug, preset.code, floorplans) ?? (floorplans.length === 1 ? floorplans[0] : null);
                        const matchedPerspective = imageForPreset(model.slug, preset.code, perspectives);
                        const perspective = matchedPerspective ?? commonPerspective;
                        const usesCommonPerspective = Boolean(perspective && !matchedPerspective);

                        return (
                          <article key={preset.code} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                            <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
                              <h3 className="font-serif text-base sm:text-lg">{preset.name}</h3>
                              {usesCommonPerspective && <span className="text-[10px] text-muted">共通参考パース</span>}
                            </div>

                            <div className="grid grid-cols-2 gap-px bg-line">
                              <div className="bg-white">
                                <div className="border-b border-line px-2.5 py-1 text-[10px] font-semibold text-forest">パース</div>
                                {perspective ? (
                                  <a
                                    href={perspective.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="relative block aspect-[4/3] bg-sand"
                                    aria-label={`${modelName} ${preset.name}のパースを拡大`}
                                  >
                                    <SmartImage
                                      src={perspective.url}
                                      alt={perspective.alt}
                                      fill
                                      sizes="(min-width: 1280px) 15vw, (min-width: 640px) 24vw, 50vw"
                                      className="object-cover"
                                    />
                                  </a>
                                ) : (
                                  <div className="flex aspect-[4/3] items-center justify-center bg-sand px-2 text-center text-xs text-muted">パース準備中</div>
                                )}
                              </div>

                              <div className="bg-white">
                                <div className="border-b border-line px-2.5 py-1 text-[10px] font-semibold text-forest">平面図</div>
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
                                      sizes="(min-width: 1280px) 15vw, (min-width: 640px) 24vw, 50vw"
                                      className="object-contain p-1.5"
                                    />
                                  </a>
                                ) : (
                                  <div className="flex aspect-[4/3] items-center justify-center bg-[#f5f2eb] px-2 text-center text-xs text-muted">平面図準備中</div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 px-3.5 py-2 text-[11px] text-muted">
                              <span>{usesCommonPerspective ? 'パースはモデル共通の参考画像です' : '画像を押すと拡大できます'}</span>
                              {floorplan?.caption && <span className="max-w-[45%] truncate">{floorplan.caption}</span>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <ButtonLink href={`/simulator/${model.slug}`} size="sm">
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
