import { Check } from 'lucide-react';
import { quality } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';

/** 品質：Wing・BOX・Flat 共通の特長（枠なしのコンパクトなチェックリスト。設置の流れは商品ラインナップ側へ移動） */
export function QualitySection() {
  return (
    <section id="quality" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x">
        <RuleHeading labelEn={quality.labelEn} title={quality.title} lead={quality.lead} tone="light" compact />
        <Reveal>
          <ul className="mt-4 grid gap-x-10 gap-y-1.5 sm:mt-6 sm:grid-cols-2">
            {quality.items.map((t) => (
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
