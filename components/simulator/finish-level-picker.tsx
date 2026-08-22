'use client';

import { Check } from 'lucide-react';
import { FINISH_LEVELS, FINISH_LEVEL_INFO, type FinishLevel } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { cn } from '@/lib/utils';

interface Props {
  value: FinishLevel;
  /** 各範囲で選んだときの概算合計（税込）。表示だけに使う */
  totals?: Partial<Record<FinishLevel, number>>;
  readOnly: boolean;
  onChange: (level: FinishLevel) => void;
}

/**
 * 「どこまで頼むか」の選択。
 * 本体＝木造躯体＋屋根＋外壁＋サッシまで。そこから設備・内装をどこまで含めるかをお客様が決める。
 */
export function FinishLevelPicker({ value, totals, readOnly, onChange }: Props) {
  return (
    <section aria-labelledby="finish-level-heading" className="border-y border-line bg-ivory py-6">
      <div className="container-x">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="finish-level-heading" className="font-serif text-xl">
            どこまで頼むかを選べます
          </h2>
          <p className="text-xs text-muted">あとから変更できます</p>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">本体</strong>は、木造躯体に屋根・外壁・サッシ・玄関ドアまでを工場で取り付けた状態です。
          本体だけを注文してご自身で自由に仕上げることも、必要な設備だけを足すことも、内装まで仕上げた状態で受け取ることもできます。
        </p>

        <ul className="mt-4 grid gap-3 md:grid-cols-3" data-testid="finish-levels">
          {FINISH_LEVELS.map((level) => {
            const info = FINISH_LEVEL_INFO[level];
            const active = value === level;
            const total = totals?.[level];
            return (
              <li key={level}>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(level)}
                  aria-pressed={active}
                  data-testid={`finish-level-${level}`}
                  className={cn(
                    'flex h-full w-full flex-col rounded-xl border bg-white p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
                    active ? 'border-brown shadow-soft ring-1 ring-brown/30' : 'border-line hover:border-ink/40'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn('font-serif text-lg', active && 'text-brown')}>{info.name}</span>
                    {active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brown px-2 py-0.5 text-[0.65rem] font-semibold text-white">
                        <Check className="size-3" aria-hidden="true" />
                        選択中
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 text-xs font-semibold text-forest">{info.short}</span>
                  <span className="mt-2 text-xs leading-relaxed text-ink-soft">{info.lead}</span>
                  <span className="mt-3 space-y-1">
                    {info.includes.map((t) => (
                      <span key={t} className="flex gap-1.5 text-[0.7rem] text-muted">
                        <Check className="mt-0.5 size-3 shrink-0 text-forest" aria-hidden="true" />
                        {t}
                      </span>
                    ))}
                  </span>
                  {typeof total === 'number' && (
                    <span className="mt-3 block border-t border-line pt-2 text-xs text-muted">
                      この範囲の概算 <span className="font-serif text-base tabular-nums text-ink">{formatYen(total)}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs text-muted">
          いずれの範囲でも、運搬・設置・基礎・電気・給排水などの<strong className="font-semibold">別途工事</strong>は現地の代理店・工務店のお見積りになります。
        </p>
      </div>
    </section>
  );
}
