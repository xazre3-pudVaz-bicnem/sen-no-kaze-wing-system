import Image from 'next/image';
import { Check } from 'lucide-react';
import { quality } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 品質：Wing・BOX・Flat 共通の特長＋設置の流れ（2026-09-01 トップ修正案） */
export function QualitySection() {
  return (
    <section id="quality" className="scroll-mt-20 bg-paper py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={quality.labelEn} title={quality.title} lead={quality.lead} tone="light" />

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quality.items.map((t) => (
            <li key={t}>
              <Reveal className="flex h-full items-start gap-4 border border-brown/20 bg-white p-6">
                <Check className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
                <span className="text-sm leading-relaxed text-ink sm:text-base">{t}</span>
              </Reveal>
            </li>
          ))}
        </ul>

        {/* 設置の流れ・仕組み（キャプション付き画像列） */}
        <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7 lg:gap-3">
          {quality.steps.map((s, i) => (
            <Reveal key={s.label} variant="image" delay={i * 60} className="group">
              <figure>
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
                  <Image src={s.image} alt={s.alt} fill sizes="(min-width: 1024px) 15vw, 45vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
                </div>
                <figcaption className="mt-2 text-center text-xs leading-snug text-ink-soft sm:text-sm">{s.label}</figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
