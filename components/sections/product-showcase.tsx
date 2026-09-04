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
    <Link href={`/simulator/${p.slug}`} className="btn-gold btn-sm mt-4">
      {showcase.cta}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/**
 * 商品ラインナップ：Wing / BOX / Flat。
 * スマホは Word の赤線指示どおり「左列 → 右列」の順で1列に流す（見積ボタンは Word と同じく説明文の直下）。
 */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 text-white">
      {/* ── Wing（濃緑） ── */}
      <article id="wing" className="scroll-mt-24 bg-forest-deep py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={wing} />
          <div className="mt-4 grid items-start gap-5 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{wing.body}</p>
              {wing.highlight && (
                <p className="mt-3 border-l-2 border-gold pl-3 font-serif text-sm leading-relaxed whitespace-pre-line text-gold-light sm:text-base">{wing.highlight}</p>
              )}
              <EstimateButton p={wing} />
            </Reveal>
            {/* コラージュ：左に透過のアイソメ図（大）、右に外観1枚＋室内3枚の2×2 */}
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
          {/* コラージュ下のキャプション（Ver4） */}
          {wing.caption && (
            <Reveal>
              <p className="mt-3 text-center text-[0.8rem] leading-relaxed text-white/90 sm:text-right sm:text-sm">{wing.caption}</p>
            </Reveal>
          )}
          {/* 立面図4面（Ver4：玄関側・木板窓戸・設備側・木板） */}
          <div className="mt-5 grid grid-cols-4 items-end gap-2 sm:gap-3">
            {[
              { src: '/images/elevation/wing-entrance-color.png', alt: '木製玄関ドアのある白い外壁の立面図', ar: 'aspect-[556/365]' },
              { src: '/images/elevation/wing-roof-face.png', alt: '窓と戸のある木板張りの立面図', ar: 'aspect-[912/420]' },
              { src: '/images/elevation/wing-equipment-side.png', alt: '給湯器とエアコン室外機、ユニットバスの窓が並ぶ設備側の立面図', ar: 'aspect-[631/390]' },
              { src: '/images/elevation/wing-wood-panel.png', alt: '木板張りの外壁パネル', ar: 'aspect-[872/392]' },
            ].map((e) => (
              <Reveal key={e.src} variant="image" className={`relative w-full ${e.ar}`}>
                <Image src={e.src} alt={e.alt} fill sizes="(min-width: 640px) 23vw, 24vw" className="object-contain" />
              </Reveal>
            ))}
          </div>
        </div>
      </article>

      {/* ── BOX（紺） ── */}
      <article id="box" className="scroll-mt-24 bg-[#0b4f66] py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={box} />
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:items-start lg:gap-8">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{box.body}</p>
              <EstimateButton p={box} />
            </Reveal>
            {/* 外観（透過）＋内装レイアウト */}
            <Reveal variant="image" className="grid grid-cols-2 items-center gap-3 lg:grid-cols-1">
              <div className="relative aspect-[3/2] w-full">
                <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain" />
              </div>
              <div className="relative aspect-[21/9] w-full overflow-hidden bg-white">
                <Image src={box.images[1].src} alt={box.images[1].alt} fill sizes="(min-width: 1024px) 32vw, 45vw" className="object-contain p-0.5" />
              </div>
            </Reveal>
            {/* 活用トピック：スマホは「文章｜写真」の2列（2026-09-03 赤入れ）、PCは文章の下に写真 */}
            <div className="space-y-5">
              {box.topics.map((t) => (
                <Reveal key={t.title} className="grid grid-cols-2 items-start gap-3 lg:block">
                  <div>
                    {t.tag && <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{t.tag}】</p>}
                    <h4 className="mt-0.5 font-serif text-sm leading-snug text-white">{t.title}</h4>
                    <p className="mt-1 text-[0.72rem] leading-[1.7] whitespace-pre-line text-white/80">{t.body}</p>
                  </div>
                  <div className="relative aspect-[4/3] w-full lg:mt-2 lg:max-w-xs">
                    <Image src={t.image} alt={t.alt} fill sizes="(min-width: 1024px) 20rem, 45vw" className={t.image.endsWith('.png') ? 'object-contain' : 'object-cover'} />
                    {t.caption && (
                      <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{t.caption}</p>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </article>

      {/* ── Flat（黒）。スマホは説明→基本平面図→外観CG→物置Plus→組合せ図の1列（Word の赤線指示） ── */}
      <article id="flat" className="scroll-mt-24 bg-[#303030] py-10 sm:py-12">
        <div className="container-x">
          <ProductHeading p={flat} />
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.9fr_1.1fr_1fr] lg:items-start lg:gap-8">
            <Reveal className="lg:col-start-1 lg:row-start-1">
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{flat.body}</p>
              <EstimateButton p={flat} />
            </Reveal>
            {flat.basicPlan && (
              <Reveal variant="image" className="lg:col-start-1 lg:row-start-2">
                <div className="relative aspect-[21/9] w-full max-w-sm overflow-hidden bg-white">
                  <Image src={flat.basicPlan.image} alt={flat.basicPlan.alt} fill sizes="(min-width: 640px) 24rem, 80vw" className="object-contain p-0.5" />
                </div>
              </Reveal>
            )}
            <Reveal variant="image" className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <div className="relative aspect-[4/3] w-full max-w-[18rem] sm:max-w-sm lg:mx-auto lg:max-w-md">
                <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 32vw, 60vw" className="object-contain" />
              </div>
            </Reveal>
            <div className="lg:col-start-3 lg:row-span-2 lg:row-start-1">
              <Reveal>
                <p className="text-[0.65rem] tracking-[0.15em] text-gold">【{flat.plansTag}】</p>
                <p className="mt-1 text-[0.75rem] leading-[1.7] text-white/85 sm:text-sm">{flat.plansLead}</p>
              </Reveal>
              {flat.storagePhoto && (
                <Reveal variant="image" className="mt-2 w-full max-w-[13rem] sm:max-w-[15rem]">
                  <div className="relative aspect-[4/3] w-full">
                    <Image src={flat.storagePhoto.image} alt={flat.storagePhoto.alt} fill sizes="(min-width: 1024px) 20vw, 55vw" className="object-cover" />
                    <p className="absolute right-0 bottom-0 bg-forest-deep/80 px-2 py-0.5 font-serif text-xs tracking-wider text-gold-light">{flat.storagePhoto.caption}</p>
                  </div>
                  {flat.storagePhoto.note && <p className="mt-1 text-[0.7rem] text-white/80">{flat.storagePhoto.note}</p>}
                </Reveal>
              )}
            </div>
          </div>

          {/* 組合せ平面図（BOX＋Flat は合成済みの1枚画像。2026-09-04「変です」対応） */}
          {flat.plans && (
            <div className="mt-6 grid max-w-lg grid-cols-2 gap-3 sm:max-w-xl sm:gap-5">
              {flat.plans.map((pl) => (
                <Reveal key={pl.label} variant="image">
                  <figure>
                    {pl.images.map((img) => (
                      <div key={img.image} className="relative aspect-square w-full overflow-hidden bg-white">
                        <Image src={img.image} alt={img.alt} fill sizes="(min-width: 640px) 24vw, 45vw" className="object-contain p-1" />
                      </div>
                    ))}
                    <figcaption className="mt-1 text-center font-serif text-xs tracking-wider text-gold-light">{pl.label}</figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
