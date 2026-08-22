import { Phone } from 'lucide-react';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { Breadcrumbs, Container, JsonLd, Section, SectionHeading } from '@/components/ui';
import { ContactForm } from '@/components/sections/contact-form';

export const metadata = buildMetadata({
  title: 'お問い合わせ｜Wing 折り畳み式木造コンテナのご相談',
  description: '折り畳み式木造コンテナ Wing に関するご相談・資料請求・設置場所のご相談はこちら。お電話（0120-030-205）でも承ります。',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: 'お問い合わせ', path: '/contact' }])} />
      <Section>
        <Container className="max-w-5xl">
          <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'お問い合わせ' }]} />
          <SectionHeading as="h1" eyebrow="Contact" title="お問い合わせ" lead="設置場所のご相談、法規・確認申請、販売・製造代理店のご希望など、お気軽にご連絡ください。仕様が決まっている場合は見積シミュレーターからの見積依頼が便利です。" className="mt-6" />
          <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_20rem]">
            <ContactForm />
            <aside className="space-y-6">
              <div className="card p-6">
                <p className="flex items-center gap-2 text-sm font-semibold"><Phone className="size-4" aria-hidden="true" />お電話</p>
                <a href={`tel:${COMPANY.tel.replace(/-/g, '')}`} className="mt-2 block font-serif text-3xl tracking-wider">{COMPANY.tel}</a>
                <p className="mt-1 text-xs text-muted">{COMPANY.telHours}</p>
              </div>
              <div className="card p-6 text-sm">
                <p className="font-semibold">{COMPANY.name}</p>
                <p className="mt-2 text-ink-soft">本社：{COMPANY.headOffice}</p>
                {COMPANY.branches.map((b) => (
                  <p key={b.name} className="mt-1 text-ink-soft">{b.name}：{b.address}</p>
                ))}
              </div>
            </aside>
          </div>
        </Container>
      </Section>
    </>
  );
}
