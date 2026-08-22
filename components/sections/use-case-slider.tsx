'use client';

import Image from 'next/image';
import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { idea } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';

/** 活用アイディア：番号入りの大きなカードを横スクロールで見せる */
export function UseCaseSlider() {
  const track = useRef<HTMLUListElement>(null);
  const scrollBy = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 520), behavior: 'smooth' });
  };

  return (
    <section id="idea" className="scroll-mt-20 bg-forest py-20 sm:py-28">
      <div className="container-x flex flex-wrap items-end justify-between gap-6">
        <RuleHeading labelEn={idea.labelEn} title={idea.title} lead={idea.lead} className="max-w-2xl" />
        <div className="flex gap-2">
          <button type="button" onClick={() => scrollBy(-1)} aria-label="前へ" className="inline-flex size-11 items-center justify-center rounded-full border border-gold/60 text-gold hover:bg-gold hover:text-forest-deep">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label="次へ" className="inline-flex size-11 items-center justify-center rounded-full border border-gold/60 text-gold hover:bg-gold hover:text-forest-deep">
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ul
        ref={track}
        className="mt-12 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-4 sm:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="活用アイディアの一覧"
      >
        {idea.cases.map((c) => (
          <li key={c.no} className="w-[78vw] shrink-0 snap-start sm:w-[22rem]">
            <figure className="relative aspect-[3/4] w-full overflow-hidden">
              <Image src={c.image} alt={c.alt} fill sizes="(min-width: 640px) 22rem, 78vw" className="object-cover" />
              <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" aria-hidden="true" />
              <figcaption className="absolute inset-x-0 bottom-0 p-6 text-white">
                <span className="label-en block text-white/70">CASE</span>
                <span className="block font-serif text-4xl leading-none">{c.no}</span>
                <span className="mt-3 block font-serif text-xl">{c.category}</span>
                <span className="mt-1 block text-sm font-semibold">{c.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-white/80">{c.body}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
