import { getColumnPage } from '@/lib/column/loader';
import { breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { RuleHeading } from '@/components/ui/section-heading';
import { ColumnCard, ColumnPagination } from '@/components/column/column-parts';

export const metadata = buildMetadata({
  title: 'コラム',
  description:
    '折り畳み式木造コンテナの導入を検討する方に向けたコラム。搬入や設置の条件、他の選択肢との比較、遊休地活用の進め方など、相談前に確認したいことを整理しています。',
  path: '/column',
});

export default function ColumnIndexPage() {
  const { articles, page, totalPages } = getColumnPage(1);

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: 'ホーム', path: '/' }, { name: 'コラム', path: '/column' }])} />
      <Container className="pt-10 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'コラム' }]} />
        <div className="py-10 sm:py-14">
          <RuleHeading as="h1" labelEn="COLUMN" title="コラム" tone="light" />
          <p className="mt-5 max-w-2xl text-sm leading-[1.9] text-ink-soft">
            折り畳み式木造コンテナの導入を検討するときに出てくる疑問を、ひとつずつ整理しています。搬入や設置の条件、他の選択肢との違い、相談前に用意しておく情報など、判断の材料になる内容を掲載します。
          </p>
        </div>

        {articles.length === 0 ? (
          <p className="border-y border-line py-12 text-sm text-ink-soft">コラムは準備中です。</p>
        ) : (
          <ul className="border-t border-line">
            {articles.map((a) => (
              <ColumnCard key={a.slug} article={a} />
            ))}
          </ul>
        )}

        <div className="pb-24">
          <ColumnPagination page={page} totalPages={totalPages} />
        </div>
      </Container>
    </>
  );
}
