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
 * モバイルでは本体・用途ボタンを1行表記にして横一列に収める。
 */
export function FinishLevelPicker({ value, totals, readOnly, onChange }: Props) {
  const visibleLevels = FINISH_LEVELS.filter((level) => level === 'shell');

  return (
    <section aria-labelledby="finish-level-heading" className="min-w-max flex-none sm:min-w-0 sm:flex-initial">
      <h2 id="finish-level-heading" className="sr-only">
        注文範囲
      </h2>
      <ul className="flex flex-nowrap items-center gap-1 sm:gap-1.5" data-testid="finish-levels">
        {visibleLevels.map((level) => {
          const info = FINISH_LEVEL_INFO[level];
          const active = value === level;
          const total = totals?.[level];
          return (
            <li key={level} className="group/card relative shrink-0">
              <span
                className={cn(
                  'inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border bg-white text-[0.68rem] font-medium transition sm:text-[0.82rem]',
                  active ? 'border-brown bg-white text-brown shadow-soft ring-1 ring-brown/20' : 'border-line bg-white text-ink-soft hover:border-ink/40'
                )}
              >
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(level)}
                  aria-pressed={active}
                  title={typeof total === 'number' ? `${info.name} 概算 ${formatYen(total)}` : info.name}
                  data-testid={`finish-level-${level}`}
                  className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-center leading-tight transition disabled:cursor-not-allowed disabled:opacity-60 sm:gap-1.5 sm:px-3 sm:text-left"
                >
                  {active && <Check className="hidden size-3.5 sm:block" aria-hidden="true" />}
                  <span>{info.name}</span>
                </button>
              </span>
              <div
                className="pointer-events-none absolute left-0 top-[calc(100%+0.35rem)] z-20 hidden w-64 rounded-lg border border-line bg-white p-3 text-xs shadow-lift group-hover/card:block sm:w-72"
                role="note"
              >
                <p className="leading-relaxed text-ink-soft">{info.lead}</p>
                {typeof total === 'number' && (
                  <p className="mt-1.5 font-serif text-base tabular-nums text-ink">{formatYen(total)}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <style jsx global>{`
        @media (max-width: 639px) {
          div:has(> section > ul[data-testid='finish-levels']) {
            flex-wrap: nowrap;
            gap: 0.25rem;
          }

          div:has(> section > ul[data-testid='finish-levels']) > span[aria-hidden='true'] {
            display: none;
          }

          div:has(> section > ul[data-testid='finish-levels']) > button[data-testid^='preset-'] {
            min-height: 2rem;
            flex: 0 0 auto;
            white-space: nowrap;
            padding: 0.25rem 0.45rem;
            font-size: 0.68rem;
            line-height: 1rem;
          }
        }
      `}</style>
    </section>
  );
}
