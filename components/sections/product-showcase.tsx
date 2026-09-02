import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase, type ShowcaseProduct } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 商品見出し：「よりコンパクトに合理的に・・・ BOX（基本 2,100×4,800）」の帯（Word 準拠） */
function ProductHeading({ p }: { p: ShowcaseProduct }) {
  return (
    <Reveal>
      <p className="font-serif text-sm tracking-wider text-white/85 sm:text-base">{p.catch}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-2xl leading-tight text-gold sm:text-3xl">{p.name}</h3>
        <p className="text-xs tracking-[0.1em] text-white/80 sm:text-sm">（{p.size}）</p>
      </div>
    </Reveal>
  );
}

function EstimateButton({ p }: { p: ShowcaseProduct }) {
  return (
    <Link href={`/simulator/${p.slug}`} className="btn-gold btn-sm">
      {showcase.cta}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * 商品ラインナップ：Wing / BOX / Flat。
 * Word 準拠（2026-09-02 赤入れ）：ブロックごとの背景色（緑／青緑／黒）、透過画像は背景に直置き、
 * どの画面幅でも「見出し → 本文 → 画像 → 補足 → 見積ボタン」の順で並ぶ。
 */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 text-white">
      {/* ── Wing（Word と同じ濃緑） ── */}
      <article id="wing" className="scroll-mt-24 bg-forest-deep py-10 sm:py-12">
        <div className="container-x">
          <RuleHeading labelEn={showcase.labelEn} title={showcase.title} compact className="mb-8" />
          <ProductHeading p={wing} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{wing.body}</p>
              {wing.highlight && (
                <p className="mt-3 border-l-2 border-gold pl-3 font-serif text-sm leading-relaxed text-gold-light sm:text-base">{wing.highlight}</p>
              )}
            </Reveal>
            {/* コラージュ：左に透過のアイソメ図（大）、右に外観1枚＋室内3枚の2×2（切れないよう16:9） */}
            <Reveal variant="image">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="relative row-span-2">
                  <Image src={wing.images[0].src} alt={wing.images[0].alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-contain" />
                </div>
                {wing.images.slice(1, 5).map((img) => (
                  <div key={img.src} className="relative aspect-video overflow-hidden">
                    <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* 設置の流れ（Word の写真列：クレーン写真＋透過の彩色立面図＋平面図） */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {showcase.steps.map((s) => (
              <Reveal key={s.label} variant="image">
                <figure>
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <Image src={s.image} alt={s.alt} fill sizes="(min-width: 640px) 23vw, 45vw" className={s.image.includes('/transport/') ? 'object-cover' : 'object-contain'} />
                  </div>
                  <figcaption className="mt-1 text-center text-[0.65rem] leading-tight text-white/80 sm:text-xs">{s.label}</figcaption>
                </figure>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-6">
            <EstimateButton p={wing} />
          </Reveal>
        </div>
      </article>

      {/* ── BOX（先方指示 2026-09-02：紺色） ── */}
      <article id="box" className="scroll-mt-24 bg-navy py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={box} />
          <div className="mt-4 grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{box.body}</p>
            </Reveal>
            <Reveal variant="image">
              <div className="relative mx-auto aspect-[3/2] w-full max-w-md">
                <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 36vw, 90vw" className="object-contain" />
              </div>
            </Reveal>
          </div>

          {/* 活用トピック（土地活用例・事務所やワンルーム） */}
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {box.topics.map((t) => (
              <Reveal key={t.title} variant="image">
                <div className="relative aspect-[4/3] w-full">
                  <Image src={t.image} alt={t.alt} fill sizes="(min-width: 1024px) 30vw, 90vw" className={t.image.endsWith('.png') ? 'object-contain' : 'object-cover'} />
                  {t.caption && (
                    <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{t.caption}</p>
                  )}
                </div>
                <div className="mt-2">
                  {t.tag && <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{t.tag}】</p>}
                  <h4 className="mt-0.5 font-serif text-sm leading-snug text-white">{t.title}</h4>
                  <p className="mt-1 text-[0.75rem] leading-[1.7] whitespace-pre-line text-white/80">{t.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-6">
            <EstimateButton p={box} />
          </Reveal>
        </div>
      </article>

      {/* ── Flat（Word と同じ黒） ── */}
      <article id="flat" className="scroll-mt-24 bg-[#303030] py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={flat} />
          <div className="mt-4 grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{flat.body}</p>
            </Reveal>
            {/* 透過の外観CG＋玄関先の設置例（Word 準拠） */}
            <Reveal variant="image">
              <div className="grid grid-cols-2 items-center gap-3">
                <div className="relative aspect-[4/3]">
                  <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 26vw, 45vw" className="object-contain" />
                </div>
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image src={flat.images[1].src} alt={flat.images[1].alt} fill sizes="(min-width: 1024px) 26vw, 45vw" className="object-cover" />
                </div>
              </div>
            </Reveal>
          </div>

          {flat.plans && (
            <div className="mt-6">
              <Reveal>
                <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{flat.plansTag}】</p>
                <p className="mt-1 text-[0.8rem] leading-[1.7] text-white/85 sm:text-sm">{flat.plansLead}</p>
              </Reveal>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-4">
                {flat.plans.map((pl) => (
                  <Reveal key={pl.label} variant="image">
                    <figure>
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                        <Image src={pl.image} alt={pl.alt} fill sizes="(min-width: 640px) 30vw, 32vw" className="object-contain p-1" />
                        <figcaption className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">
                          {pl.label}
                        </figcaption>
                      </div>
                    </figure>
                  </Reveal>
                ))}
              </div>
            </div>
          )}

          <Reveal className="mt-6">
            <EstimateButton p={flat} />
          </Reveal>
        </div>
      </article>
    </section>
  );
}
