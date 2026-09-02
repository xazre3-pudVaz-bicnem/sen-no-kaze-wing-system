import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase, type ShowcaseProduct } from '@/data/site-content';
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
 * Word の商品説明ページに構成・画像・配色を合わせている（2026-09-02）。
 * 直前の QualitySection（商品説明の見出し＋共通の特長）がこのセクションのヘッダーを兼ねる。
 * どの画面幅でも「見出し → 本文 → 画像 → 補足 → 見積ボタン」の順。
 */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 text-white">
      {/* ── Wing（Word と同じ濃緑） ── */}
      <article id="wing" className="scroll-mt-24 bg-forest-deep py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={wing} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{wing.body}</p>
              {wing.highlight && (
                <p className="mt-3 border-l-2 border-gold pl-3 font-serif text-sm leading-relaxed text-gold-light sm:text-base">{wing.highlight}</p>
              )}
            </Reveal>
            {/* コラージュ：左に透過のアイソメ図（大）、右に外観1枚＋室内3枚の2×2（Word のコラージュ準拠） */}
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

          {/* 設置の流れ（Word の写真列：クレーン写真＋透過の彩色立面図3枚＋平面図） */}
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            {showcase.steps.map((s) => (
              <Reveal key={s.image} variant="image">
                <figure>
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <Image src={s.image} alt={s.alt} fill sizes="(min-width: 640px) 19vw, 45vw" className={s.image.includes('/transport/') ? 'object-cover' : 'object-contain'} />
                  </div>
                  {s.label && <figcaption className="mt-1 text-center text-[0.65rem] leading-tight text-white/80 sm:text-xs">{s.label}</figcaption>}
                </figure>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-6">
            <EstimateButton p={wing} />
          </Reveal>
        </div>
      </article>

      {/* ── BOX（先方指示：紺色） ── */}
      <article id="box" className="scroll-mt-24 bg-navy py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={box} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:gap-8">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{box.body}</p>
            </Reveal>
            {/* 外観（透過）＋内装レイアウト（スマホは2列、PCは縦積み） */}
            <Reveal variant="image" className="grid grid-cols-2 items-center gap-3 lg:grid-cols-1">
              <div className="relative aspect-[3/2] w-full">
                <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain" />
              </div>
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-white">
                <Image src={box.images[1].src} alt={box.images[1].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain p-0.5" />
              </div>
            </Reveal>
            {/* 活用トピック（Word の並び：見出し・本文の下に写真） */}
            <div className="space-y-5">
              {box.topics.map((t) => (
                <Reveal key={t.title}>
                  {t.tag && <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{t.tag}】</p>}
                  <h4 className="mt-0.5 font-serif text-sm leading-snug text-white">{t.title}</h4>
                  <p className="mt-1 text-[0.75rem] leading-[1.7] whitespace-pre-line text-white/80">{t.body}</p>
                  <div className="relative mt-2 aspect-[4/3] w-full max-w-[14rem] sm:max-w-xs">
                    <Image src={t.image} alt={t.alt} fill sizes="(min-width: 640px) 20rem, 14rem" className={t.image.endsWith('.png') ? 'object-contain' : 'object-cover'} />
                    {t.caption && (
                      <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{t.caption}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
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
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:gap-8">
            {/* 左：本文＋基本平面図（Word 準拠） */}
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{flat.body}</p>
              {flat.basicPlan && (
                <div className="relative mt-3 aspect-[21/9] w-full max-w-xs overflow-hidden bg-white sm:max-w-sm">
                  <Image src={flat.basicPlan.image} alt={flat.basicPlan.alt} fill sizes="(min-width: 640px) 24rem, 20rem" className="object-contain p-0.5" />
                </div>
              )}
            </Reveal>
            {/* 中：透過の外観CG（スマホでは控えめサイズ） */}
            <Reveal variant="image">
              <div className="relative aspect-[4/3] w-full max-w-[16rem] sm:max-w-sm lg:mx-auto lg:max-w-md">
                <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain" />
              </div>
            </Reveal>
            {/* 右：物置にもう一部屋Plus（本文 → 設置例写真 → 組合せ平面図） */}
            <div>
              <Reveal>
                <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{flat.plansTag}】</p>
                <p className="mt-1 text-[0.8rem] leading-[1.7] text-white/85 sm:text-sm">{flat.plansLead}</p>
              </Reveal>
              {flat.storagePhoto && (
                <Reveal variant="image" className="relative mt-2 aspect-[4/3] w-full max-w-[14rem] sm:max-w-xs">
                  <Image src={flat.storagePhoto.image} alt={flat.storagePhoto.alt} fill sizes="(min-width: 1024px) 22vw, 80vw" className="object-cover" />
                  <p className="absolute right-0 bottom-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{flat.storagePhoto.caption}</p>
                </Reveal>
              )}
            </div>
          </div>

          {/* 組合せ平面図（Flat＋Wing／BOX＋Flat は水回りキット＋居室の2枚重ね） */}
          {flat.plans && (
            <div className="mt-6 grid max-w-lg grid-cols-2 gap-3 sm:max-w-xl sm:gap-5">
              {flat.plans.map((pl) => (
                <Reveal key={pl.label} variant="image">
                  <figure className="space-y-1.5">
                    {pl.images.map((img) => (
                      <div key={img.image} className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                        <Image src={img.image} alt={img.alt} fill sizes="(min-width: 640px) 24vw, 45vw" className="object-contain p-1" />
                      </div>
                    ))}
                    <figcaption className="text-center font-serif text-xs tracking-wider text-gold-light">{pl.label}</figcaption>
                  </figure>
                </Reveal>
              ))}
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
