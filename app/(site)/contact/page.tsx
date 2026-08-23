import { Phone } from 'lucide-react';
import { contact } from '@/data/site-content';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';
import { ContactForm } from '@/components/sections/contact-form';

export const metadata = buildMetadata({
  title: 'お問い合わせ',
  description: '折り畳み式木造コンテナ Wing や宿泊施設づくりに関するご相談・資料請求はこちら。お電話（0120-030-205）でも承ります。',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: 'お問い合わせ', path: '/contact' }])} />
      <Container className="max-w-5xl pt-10 pb-24 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'お問い合わせ' }]} />
        <div className="py-12 sm:py-16">
          <RuleHeading as="h1" labelEn={contact.labelEn} title={contact.title} lead={contact.lead} tone="light" className="max-w-2xl" />
        </div>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.6fr]">
          <aside className="space-y-8 text-sm">
            <div>
              <p className="text-muted">お電話でのご相談</p>
              <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="font-serif text-3xl tracking-wider">
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
          </aside>
          <ContactForm />
        </div>
      </Container>
    </>
  );
}
