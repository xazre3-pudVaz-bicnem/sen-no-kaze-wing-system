import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getPublicCatalog } from '@/lib/data/public-catalog';
import { buildPresetSelection } from '@/lib/domain/preset';
import { selectedPreviewKeys } from '@/lib/domain/preview';
import { isDedicatedBaseFloorplanRule, isPresetFloorplanRule, presetFloorplanCode } from '@/lib/domain/preview-rule-meta';
import { samePreviewKeys } from '@/lib/domain/floorplan-admin';
import type { CatalogBundle, ModelPreset } from '@/lib/domain/types';
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

function floorplanForPreset(modelSlug: string, presetCode: string, floorplans: PlanImage[]) {
  const hints = planCaptionHints[`${modelSlug}:${presetCode}`] ?? [];
  const matched = floorplans.find((image) => hints.some((hint) => image.caption?.includes(hint)));
  if (matched) return matched;
  return floorplans.length === 1 ? floorplans[0] : null;
}

function registeredFloorplanForPreset(bundle: CatalogBundle, preset: ModelPreset): PlanImage | null {
  const floorplanRules = bundle.previewRules.filter(
    (rule) => rule.view === 'floorplan' && rule.kind === 'composite' && rule.status === 'published'
  );
  const dedicated = floorplanRules.find((rule) => isPresetFloorplanRule(rule, preset.code));
  if (dedicated) {
    return { url: dedicated.url, alt: dedicated.alt, caption: null };
  }

  const ctx = {
    options: bundle.options,
    categories: bundle.categories,
    dependencies: bundle.dependencies,
    conflicts: bundle.conflicts,
  };
  const selectedIds = buildPresetSelection(ctx, preset);
  const keys = selectedPreviewKeys(bundle.options, selectedIds, 'floorplan');
  if (keys.length === 0) return null;

  const legacyMatched = floorplanRules.find((rule) => {
    if (isDedicatedBaseFloorplanRule(rule)) return false;
    if (presetFloorplanCode(rule)) return false;
    return samePreviewKeys(rule.preview_keys, keys);
  });

  return legacyMatched ? { url: legacyMatched.url, alt: legacyMatched.alt, caption: null } : null;
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
            各モデルのパースと特徴、その下で仕様ごとの平面図を比較できます。
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
            const commonPerspective =
              images.find((image) => image.kind === 'hero') ??
              images.find((image) => image.kind === 'exterior') ??
              images.find((image) => image.kind === 'interior') ??
              null;
            const presets = model.presets ?? [];
            const modelName = displayModelName(model.name);
            const modelFeatures = model.features.slice(0, 4);

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

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(13rem,0.72fr)_minmax(0,1.28fr)] md:items-stretch">
                    <Reveal variant="image" className="w-full max-w-sm md:max-w-none">
                      <div className="h-full overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-line px-3 py-2">
                          <span className="text-xs font-semibold text-forest">共通パース</span>
                          <span className="text-[10px] text-muted">{modelName}</span>
                        </div>
                        {commonPerspective ? (
                          <a
                            href={commonPerspective.url}
                            target="_blank"
                            rel="noreferrer"
                            className="relative block aspect-[4/3] bg-sand"
                            aria-label={`${modelName}の共通パースを拡大`}
                          >
                            <SmartImage
                              src={commonPerspective.url}
                              alt={commonPerspective.alt}
                              fill
                              sizes="(min-width: 768px) 32vw, 92vw"
                              className="object-cover"
                            />
                          </a>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-sand px-3 text-center text-xs text-muted">パース準備中</div>
                        )}
                      </div>
                    </Reveal>

                    <Reveal className="rounded-xl border border-line bg-white p-3.5 shadow-sm sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-serif text-base sm:text-lg">{modelName} の特徴</h3>
                        <span className="text-[10px] text-muted">商品共通</span>
                      </div>
                      {modelFeatures.length > 0 ? (
                        <div className="mt-3 grid grid-cols-2 gap-2.5">
                          {modelFeatures.map((feature) => (
                            <div key={feature.title} className="rounded-lg bg-ivory px-3 py-2.5">
                              <p className="text-xs font-semibold text-forest sm:text-sm">{feature.title}</p>
                              <p className="mt-1 max-h-10 overflow-hidden text-[10px] leading-5 text-ink-soft sm:text-[11px]">{feature.body}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs leading-6 text-ink-soft sm:text-sm">{model.description}</p>
                      )}
                    </Reveal>
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-3 border-b border-line pb-2">
                    <div>
                      <p className="text-xs font-semibold text-forest">仕様ごとの平面図</p>
                      <p className="mt-0.5 text-[11px] text-muted">用途に合う間取りを見比べられます。平面図を押すと、その仕様で見積を始められます。</p>
                    </div>
                  </div>

                  {presets.length === 0 ? (
                    <p className="mt-3 rounded-xl border border-line bg-white p-4 text-sm text-muted">現在、公開中の用途別仕様はありません。</p>
                  ) : (
                    <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
                      {presets.map((preset) => {
                        const registeredFloorplan = registeredFloorplanForPreset(bundle, preset);
                        const floorplan = registeredFloorplan ?? floorplanForPreset(model.slug, preset.code, floorplans);
                        const simulatorHref = `/simulator/${model.slug}?spec=${encodeURIComponent(preset.code)}`;

                        return (
                          <article key={preset.code} className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                            <div className="border-b border-line px-3 py-2">
                              <h3 className="font-serif text-sm sm:text-base">{preset.name}</h3>
                            </div>

                            {floorplan ? (
                              <div className="relative aspect-[4/3] bg-[#f5f2eb]">
                                <Link
                                  href={simulatorHref}
                                  className="absolute inset-0 block"
                                  aria-label={`${modelName} ${preset.name}で見積シミュレーターを開く`}
                                >
                                  <SmartImage
                                    src={floorplan.url}
                                    alt={floorplan.alt}
                                    fill
                                    sizes="(min-width: 1280px) 28vw, (min-width: 768px) 44vw, 50vw"
                                    className="object-contain p-1.5 transition hover:opacity-90"
                                  />
                                </Link>
                                <a
                                  href={floorplan.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="absolute right-2 top-2 z-10 rounded-full border border-line bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-forest shadow-sm backdrop-blur hover:border-forest"
                                  aria-label={`${modelName} ${preset.name}の平面図を拡大`}
                                >
                                  拡大
                                </a>
                              </div>
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center bg-[#f5f2eb] px-2 text-center text-xs text-muted">平面図準備中</div>
                            )}

                            <div className="px-3 py-2">
                              <p className="max-h-10 overflow-hidden text-[11px] leading-5 text-ink-soft">{preset.description}</p>
                              {floorplan?.caption && <p className="mt-1 truncate text-[10px] text-muted">{floorplan.caption}</p>}
                              <Link
                                href={simulatorHref}
                                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-forest underline decoration-forest/30 underline-offset-4 hover:decoration-forest"
                              >
                                この仕様で見積する
                                <ArrowRight className="size-3" aria-hidden="true" />
                              </Link>
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
