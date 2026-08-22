import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { news } from '@/data/site-content';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { formatDate } from '@/lib/utils';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return news.map((n) => ({ slug: n.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const item = news.find((n) => n.slug === slug);
  if (!item) return buildMetadata({ title: 'お知らせが見つかりません', description: '', path: `/news/${slug}`, noindex: true });
  return buildMetadata({ title: item.title, description: item.lead, path: `/news/${slug}`, image: item.image, type: 'article' });
}

export default async function NewsDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const item = news.find((n) => n.slug === slug);
  if (!item) notFound();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'ホーム', path: '/' },
          { name: 'お知らせ', path: '/news' },
          { name: item.title, path: `/news/${item.slug}` },
        ])}
      />
      <Container className="max-w-3xl pt-10 pb-24 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'お知らせ', path: '/news' }, { name: item.title }]} />
        <div className="mt-10 flex items-baseline gap-4">
          <time dateTime={item.date} className="text-sm tabular-nums text-muted">
            {formatDate(item.date)}
          </time>
          <span className="label-en text-gold">{item.category}</span>
        </div>
        <h1 className="mt-3 text-3xl leading-snug sm:text-4xl">{item.title}</h1>
        <p className="mt-4 text-ink-soft">{item.lead}</p>
        {item.image && (
          <div className="relative mt-8 aspect-[3/2] w-full overflow-hidden">
            <SmartImage src={item.image} alt="" fill priority sizes="(min-width: 768px) 48rem, 100vw" className="object-cover" />
          </div>
        )}
        <div className="prose-wing mt-8 space-y-5 leading-[2] text-ink-soft">
          {item.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <div className="mt-12 border-t border-line pt-8">
          <Link href="/news" className="btn-secondary btn-sm">
            一覧に戻る
          </Link>
        </div>
      </Container>
    </>
  );
}
