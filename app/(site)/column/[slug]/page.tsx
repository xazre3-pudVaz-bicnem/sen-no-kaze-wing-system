import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getColumnArticle, getPublishedColumnArticles, getRelatedArticles } from '@/lib/column/loader';
import { parseColumnMarkdown, tocItems } from '@/lib/column/markdown';
import { blogPostingJsonLd, breadcrumbJsonLd, buildMetadata } from '@/lib/seo';
import { COMPANY } from '@/lib/site';
import { formatDate } from '@/lib/utils';
import { Breadcrumbs, Container, JsonLd } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';
import { ColumnArticleBody } from '@/components/column/article-body';
import { ColumnContactNote, ColumnRelated, ColumnToc } from '@/components/column/column-parts';

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return getPublishedColumnArticles().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const article = getColumnArticle(slug);
  if (!article) return buildMetadata({ title: 'コラムが見つかりません', description: '', path: `/column/${slug}`, noindex: true });
  return buildMetadata({
    title: article.title,
    description: article.description,
    path: `/column/${article.slug}`,
    type: 'article',
    ...(article.image ? { image: article.image } : {}),
  });
}

export default async function ColumnDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const article = getColumnArticle(slug);
  if (!article) notFound();

  const nodes = parseColumnMarkdown(article.body);
  const toc = tocItems(nodes);
  const related = getRelatedArticles(article);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'ホーム', path: '/' },
          { name: 'コラム', path: '/column' },
          { name: article.title, path: `/column/${article.slug}` },
        ])}
      />
      <JsonLd
        data={blogPostingJsonLd({
          title: article.title,
          description: article.description,
          slug: article.slug,
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
          image: article.image,
        })}
      />

      <Container className="max-w-3xl pt-10 pb-24 sm:pt-14">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: 'コラム', path: '/column' }, { name: article.title }]} />

        <article className="mt-10">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <time dateTime={article.publishedAt} className="text-sm tabular-nums text-muted">
              {formatDate(article.publishedAt)} 公開
            </time>
            {article.updatedAt && (
              <time dateTime={article.updatedAt} className="text-sm tabular-nums text-muted">
                {formatDate(article.updatedAt)} 更新
              </time>
            )}
            <span className="rounded-full border border-brown/30 px-2.5 py-0.5 text-[0.7rem] text-brown">{article.category}</span>
          </div>

          <h1 className="mt-3 font-serif text-2xl leading-snug text-ink sm:text-4xl">{article.title}</h1>
          <p className="mt-4 text-sm leading-[1.9] text-ink-soft">{article.description}</p>
          <p className="mt-3 text-xs text-muted">
            発信：{COMPANY.name}（千の風プロジェクト）／{COMPANY.licenses[0]}
          </p>

          {article.image && (
            <div className="relative mt-8 aspect-[3/2] w-full overflow-hidden bg-sand">
              <SmartImage src={article.image} alt={article.imageAlt ?? ''} fill priority sizes="(min-width: 768px) 48rem, 100vw" className="object-cover" />
            </div>
          )}

          <ColumnToc items={toc} />
          <ColumnArticleBody nodes={nodes} />

          {article.sources.length > 0 && (
            <section aria-labelledby="column-sources" className="mt-10 border-t border-line pt-6">
              <h2 id="column-sources" className="text-sm font-semibold text-ink">
                参照した資料
              </h2>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
                {article.sources.map((s) => (
                  <li key={`${s.label}-${s.checkedAt}`}>
                    {s.label}（確認日 {formatDate(s.checkedAt)}）
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ColumnContactNote relatedPages={article.relatedPages} />
          <ColumnRelated articles={related} />
        </article>
      </Container>
    </>
  );
}
