import { Check } from 'lucide-react';
import { FINISH_LEVELS, FINISH_LEVEL_INFO } from '@/lib/domain/types';
import { Container } from '@/components/ui';
import { Reveal } from '@/components/ui/reveal';
import { cn } from '@/lib/utils';

/**
 * 「本体だけ買って自分で仕上げる」から「完全仕上げ」まで、どこまで注文するか選べることの説明。
 * 商品詳細ページとトップで使う。
 */
export function OrderScopeSection({ className }: { className?: string }) {
  return (
    <section className={cn('py-20 sm:py-28', className)} aria-labelledby="order-scope-heading">
      <Container>
        <Reveal className="max-w-3xl">
          <p className="label-en text-forest">HOW MUCH YOU ORDER</p>
          <h2 id="order-scope-heading" className="mt-2 text-3xl sm:text-4xl">
            どこまで頼むかは、お客様が決められます
          </h2>
          <p className="mt-5 text-sm leading-[1.9] text-ink-soft sm:text-base">
            <strong className="font-semibold text-ink">本体</strong>とは、木造躯体に屋根・外壁・サッシ・玄関ドアまでを工場で取り付けた状態のことです。
            本体だけを注文して内装をご自身で仕上げることも、ユニットバスやトイレなど必要な設備だけを加えることも、
            そのまま暮らせるフル装備の状態で受け取ることもできます。
          </p>
        </Reveal>

        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {FINISH_LEVELS.map((level, i) => {
            const info = FINISH_LEVEL_INFO[level];
            return (
              <li key={level}>
                <Reveal delay={i * 100} className="flex h-full flex-col rounded-2xl border border-line bg-white p-6">
                  <p className="label-en text-gold">0{i + 1}</p>
                  <h3 className="mt-2 font-serif text-2xl">{info.name}</h3>
                  <p className="mt-1 text-sm font-semibold text-forest">{info.short}</p>
                  <p className="mt-4 flex-1 text-sm leading-[1.9] text-ink-soft">{info.lead}</p>
                  <ul className="mt-5 space-y-1.5 border-t border-line pt-4">
                    {info.includes.map((t) => (
                      <li key={t} className="flex items-start gap-2 text-xs text-muted">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-forest" aria-hidden="true" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </li>
            );
          })}
        </ul>

        <Reveal delay={300}>
          <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
            いずれの範囲でも、運搬・設置・基礎・電気・給排水などの別途工事は設置場所によって変わるため、現地の代理店・工務店のお見積りになります。
            見積シミュレーターでは、選んだ範囲に応じて選べる項目と概算金額が切り替わります。
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
