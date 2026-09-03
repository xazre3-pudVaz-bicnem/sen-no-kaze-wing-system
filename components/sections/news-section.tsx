import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { news } from '@/data/site-content';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { formatDate } from '@/lib/utils';

/** お知らせ（トップには最新4件） */
export function NewsSection({ limit = 4 }: { limit?: number }) {
  return (
    <section id="news" className="scroll-mt-20 bg-ivory py-8 sm:py-12">
      <div className="container-x grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div>
          <RuleHeading labelEn="NEWS" title="お知らせ" tone="light" compact />
          <Reveal className="mt-4">
            <Link href="/news" className="btn-secondary btn-sm">
              一覧を見る
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {news.slice(0, limit).map((n) => (
            <li key={n.slug}>
              <Link href={`/news/${n.slug}`} className="group flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5 transition-colors hover:text-brown">
                <time dateTime={n.date} className="text-sm tabular-nums text-muted">
                  {formatDate(n.date)}
                </time>
                <span className="label-en text-gold">{n.category}</span>
                <span className="w-full font-serif text-base sm:w-auto sm:flex-1">{n.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
