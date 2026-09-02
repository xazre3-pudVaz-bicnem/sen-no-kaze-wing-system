import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { dealerRecruit } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 代理店募集：地域の代理店募集の案内（2026-09-02 文字・余白を圧縮） */
export function DealerCtaSection() {
  return (
    <section id="dealer" className="scroll-mt-20 bg-paper py-8 sm:py-12">
      <div className="container-x grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
        <div>
          <RuleHeading labelEn={dealerRecruit.labelEn} title={dealerRecruit.title} tone="light" compact />
          <Reveal className="mt-4">
            <p className="text-[0.8rem] leading-[1.8] text-ink-soft sm:text-sm">{dealerRecruit.body}</p>
            <Link href="/contact" className="btn-primary btn-sm mt-4">
              {dealerRecruit.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
        <Reveal variant="image">
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <Image src={dealerRecruit.image} alt={dealerRecruit.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
