import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { SmartImage } from '@/components/ui/smart-image';
import type { ColumnArticle } from '@/lib/column/types';

/** 一覧のカード。既存サイトの余白・書体に合わせ、装飾は最小限にする */
export function ColumnCard({ article }: { article: ColumnArticle }) {
  return (
    <li className="border-b border-line">
      <Link href={`/column/${article.slug}`} className="group flex gap-4 py-6 transition-colors hover:text-brown sm:gap-6">
        {article.image && (
          <div className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden bg-sand sm:w-40">
            <SmartImage src={article.image} alt={article.imageAlt ?? ''} fill sizes="(min-width: 640px) 10rem, 7rem" className="object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <time dateTime={article.publishedAt} className="text-xs tabular-nums text-muted sm:text-sm">
              {formatDate(article.publishedAt)}
            </time>
            <span className="rounded-full border border-brown/30 px-2.5 py-0.5 text-[0.7rem] text-brown">{article.category}</span>
          </div>
          <h2 className="mt-1.5 font-serif text-base leading-snug text-ink group-hover:text-brown sm:text-xl">{article.title}</h2>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-soft sm:text-sm">{article.description}</p>
        </div>
      </Link>
    </li>
  );
}

/** ページネーション。クローラーが辿れるよう通常の HTML リンクにする */
export function ColumnPagination({ page, totalPages }: { page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const href = (p: number) => (p === 1 ? '/column' : `/column/page/${p}`);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  return (
    <nav aria-label="コラムのページ送り" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {page > 1 && (
        <Link href={href(page - 1)} rel="prev" className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-brown hover:text-brown">
          前へ
        </Link>
      )}
      {pages.map((p) =>
        p === page ? (
          <span key={p} aria-current="page" className="rounded border border-brown bg-brown px-3 py-1.5 text-sm text-white">
            {p}
          </span>
        ) : (
          <Link key={p} href={href(p)} className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-brown hover:text-brown">
            {p}
          </Link>
        )
      )}
      {page < totalPages && (
        <Link href={href(page + 1)} rel="next" className="rounded border border-line px-3 py-1.5 text-sm text-ink-soft hover:border-brown hover:text-brown">
          次へ
        </Link>
      )}
    </nav>
  );
}

/** 記事内の目次（H2 が3つ以上のときだけ出す） */
export function ColumnToc({ items }: { items: { id: string; text: string }[] }) {
  if (items.length < 3) return null;
  return (
    <nav aria-label="目次" className="mt-8 border border-line bg-sand/60 px-5 py-4">
      <p className="text-sm font-semibold text-ink">目次</p>
      <ol className="mt-2 space-y-1.5 text-sm text-ink-soft">
        {items.map((t) => (
          <li key={t.id}>
            <a href={`#${t.id}`} className="underline-offset-4 hover:text-brown hover:underline">
              {t.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** 関連コラム（2〜3件） */
export function ColumnRelated({ articles }: { articles: ColumnArticle[] }) {
  if (articles.length === 0) return null;
  return (
    <section aria-labelledby="related-columns" className="mt-12 border-t border-line pt-8">
      <h2 id="related-columns" className="font-serif text-lg text-ink">
        関連するコラム
      </h2>
      <ul className="mt-4 space-y-3">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link href={`/column/${a.slug}`} className="group flex items-baseline gap-3 text-sm text-ink-soft hover:text-brown">
              <ArrowRight className="size-4 shrink-0 text-gold transition-transform group-hover:translate-x-1" aria-hidden="true" />
              <span className="font-serif text-base leading-snug text-ink group-hover:text-brown">{a.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 記事末尾の控えめな相談導線 */
export function ColumnContactNote({ relatedPages }: { relatedPages: { label: string; path: string }[] }) {
  return (
    <section aria-labelledby="column-contact" className="mt-10 border border-line bg-sand/60 px-5 py-6">
      <h2 id="column-contact" className="font-serif text-base text-ink">
        設置条件のご相談について
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        土地の条件によって必要な工事や手続きは変わります。ご相談と初回のお見積もりは無料です。オンラインでの打ち合わせにも対応しています。
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link href="/contact" className="btn-secondary btn-sm">
          お問い合わせ
        </Link>
        {relatedPages.map((p) => (
          <Link key={p.path} href={p.path} className="btn-ghost btn-sm text-ink-soft">
            {p.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
