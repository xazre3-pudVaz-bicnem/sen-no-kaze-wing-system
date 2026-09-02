import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { dealerRecruit } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 代理店募集：地域の代理店募集の案内（2026-09-01 トップ修正案） */
export function DealerCtaSection() {
  return (
    <section id="dealer" className="scroll-mt-20 bg-paper py-20 sm:py-28">
      <div className="container-x grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <RuleHeading labelEn={dealerRecruit.labelEn} title={dealerRecruit.title} tone="light" />
          <Reveal className="mt-8">
            <p className="text-sm leading-[2] text-ink-soft sm:text-base">{dealerRecruit.body}</p>
            <Link href="/contact" className="btn-primary mt-8">
              {dealerRecruit.cta}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
        <Reveal variant="image">
          <div className="relative aspect-[16/10] w-full overflow-hidden">
            <Image src={dealerRecruit.image} alt={dealerRecruit.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
