import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getColumnPage, getPublishedColumnArticles } from '@/lib/column/loader';
import { COLUMN_PAGE_SIZE } from '@/lib/column/types';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';
import { ColumnCard, ColumnPagination } from '@/components/column/column-parts';

type Params = Promise<{ page: string }>;

export function generateStaticParams() {
  const total = Math.ceil(getPublishedColumnArticles().length / COLUMN_PAGE_SIZE);
  // 1ページ目は /column が担当するので 2 以降だけ
  return Array.from({ length: Math.max(0, total - 1) }, (_, i) => ({ page: String(i + 2) }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { page } = await params;
  return buildMetadata({
    title: `コラム（${page}ページ目）`,
    description: '折り畳み式木造コンテナの導入を検討する方に向けたコラムの一覧です。',
    path: `/column/page/${page}`,
  });
}

export default async function ColumnPagedPage({ params }: { params: Params }) {
  const { page: raw } = await params;
  const requested = Number(raw);
  if (!Number.isInteger(requested) || requested < 2) notFound();

  const { articles, page, totalPages } = getColumnPage(requested);
  if (page !== requested || articles.length === 0) notFound();

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'ホーム', path: '/' },
          { name: 'コラム', path: '/column' },
          { name: `${page}ページ目`, path: `/column/page/${page}` },
        ])}
      />
      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'コラム', path: '/column' }, { name: `${page}ページ目` }]} />
        <div className="py-10 sm:py-14">
          <RuleHeading as="h1" labelEn="COLUMN" title="コラム" tone="light" />
        </div>
        <ul className="border-t border-line">
          {articles.map((a) => (
            <ColumnCard key={a.slug} article={a} />
          ))}
        </ul>
        <div className="pb-24">
          <ColumnPagination page={page} totalPages={totalPages} />
        </div>
      </Container>
    </>
  );
}
