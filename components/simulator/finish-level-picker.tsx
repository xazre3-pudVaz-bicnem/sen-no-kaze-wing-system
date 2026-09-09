'use client';

import { useState } from 'react';
import { Check, Info } from 'lucide-react';
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
 * 先方指示（2026-08-29）：説明文はカーソルをあてたとき（または ℹ ボタン）に見える様にして、
 * ふだんはコンパクトに保つ。
 */
export function FinishLevelPicker({ value, totals, readOnly, onChange }: Props) {
  const [infoOpen, setInfoOpen] = useState<FinishLevel | null>(null);
  const visibleLevels = FINISH_LEVELS.filter((level) => level === 'shell');

  return (
    <section aria-labelledby="finish-level-heading" className="min-w-0">
      <h2 id="finish-level-heading" className="sr-only">
        注文範囲
      </h2>
      <ul className="flex flex-wrap items-center gap-1.5" data-testid="finish-levels">
        {visibleLevels.map((level) => {
          const info = FINISH_LEVEL_INFO[level];
          const active = value === level;
          const total = totals?.[level];
          const showInfo = infoOpen === level;
          return (
            <li key={level} className="group/card relative">
              <span
                className={cn(
                  'inline-flex min-h-8 items-center rounded-full border bg-white text-[0.82rem] font-medium transition',
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
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-l-full px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {active && <Check className="size-3.5" aria-hidden="true" />}
                  {info.name}
                </button>
                <button
                  type="button"
                  onClick={() => setInfoOpen((v) => (v === level ? null : level))}
                  aria-expanded={showInfo}
                  aria-label={`${info.name}に含まれる内容を表示`}
                  className="inline-flex min-h-8 items-center rounded-r-full border-l border-line px-2 text-muted transition hover:bg-sand hover:text-ink"
                  data-testid={`finish-level-info-${level}`}
                >
                  <Info className="size-3.5" aria-hidden="true" />
                </button>
              </span>
              <div
                className={cn(
                  'absolute left-0 top-[calc(100%+0.35rem)] z-20 w-72 rounded-lg border border-line bg-white p-3 text-xs shadow-lift',
                  showInfo ? 'block' : 'pointer-events-none hidden group-hover/card:block'
                )}
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
    </section>
  );
}
