import { Check } from 'lucide-react';
import { features } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 商品のメリット：不陸調整折畳み式木造コンテナの特徴（2026-09-01 トップ修正案） */
export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 bg-paper py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={features.labelEn} title={features.title} lead={features.lead} tone="light" />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16">
          {features.items.map((t) => (
            <li key={t}>
              <Reveal className="flex h-full items-start gap-4 border border-brown/20 bg-white p-6">
                <Check className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
                <span className="text-sm leading-relaxed text-ink sm:text-base">{t}</span>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
