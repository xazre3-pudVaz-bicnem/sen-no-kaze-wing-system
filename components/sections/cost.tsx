import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { price } from '@/data/site-content';
import { formatManYen } from '@/lib/domain/pricing';
import { RuleHeading } from '@/components/ui/section-heading';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/**
 * 費用・比較：在来工法との比較と、シミュレーターへの導線。
 * Wing の本体価格計は、商品一覧・商品ページと同じ価格元（getPublicBaseTotals をモデルの slug で引いたもの）を渡す
 */
export function CostSection({ simulatorHref, baseTotalsBySlug }: { simulatorHref: string; baseTotalsBySlug: Record<string, number | null> }) {
  const costOf = (c: (typeof price.compare)[number]) => {
    if (c.cost !== null) return c.cost;
    const total = c.modelSlug ? baseTotalsBySlug[c.modelSlug] : null;
    return total !== null && total !== undefined ? `本体 ${formatManYen(total)}〜（税別）` : '本体価格は見積シミュレーションでご確認ください';
  };
  return (
    <section id="price" className="scroll-mt-20 bg-forest-deep py-20 sm:py-28">
      <div className="container-x">
        <RuleHeading labelEn={price.labelEn} title={price.title} />

        <Reveal className="mt-12 text-center">
          <p className="font-serif text-3xl text-gold sm:text-5xl">{price.headline}</p>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-[1.95] text-white/80 sm:text-base">{price.lead}</p>
        </Reveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {price.compare.map((c) => (
            <Reveal key={c.label}>
              <div className={cn('h-full border p-8 sm:p-10', c.highlight ? 'border-gold bg-forest' : 'border-forest-line bg-forest-deep')}>
                <p className={cn('text-sm', c.highlight ? 'text-gold' : 'text-white/60')}>{c.label}</p>
                <p className={cn('mt-3 font-serif text-3xl sm:text-4xl', c.highlight ? 'text-white' : 'text-white/80')}>{costOf(c)}</p>
                <dl className="mt-6 space-y-2 text-sm text-white/75">
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-white/50">工期</dt>
                    <dd>{c.period}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-20 shrink-0 text-white/50">内容</dt>
                    <dd>{c.note}</dd>
                  </div>
                </dl>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8">
          <ul className="space-y-1 text-xs text-white/55">
            {price.notes.map((n) => (
              <li key={n}>※ {n}</li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={simulatorHref} className="btn-gold btn-lg">
              見積シミュレーションで概算を出す
              <ArrowRight className="size-5" aria-hidden="true" />
            </Link>
            <Link href="/products" className="btn-outline-gold">
              モデル別の価格を見る
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
