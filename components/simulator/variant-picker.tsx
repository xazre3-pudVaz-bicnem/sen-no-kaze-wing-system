'use client';

import { useState } from 'react';
import { Check, ImageOff, ZoomIn } from 'lucide-react';
import { ProductImageLightbox } from './product-image-lightbox';
import { formatYen } from '@/lib/domain/pricing';
import { VARIANT_KIND_LABELS, type OptionVariantChoice, type OptionVariantGroup } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Props {
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
  /** 選択中の選択肢 ID */
  selected: string[];
  onChange: (choiceId: string, groupId: string) => void;
  /** 画像付きの選択肢をカードで比較するか */
  showImages?: boolean;
  /** 選択中の値をグループ見出し横へ表示するか */
  showCurrentValue?: boolean;
}

function ChoiceThumbnail({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[0.65rem] text-muted">
        <ImageOff className="size-5" aria-hidden="true" />
        <span>{src ? '画像を表示できません' : '画像なし'}</span>
      </span>
    );
  }
  return (
    <SmartImage
      src={src}
      alt={name}
      fill
      sizes="(min-width: 640px) 150px, 45vw"
      className="object-contain"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 商品の仕様選び（ネットショップの「カラー」「サイズ」に相当）。
 *
 * デフォルトでは画像付き選択肢を画像カードで表示し、
 * 画像がないグループは文字カードでコンパクトに表示する。
 */
export function VariantPicker({
  groups,
  choices,
  selected,
  onChange,
  showImages = true,
  showCurrentValue = true,
}: Props) {
  if (groups.length === 0) return null;
  const picked = new Set(selected);
  const [enlargedChoice, setEnlargedChoice] = useState<{ url: string; label: string } | null>(null);

  return (
    <div className="space-y-3 border-t border-line pt-3" data-testid="variant-picker">
      {groups.map((g) => {
        const list = choices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
        if (list.length === 0) return null;
        const withImage = showImages && list.some((c) => c.image_url);
        const fixed = list.length === 1 && list[0].kind === 'fixed';
        const current = list.find((c) => picked.has(c.id));
        const allPriceOnRequest = list.length > 0 && list.every((choice) => choice.price_on_request);

        return (
          <section key={g.id} className="border-b border-line/70 pb-3 last:border-b-0 last:pb-0" data-testid={`variant-group-${g.code}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="text-[0.72rem] font-semibold text-ink">{g.name}</h3>
              {fixed ? (
                <span className="text-[0.68rem] text-muted">変更不可</span>
              ) : current ? (
                showCurrentValue && <span className="text-[0.68rem] text-muted">{current.name}</span>
              ) : (
                <span className="text-[0.68rem] text-muted">選んでください</span>
              )}
              {allPriceOnRequest && (
                <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[0.62rem] font-semibold text-warn">
                  価格は別途見積
                </span>
              )}
            </div>
            {g.note && <p className="mt-0.5 text-[0.68rem] leading-relaxed text-muted">{g.note}</p>}

            <ul
              className={cn(
                'mt-2 gap-2',
                withImage
                  ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
                  : 'grid grid-cols-1 sm:grid-cols-2'
              )}
            >
              {list.map((c) => {
                const on = picked.has(c.id);
                const extra = allPriceOnRequest
                  ? null
                  : c.price_on_request
                    ? '別途見積'
                    : c.extra_price > 0
                      ? `+${formatYen(c.extra_price)}`
                      : null;

                return (
                  <li key={c.id} className="relative">
                    <button
                      type="button"
                      onClick={() => onChange(c.id, g.id)}
                      disabled={fixed}
                      aria-pressed={on}
                      data-testid={`variant-${c.code}`}
                      className={cn(
                        'relative h-full w-full rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-70',
                        withImage
                          ? 'overflow-hidden'
                          : 'min-h-10 py-2 pr-2.5 pl-8',
                        on
                          ? withImage
                            ? 'border-brown bg-ivory/70 ring-2 ring-brown/50'
                            : 'border-brown bg-ivory/55'
                          : 'border-line bg-white hover:border-ink/40 hover:bg-sand/20'
                      )}
                    >
                      {withImage && (
                        <span className="relative block aspect-square bg-sand">
                          <ChoiceThumbnail key={c.image_url ?? 'no-image'} src={c.image_url} name={c.name} />
                        </span>
                      )}

                      {withImage ? (
                        on && (
                          <span
                            className="absolute top-1 left-1 inline-flex size-5 items-center justify-center rounded-full bg-brown text-white"
                            aria-hidden="true"
                          >
                            <Check className="size-2.5" />
                          </span>
                        )
                      ) : (
                        <span
                          className={cn(
                            'absolute left-2.5 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded-full border bg-white',
                            on ? 'border-brown' : 'border-line'
                          )}
                          aria-hidden="true"
                        >
                          {on && <span className="size-2 rounded-full bg-brown" />}
                        </span>
                      )}

                      <span className={cn('block', withImage && 'px-2 py-1.5')}>
                        <span className="block break-words text-xs font-medium leading-[1.35] text-ink">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {c.kind !== 'option' && (
                            <span className="rounded bg-sand px-1 text-[0.58rem] text-muted">
                              {VARIANT_KIND_LABELS[c.kind]}
                            </span>
                          )}
                          {extra && <span className="text-[0.65rem] font-semibold text-ink-soft">{extra}</span>}
                        </span>
                      </span>
                    </button>
                    {withImage && c.image_url && (
                      <button
                        type="button"
                        onClick={() => setEnlargedChoice({ url: c.image_url!, label: c.name })}
                        aria-label={`${c.name}の色・柄見本を拡大`}
                        className="absolute right-1 top-1 z-10 inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-line bg-white/95 text-ink shadow-sm hover:bg-white"
                      >
                        <ZoomIn className="size-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <ProductImageLightbox
        open={Boolean(enlargedChoice)}
        productName="選択肢"
        images={enlargedChoice ? [enlargedChoice] : []}
        selectedIndex={0}
        onSelect={() => {}}
        onClose={() => setEnlargedChoice(null)}
      />
    </div>
  );
}
