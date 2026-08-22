import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { BaseModel, ProductImage } from '@/lib/domain/types';
import { baseTotalOf, formatManYen } from '@/lib/domain/pricing';
import { SmartImage } from '@/components/ui/smart-image';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

export interface ProductChapterData {
  model: BaseModel;
  image: ProductImage | null;
}

const tones = ['ivory', 'navy', 'forest'] as const;
const toneClass: Record<(typeof tones)[number], string> = {
  ivory: 'bg-ivory text-ink',
  navy: 'bg-navy text-white',
  forest: 'bg-forest text-white',
};

/** モデルごとの主要3項目（価格・寸法・構造系を優先） */
function keySpecs(model: BaseModel) {
  const prefer = ['展開後', '折り畳み時外形', '床面積', '構造', '断熱'];
  const picked = prefer.map((label) => model.specs.find((s) => s.label === label)).filter((s): s is { label: string; value: string } => Boolean(s));
  return picked.slice(0, 3);
}

/**
 * Wing / BOX / フラット を独立した大きな章として見せる。
 * PC: 画像 62% ＋ 情報 38%、章ごとに左右反転。SP: 画像 → 情報。
 */
export function ProductChapters({ items, headingLevel = 3 }: { items: ProductChapterData[]; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div>
      {items.map(({ model, image }, i) => {
        const flip = i % 2 === 1;
        const tone = tones[i % tones.length];
        const dark = tone !== 'ivory';
        return (
          <article key={model.id} id={`model-${model.slug}`} className={cn('scroll-mt-16 lg:grid lg:grid-cols-[62fr_38fr]', toneClass[tone])}>
            <Reveal variant="image" className={cn('relative', flip && 'lg:order-2')}>
              <div className="relative aspect-[3/2] w-full lg:aspect-auto lg:h-full lg:min-h-[72vh]">
                {image ? (
                  <SmartImage src={image.url} alt={image.alt} fill sizes="(min-width: 1024px) 62vw, 100vw" className="object-cover object-center" />
                ) : (
                  <div className="flex h-full items-center justify-center bg-sand text-muted">画像準備中</div>
                )}
              </div>
            </Reveal>
            <div className={cn('flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14 lg:py-20', flip && 'lg:order-1')}>
              <Reveal>
                <p className={cn('label-en', dark ? 'text-gold' : 'text-forest')}>Model {String(i + 1).padStart(2, '0')}</p>
                <H className={cn('mt-3 text-4xl sm:text-5xl', dark && 'text-white')}>{model.name}</H>
                <p className={cn('mt-4 text-base sm:text-lg', dark ? 'text-white/80' : 'text-ink-soft')}>{model.tagline}</p>
                <p className={cn('mt-8 text-xs', dark ? 'text-white/60' : 'text-muted')}>本体価格計（本体一式＋諸費用・税別）</p>
                <p className="font-serif text-4xl">{formatManYen(baseTotalOf(model))}〜</p>
                <dl className={cn('mt-8 divide-y border-y text-sm', dark ? 'divide-white/15 border-white/15' : 'divide-line border-line')}>
                  {keySpecs(model).map((s) => (
                    <div key={s.label} className="grid grid-cols-[7rem_1fr] gap-3 py-2.5">
                      <dt className={dark ? 'text-white/60' : 'text-muted'}>{s.label}</dt>
                      <dd>{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href={`/simulator/${model.slug}`} className={cn('btn', dark ? 'bg-white text-ink hover:bg-ivory' : 'btn-primary')}>
                    この商品で見積を作る
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                  <Link href={`/products/${model.slug}`} className={cn('btn', dark ? 'border border-white/50 text-white hover:bg-white/10' : 'btn-secondary')}>
                    商品詳細を見る
                  </Link>
                </div>
              </Reveal>
            </div>
          </article>
        );
      })}
    </div>
  );
}
