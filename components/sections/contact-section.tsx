import { Phone } from 'lucide-react';
import { contact } from '@/data/site-content';
import { COMPANY } from '@/lib/site';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { ContactForm } from '@/components/sections/contact-form';

/** トップページ下部のお問い合わせ */
export function ContactSection() {
  return (
    <section id="contact" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <RuleHeading labelEn={contact.labelEn} title={contact.title} lead={contact.lead} tone="light" compact />
          <Reveal className="mt-5 space-y-4 text-sm">
            <div>
              <p className="text-muted">お電話でのご相談</p>
              <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-2xl tracking-wider">
                {COMPANY.tel}
              </a>
              <p className="mt-1 text-xs text-muted">{COMPANY.telHours}</p>
            </div>
            <dl className="space-y-4">
              {COMPANY.offices.map((o) => (
                <div key={o.name}>
                  <dt className="font-semibold">{o.name}</dt>
                  <dd className="text-ink-soft">
                    {o.postal}　{o.address}
                    {o.tel && (
                      <>
                        <br />
                        <a href={`tel:${o.tel.replace(/-/g, '')}`} className="inline-flex items-center gap-1 hover:underline">
                          <Phone className="size-3.5" aria-hidden="true" />
                          {o.tel}
                        </a>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
        <Reveal delay={100}>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  );
}
