import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { news } from '@/data/site-content';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { formatDate } from '@/lib/utils';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';

export const metadata = buildMetadata({
  title: 'お知らせ',
  description: '千の風プロジェクト（株式会社技術の杜）からのお知らせ・コラム・キャンペーン情報。折り畳み式木造コンテナ Wing の最新情報をご案内します。',
  path: '/news',
});

export default function NewsIndexPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: 'お知らせ', path: '/news' }])} />
      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'お知らせ' }]} />
        <div className="py-12 sm:py-16">
          <RuleHeading as="h1" labelEn="NEWS" title="お知らせ" tone="light" />
        </div>
        <ul className="divide-y divide-line border-y border-line pb-24">
          {news.map((n) => (
            <li key={n.slug}>
              <Link href={`/news/${n.slug}`} className="group flex flex-wrap items-baseline gap-x-5 gap-y-1 py-6 transition-colors hover:text-brown">
                <time dateTime={n.date} className="text-sm tabular-nums text-muted">
                  {formatDate(n.date)}
                </time>
                <span className="label-en text-gold">{n.category}</span>
                <span className="w-full font-serif text-lg sm:w-auto sm:flex-1 sm:text-xl">{n.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
