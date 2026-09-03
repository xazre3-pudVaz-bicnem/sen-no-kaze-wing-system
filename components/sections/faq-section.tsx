import { faqItems } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';

/** よくあるご質問（アコーディオン） */
export function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-20 bg-forest-deep py-8 sm:py-12">
      <div className="container-x grid gap-6 lg:grid-cols-[1fr_2fr]">
        <RuleHeading labelEn="FAQ" title="よくあるご質問" compact />
        <div className="divide-y divide-forest-line border-y border-forest-line">
          {faqItems.map((f) => (
            <details key={f.q} className="group py-3">
              <summary className="flex cursor-pointer list-none items-start gap-3 text-sm text-white sm:text-base [&::-webkit-details-marker]:hidden">
                <span className="font-serif text-lg text-gold">Q.</span>
                <span className="flex-1">{f.q}</span>
                <span aria-hidden="true" className="mt-1 shrink-0 text-gold transition-transform group-open:rotate-45">＋</span>
              </summary>
              <div className="mt-2 flex gap-3">
                <span className="font-serif text-lg text-white/40">A.</span>
                <p className="flex-1 text-[0.8rem] leading-[1.8] text-white/80">{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
