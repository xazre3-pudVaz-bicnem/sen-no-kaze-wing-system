import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase, type ShowcaseProduct } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 商品見出し：緑地に「よりコンパクトに合理的に・・・ BOX（基本 2,100×4,800）」の帯（Word 準拠） */
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

/** 商品ラインナップ：Wing / BOX / Flat（2026-09-02 Word のレイアウトに合わせて高密度化） */
export function ProductShowcase() {
  const [wing, box, flat] = showcase.products;
  return (
    <section id="lineup" className="scroll-mt-20 bg-forest-deep py-10 text-white sm:py-14">
      <div className="container-x">
        <RuleHeading labelEn={showcase.labelEn} title={showcase.title} compact />

        {/* ── Wing ── */}
        <article id="wing" className="mt-8 scroll-mt-24">
          <ProductHeading p={wing} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{wing.body}</p>
              {wing.highlight && (
                <p className="mt-3 border-l-2 border-gold pl-3 font-serif text-sm leading-relaxed text-gold-light sm:text-base">{wing.highlight}</p>
              )}
              <Link href={`/simulator/${wing.slug}`} className="btn-gold btn-sm mt-4">
                {showcase.cta}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Reveal>
            {/* コラージュ：上段に外観3枚、下段にアイソメ図（大）＋室内2枚（Word のコラージュ準拠） */}
            <Reveal variant="image">
              <div className="grid grid-cols-3 gap-1.5">
                {wing.images.slice(0, 3).map((img) => (
                  <div key={img.src} className="relative aspect-[4/3] overflow-hidden">
                    <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-cover" />
                  </div>
                ))}
                {/* 下段：縦長のアイソメ図（大）＋室内2枚を縦に */}
                <div className="relative col-span-2 row-span-2 aspect-[5/4] overflow-hidden bg-white">
                  <Image src={wing.images[3].src} alt={wing.images[3].alt} fill sizes="(min-width: 1024px) 36vw, 64vw" className="object-contain p-1" />
                </div>
                {wing.images.slice(4, 6).map((img) => (
                  <div key={img.src} className="relative overflow-hidden">
                    <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 18vw, 32vw" className="object-cover" />
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          {/* 設置の流れ（Word の写真列） */}
          <div className="mt-6 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {showcase.steps.map((s) => (
              <Reveal key={s.label} variant="image">
                <figure>
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                    <Image src={s.image} alt={s.alt} fill sizes="(min-width: 640px) 14vw, 24vw" className="object-cover" />
                  </div>
                  <figcaption className="mt-1 text-center text-[0.65rem] leading-tight text-white/80 sm:text-xs">{s.label}</figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </article>

        {/* ── BOX ── */}
        <article id="box" className="mt-12 scroll-mt-24 border-t border-forest-line pt-8">
          <ProductHeading p={box} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{box.body}</p>
              <Link href={`/simulator/${box.slug}`} className="btn-gold btn-sm mt-4">
                {showcase.cta}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <div className="relative mt-4 aspect-[4/3] w-full max-w-sm overflow-hidden bg-white">
                <Image src={box.images[0].src} alt={box.images[0].alt} fill sizes="(min-width: 1024px) 30vw, 90vw" className="object-contain p-1" />
              </div>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-2">
              {box.topics.map((t) => (
                <Reveal key={t.title} variant="image">
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                    <Image src={t.image} alt={t.alt} fill sizes="(min-width: 1024px) 26vw, 45vw" className="object-cover" />
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
          </div>
        </article>

        {/* ── Flat ── */}
        <article id="flat" className="mt-12 scroll-mt-24 border-t border-forest-line pt-8">
          <ProductHeading p={flat} />
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-10">
            <Reveal>
              <p className="text-[0.8rem] leading-[1.8] whitespace-pre-line text-white/85 sm:text-sm">{flat.body}</p>
              <Link href={`/simulator/${flat.slug}`} className="btn-gold btn-sm mt-4">
                {showcase.cta}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Reveal>
            <Reveal variant="image">
              <div className="relative aspect-[4/3] w-full max-w-sm overflow-hidden bg-white lg:ml-auto">
                <Image src={flat.images[0].src} alt={flat.images[0].alt} fill sizes="(min-width: 1024px) 30vw, 90vw" className="object-contain p-1" />
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
        </article>
      </div>
    </section>
  );
}
