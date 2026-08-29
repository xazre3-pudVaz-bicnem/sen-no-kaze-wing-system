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
  const [introOpen, setIntroOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState<FinishLevel | null>(null);

  return (
    <section aria-labelledby="finish-level-heading" className="border-y border-line bg-ivory py-5">
      <div className="container-x">
        <div className="group/intro">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="finish-level-heading" className="font-serif text-xl">
              どこまで頼むかを選べます
            </h2>
            <button
              type="button"
              onClick={() => setIntroOpen((v) => !v)}
              aria-expanded={introOpen}
              aria-label="本体についての説明を表示"
              className="rounded-full p-1 text-muted hover:bg-sand hover:text-ink"
              data-testid="finish-level-intro-toggle"
            >
              <Info className="size-4" aria-hidden="true" />
            </button>
            <p className="ml-auto text-xs text-muted">あとから変更できます</p>
          </div>
          {/* 説明はカーソルをあてたとき／ℹ で表示（先方指示） */}
          <p
            className={cn(
              'mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft',
              introOpen ? 'block' : 'hidden group-hover/intro:block'
            )}
          >
            <strong className="font-semibold text-ink">本体</strong>は、木造躯体に屋根・外壁・サッシ・玄関ドアまでを工場で取り付けた状態です。
            本体だけを注文してご自身で自由に仕上げることも、必要な設備だけを足すことも、内装まで仕上げた状態で受け取ることもできます。
          </p>
        </div>

        <ul className="mt-4 grid gap-3 md:grid-cols-3" data-testid="finish-levels">
          {FINISH_LEVELS.map((level) => {
            const info = FINISH_LEVEL_INFO[level];
            const active = value === level;
            const total = totals?.[level];
            const showInfo = infoOpen === level;
            return (
              <li key={level} className="group/card relative">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange(level)}
                  aria-pressed={active}
                  data-testid={`finish-level-${level}`}
                  className={cn(
                    'flex h-full w-full flex-col rounded-xl border bg-white p-3.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
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
                  {typeof total === 'number' && (
                    <span className="mt-2 block border-t border-line pt-1.5 text-xs text-muted">
                      この範囲の概算 <span className="font-serif text-base tabular-nums text-ink">{formatYen(total)}</span>
                    </span>
                  )}
                </button>
                {/* 詳しい説明ボタン（カーソルをあてても出る） */}
                <button
                  type="button"
                  onClick={() => setInfoOpen((v) => (v === level ? null : level))}
                  aria-expanded={showInfo}
                  aria-label={`${info.name}に含まれる内容を表示`}
                  className="absolute top-2.5 right-2.5 rounded-full p-1 text-muted hover:bg-sand hover:text-ink"
                  data-testid={`finish-level-info-${level}`}
                >
                  <Info className="size-4" aria-hidden="true" />
                </button>
                <div
                  className={cn(
                    'absolute inset-x-1 top-[calc(100%+0.25rem)] z-20 rounded-lg border border-line bg-white p-3 text-xs shadow-lift',
                    showInfo ? 'block' : 'pointer-events-none hidden group-hover/card:block'
                  )}
                  role="note"
                >
                  <p className="leading-relaxed text-ink-soft">{info.lead}</p>
                  <ul className="mt-2 space-y-1">
                    {info.includes.map((t) => (
                      <li key={t} className="flex gap-1.5 text-[0.7rem] text-muted">
                        <Check className="mt-0.5 size-3 shrink-0 text-forest" aria-hidden="true" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
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
