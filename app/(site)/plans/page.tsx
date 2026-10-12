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
import { ImageLightbox } from '@/components/sections/image-lightbox';

export const metadata = buildMetadata({
  title: '商品・仕様・間取り｜Wing・BOX・Flatを比較',
  description:
    'Wing・BOX・Flatの特徴と用途別仕様、組み合わせ例を、平面図と完成イメージで比較できます。違いを確認してから見積シミュレーターへ進めます。',
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

const modelPositioning: Record<
  string,
  { size: string; structure: string; uses: string; feature: string }
> = {
  'wing-01': {
    size: '3,900 × 4,800',
    structure: '折り畳み式。トラック1台分の運搬サイズから、設置後はコンテナ2個分の広さに展開',
    uses: '住宅・ホテル・事務所・店舗など',
    feature: '広い室内空間と木造ならではの雰囲気を両立',
  },
  box: {
    size: '2,100 × 4,800',
    structure: '固定式。上下に重ねて、2階建て以上の構成にも対応可能',
    uses: 'ホテル・ワンルーム・仮設事務所・水回りユニットなど',
    feature: 'コンパクトに機能をまとめやすく、Wingと水回りキットとして組み合わせ可能',
  },
  flat: {
    size: '2,100 × 1,800〜4,800（複数サイズあり）',
    structure: '水平折り畳み式。平らに折り畳んで平積み配送可能',
    uses: '物置・寝室・書斎・事務所など、追加の一室として',
    feature: 'Wing＋Flatで2LDK、BOX＋Flatなど、他モデルと組み合わせて使いやすい',
  },
};

const combinationExamples = [
  {
    id: 'wing-box',
    name: 'Wing + BOX',
    image: '/images/plan/wing-box-combo.jpg',
    summary: 'Wingを広く使い、BOX側に水回りや個室をまとめる組み合わせです。',
    roles: ['Wing：広い主空間', 'BOX：水回り・個室'],
    modelSlugs: ['wing-01', 'box'],
  },
  {
    id: 'wing-flat',
    name: 'Wing + Flat',
    image: '/images/plan/flat-wing-2ldk.jpg',
    summary: 'Wingを中心に、Flatを寝室や書斎などの一室として加える組み合わせです。',
    roles: ['Wing：主空間', 'Flat：寝室・書斎など'],
    modelSlugs: ['wing-01', 'flat'],
  },
  {
    id: 'box-flat',
    name: 'BOX + Flat',
    image: '/images/plan/box-flat-combo.jpg',
    summary: 'BOXに水回りや個室をまとめ、Flatを必要な一室として加える組み合わせです。',
    roles: ['BOX：設備・個室', 'Flat：追加空間'],
    modelSlugs: ['box', 'flat'],
  },
] as const;

type PlanImage = { url: string; alt: string; caption: string | null };

function displayModelName(name: string) {
  return name === 'フラット' ? 'Flat' : name;
}

function registeredRepresentativePerspective(bundle: CatalogBundle): PlanImage | null {
  const rule = bundle.previewRules
    .filter((row) => row.view === 'exterior' && row.kind === 'composite' && row.status === 'published')
    .sort((a, c) => a.preview_keys.length - c.preview_keys.length)[0] ?? null;
  return rule ? { url: rule.url, alt: rule.alt, caption: null } : null;
}

function legacyCommonPerspective(images: CatalogBundle['images']): PlanImage | null {
  const image =
    images.find((row) => row.kind === 'hero') ??
    images.find((row) => row.kind === 'exterior') ??
    images.find((row) => row.kind === 'interior') ??
    null;
  return image ? { url: image.url, alt: image.alt, caption: image.caption } : null;
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
  const availableModelSlugs = new Set(models.map((model) => model.slug));
  const modelNavItems = models.map((model) => {
    const bundle = bundles[model.id];
    const images = bundle?.images ?? [];
    const image = (bundle ? registeredRepresentativePerspective(bundle) : null) ?? legacyCommonPerspective(images);
    return { model, image };
  });
  const representativeImageBySlug = new Map(modelNavItems.map(({ model, image }) => [model.slug, image] as const));
  const visibleCombinations = combinationExamples.filter((combination) =>
    combination.modelSlugs.every((slug) => availableModelSlugs.has(slug))
  );

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り', path: '/plans' }])} />

      <Container className="pt-7 sm:pt-9">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品・仕様・間取り' }]} />
        <Reveal className="max-w-3xl pb-5 pt-7 sm:pb-6 sm:pt-8">
          <p className="label-en text-forest">Plans &amp; styles</p>
          <h1 className="mt-2.5 text-3xl sm:text-4xl">間取りからモデルを選ぶ</h1>
          <p className="mt-2.5 text-sm leading-6 text-ink-soft sm:text-base">
            外観・特徴・間取りを見ながら、Wing・BOX・Flatの違いや組み合わせ例を比較できます。
          </p>
        </Reveal>

        {models.length > 0 && (
          <nav
            aria-label="商品・組み合わせ"
            className="sticky top-0 z-20 -mx-4 border-y border-line bg-white/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
          >
            <div>
              <p className="mb-1.5 text-[10px] font-semibold text-muted">単体モデル</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {modelNavItems.map(({ model, image }) => (
                  <Link
                    key={model.id}
                    href={`#model-${model.slug}`}
                    className="flex min-w-[7.2rem] shrink-0 items-center gap-2 rounded-lg border border-line bg-white p-1.5 text-ink-soft shadow-sm transition hover:border-forest hover:text-forest"
                  >
                    <span className="relative h-9 w-12 shrink-0 overflow-hidden rounded-md bg-sand">
                      {image ? (
                        <SmartImage src={image.url} alt="" fill sizes="48px" className="object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-[9px] text-muted">画像準備中</span>
                      )}
                    </span>
                    <span className="whitespace-nowrap text-xs font-semibold">{displayModelName(model.name)}</span>
                  </Link>
                ))}
              </div>
            </div>

            {visibleCombinations.length > 0 && (
              <div className="mt-2 border-t border-line/70 pt-2">
                <p className="mb-1.5 text-[10px] font-semibold text-muted">組み合わせ</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {visibleCombinations.map((combination) => (
                    <Link
                      key={combination.id}
                      href={`#combo-${combination.id}`}
                      className="flex min-w-[8.6rem] shrink-0 items-center gap-2 rounded-lg border border-line bg-white p-1.5 text-ink-soft shadow-sm transition hover:border-forest hover:text-forest"
                    >
                      <span className="flex h-9 w-12 shrink-0 overflow-hidden rounded-md bg-sand">
                        {combination.modelSlugs.map((slug) => {
                          const image = representativeImageBySlug.get(slug) ?? null;
                          return (
                            <span key={slug} className="relative h-full min-w-0 flex-1 border-r border-white/70 last:border-r-0">
                              {image ? (
                                <SmartImage src={image.url} alt="" fill sizes="24px" className="object-cover" />
                              ) : (
                                <span className="flex h-full items-center justify-center text-[7px] text-muted">—</span>
                              )}
                            </span>
                          );
                        })}
                      </span>
                      <span className="whitespace-nowrap text-xs font-semibold">{combination.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
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
            const commonPerspective = registeredRepresentativePerspective(bundle) ?? legacyCommonPerspective(images);
            const presets = model.presets ?? [];
            const modelName = displayModelName(model.name);
            const modelFeatures = model.features.slice(0, 4);
            const positioning = modelPositioning[model.slug] ?? null;

            return (
              <section
                key={model.id}
                id={`model-${model.slug}`}
                className={`scroll-mt-40 border-t border-line ${modelIndex % 2 === 0 ? 'bg-ivory' : 'bg-white'}`}
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
                          <span className="text-xs font-semibold text-forest">代表パース</span>
                          <span className="text-[10px] text-muted">{modelName}</span>
                        </div>
                        {commonPerspective ? (
                          <div className="relative aspect-[4/3] bg-sand">
                            <ImageLightbox
                              src={commonPerspective.url}
                              alt={commonPerspective.alt}
                              title={`${modelName}の代表パース`}
                              triggerSizes="(min-width: 768px) 32vw, 92vw"
                              triggerImageClassName="object-cover transition hover:opacity-90"
                              modalImageClassName="object-contain p-2 sm:p-4"
                              modalBackgroundClassName="bg-sand"
                            />
                          </div>
                        ) : (
                          <div className="flex aspect-[4/3] items-center justify-center bg-sand px-3 text-center text-xs text-muted">パース準備中</div>
                        )}
                      </div>
                    </Reveal>

                    <Reveal className="rounded-xl border border-line bg-white p-3.5 shadow-sm sm:p-4">
                      <h3 className="font-serif text-base sm:text-lg">{modelName} の特徴</h3>
                      {positioning ? (
                        <dl className="mt-3 divide-y divide-line/80 border-t border-line/80">
                          <div className="grid gap-1 py-3 sm:grid-cols-[5rem_1fr] sm:gap-4">
                            <dt className="text-[10px] font-semibold text-muted">基本サイズ</dt>
                            <dd className="text-xs font-semibold leading-5 text-ink-soft sm:text-sm">{positioning.size}</dd>
                          </div>
                          <div className="grid gap-1 py-3 sm:grid-cols-[5rem_1fr] sm:gap-4">
                            <dt className="text-[10px] font-semibold text-muted">構造</dt>
                            <dd className="text-xs font-semibold leading-5 text-ink-soft sm:text-sm">{positioning.structure}</dd>
                          </div>
                          <div className="grid gap-1 py-3 sm:grid-cols-[5rem_1fr] sm:gap-4">
                            <dt className="text-[10px] font-semibold text-muted">用途</dt>
                            <dd className="text-xs font-semibold leading-5 text-ink-soft sm:text-sm">{positioning.uses}</dd>
                          </div>
                          <div className="grid gap-1 py-3 sm:grid-cols-[5rem_1fr] sm:gap-4">
                            <dt className="text-[10px] font-semibold text-muted">特徴</dt>
                            <dd className="text-xs font-semibold leading-5 text-ink-soft sm:text-sm">{positioning.feature}</dd>
                          </div>
                        </dl>
                      ) : modelFeatures.length > 0 ? (
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
                      <p className="mt-0.5 text-[11px] text-muted">用途に合う間取りを見比べられます。平面図を押すと大きく確認できます。</p>
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
                                <ImageLightbox
                                  src={floorplan.url}
                                  alt={floorplan.alt}
                                  title={`${modelName} ${preset.name}の平面図`}
                                  triggerSizes="(min-width: 1280px) 28vw, (min-width: 768px) 44vw, 50vw"
                                  triggerImageClassName="object-contain p-1.5 transition hover:opacity-90"
                                />
                              </div>
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center bg-[#f5f2eb] px-2 text-center text-xs text-muted">平面図準備中</div>
                            )}

                            <div className="px-3 py-2">
                              <p className="max-h-10 overflow-hidden text-[11px] leading-5 text-ink-soft">{preset.description}</p>
                              {floorplan?.caption && <p className="mt-1 truncate text-[10px] text-muted">{floorplan.caption}</p>}
                              <Link
                                href={simulatorHref}
                                className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-forest underline decoration-forest/30 underline-offset-4 hover:decoration-forest sm:text-sm"
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

          {visibleCombinations.length > 0 && (
            <section className="border-t border-line bg-white">
              <Container className="py-8 sm:py-10">
                <Reveal>
                  <p className="label-en text-forest">Combinations</p>
                  <h2 className="mt-1 text-3xl sm:text-4xl">組み合わせ例</h2>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    単体だけでなく、用途に合わせてモデル同士を組み合わせることもできます。
                  </p>
                </Reveal>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  {visibleCombinations.map((combination) => (
                    <Reveal
                      key={combination.id}
                      id={`combo-${combination.id}`}
                      className="scroll-mt-40 overflow-hidden rounded-xl border border-line bg-ivory shadow-sm"
                    >
                      <div className="relative aspect-[4/3] bg-white">
                        <ImageLightbox
                          src={combination.image}
                          alt={`${combination.name}の組み合わせ例`}
                          title={`${combination.name}の組み合わせ平面図`}
                          triggerSizes="(min-width: 768px) 31vw, 92vw"
                          triggerImageClassName="object-contain p-2 transition hover:opacity-90"
                        />
                      </div>
                      <div className="border-t border-line bg-white p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-serif text-lg">{combination.name}</h3>
                          <span className="text-[10px] text-muted">組み合わせ例</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-ink-soft">{combination.summary}</p>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {combination.roles.map((role) => (
                            <span key={role} className="rounded-full bg-ivory px-2.5 py-1 text-[10px] font-semibold text-ink-soft">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>

                <Reveal className="mt-6 flex justify-center">
                  <ButtonLink href="/contact?topic=multi-model" size="sm">
                    組み合わせについて問い合わせる
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </ButtonLink>
                </Reveal>
              </Container>
            </section>
          )}
        </div>
      )}
    </>
  );
}
