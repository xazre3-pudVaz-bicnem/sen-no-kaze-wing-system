import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { dealerRecruit, estimate } from '@/data/site-content';
import { Reveal } from '@/components/ui/reveal';
import { PairBlocks } from '@/components/ui/pair-blocks';

function EstimateTile({ b }: { b: (typeof estimate.buttons)[number] }) {
  return (
    <Link href={`/simulator/${b.slug}`} className="group block">
      <p
        className="flex items-center justify-center gap-1 rounded-t-sm px-1 py-1.5 text-[0.72rem] font-semibold tracking-wide text-white transition-opacity group-hover:opacity-85 sm:text-sm"
        style={{ backgroundColor: b.badge }}
      >
        {b.label}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </p>
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-white/40">
        <Image
          src={b.image}
          alt={b.alt}
          fill
          sizes="(min-width: 1024px) 22vw, 45vw"
          className={`${b.contain ? 'object-contain p-1.5' : 'object-cover'} transition-transform duration-500 group-hover:scale-105`}
        />
      </div>
    </Link>
  );
}

/**
 * 見積シミュレーション＋代理店様募集：Ver5 PDF の2ブロック。
 * 左＝Wing・BOXの見積タイル／右＝Flatの見積タイル＋代理店様募集。狭い画面では右が下に落ちる。
 */
export function EstimateCtaSection() {
  return (
    <section id="estimate" className="scroll-mt-20 bg-[#efe8cc] py-8 sm:py-12">
      <div className="container-x">
        <Reveal className="text-center">
          <p className="label-en text-gold">{estimate.labelEn}</p>
          <h2 className="mt-2 text-xl text-ink sm:text-2xl">{estimate.title}</h2>
          <p className="mx-auto mt-2 max-w-3xl text-[0.78rem] leading-[1.75] text-ink-soft sm:text-sm">{estimate.lead}</p>
        </Reveal>

        <PairBlocks className="mt-5 lg:items-start">
          <Reveal className="grid grid-cols-2 items-start gap-3">
            <EstimateTile b={estimate.buttons[0]} />
            <EstimateTile b={estimate.buttons[1]} />
          </Reveal>

          <Reveal id="dealer" className="grid scroll-mt-24 grid-cols-2 items-start gap-3">
            <EstimateTile b={estimate.buttons[2]} />
            <div className="h-full bg-forest p-3 text-white sm:p-4">
              <h2 className="font-serif text-sm tracking-wider text-gold sm:text-base">【{dealerRecruit.title}】</h2>
              <p className="mt-1.5 text-[0.72rem] leading-[1.7] text-white/90 sm:text-[0.8rem]">{dealerRecruit.body}</p>
              <Link href="/contact" className="mt-2 inline-flex items-center gap-1 text-[0.72rem] font-semibold text-gold-light underline-offset-4 hover:underline sm:text-sm">
                {dealerRecruit.cta}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
        </PairBlocks>
      </div>
    </section>
  );
}
