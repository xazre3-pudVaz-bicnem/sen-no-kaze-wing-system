import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { showcase } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 商品ラインナップ：Wing / BOX / Flat の紹介と見積導線（2026-09-01 トップ修正案） */
export function ProductShowcase() {
  return (
    <section id="lineup" className="scroll-mt-20 bg-forest-deep py-20 text-white sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={showcase.labelEn} title={showcase.title} />

        <div className="mt-4 space-y-24 sm:space-y-32">
          {showcase.products.map((p, idx) => (
            <article key={p.id} id={p.id} className="scroll-mt-24">
              {/* 見出し */}
              <Reveal>
                <p className="font-serif text-base tracking-wider text-white/80 sm:text-xl">{p.catch}</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                  <h3 className="font-serif text-3xl leading-tight text-gold sm:text-5xl">{p.name}</h3>
                  <p className="border border-white/30 px-3 py-1 text-xs tracking-[0.15em] text-white/85 sm:text-sm">{p.size}</p>
                </div>
              </Reveal>

              {/* 本文＋メイン画像 */}
              <div className="mt-8 grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
                <Reveal className={idx % 2 === 1 ? 'lg:order-2' : ''}>
                  <p className="text-sm leading-[2] whitespace-pre-line text-white/85 sm:text-base">{p.body}</p>
                  {p.highlight && <p className="mt-6 border-l-2 border-gold pl-4 font-serif text-base leading-relaxed text-gold-light sm:text-lg">{p.highlight}</p>}
                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link href={`/simulator/${p.slug}`} className="btn-gold">
                      {showcase.cta}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                    <Link href={`/products/${p.slug}`} className="btn-outline-gold">
                      {showcase.detail}
                    </Link>
                  </div>
                </Reveal>
                <Reveal variant="image" className={idx % 2 === 1 ? 'lg:order-1' : ''}>
                  {p.images.length === 1 ? (
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                      <Image src={p.images[0].src} alt={p.images[0].alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-contain" />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {p.images.map((img) => (
                        <div key={img.src} className="relative aspect-[4/3] w-full overflow-hidden bg-white/5">
                          <Image src={img.src} alt={img.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </Reveal>
              </div>

              {/* 活用トピック（土地活用例・組合せなど） */}
              {p.topics.length > 0 && (
                <div className={`mt-10 grid gap-6 sm:grid-cols-2 ${p.topics.length >= 3 ? 'lg:grid-cols-3' : ''}`}>
                  {p.topics.map((t, i) => (
                    <Reveal key={t.title} delay={i * 80} className="flex h-full flex-col border border-forest-line bg-forest/60">
                      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                        <Image src={t.image} alt={t.alt} fill sizes="(min-width: 1024px) 30vw, 90vw" className="object-cover" />
                        {t.caption && (
                          <p className="absolute bottom-0 left-0 bg-forest-deep/80 px-3 py-1 font-serif text-sm tracking-wider text-gold-light">{t.caption}</p>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        {t.tag && <p className="text-xs tracking-[0.2em] text-gold">【{t.tag}】</p>}
                        <h4 className="mt-2 font-serif text-lg leading-snug text-white">{t.title}</h4>
                        <p className="mt-3 text-sm leading-[1.9] whitespace-pre-line text-white/85">{t.body}</p>
                      </div>
                    </Reveal>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
