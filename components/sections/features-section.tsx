import { Check } from 'lucide-react';
import { features } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 商品のメリット：不陸調整折畳み式木造コンテナの特徴（枠で囲まない素のチェックリスト。2026-09-02 先方指摘対応） */
export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x">
        <RuleHeading labelEn={features.labelEn} title={features.title} lead={features.lead} tone="light" compact />
        <Reveal>
          <ul className="mt-4 grid gap-x-10 gap-y-1.5 sm:mt-6 sm:grid-cols-2">
            {features.items.map((t) => (
              <li key={t} className="flex items-start gap-2 text-[0.8rem] leading-[1.6] text-ink sm:text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
