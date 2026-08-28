'use client';

import { Check, ImageOff } from 'lucide-react';
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
}

/**
 * 商品の仕様選び（ネットショップの「カラー」「サイズ」に相当）。
 * 商品を選んだあとに、その商品の選択項目だけを出す。
 * 画像のある選択肢は写真で、ないものは名前だけのチップで並べる。
 */
export function VariantPicker({ groups, choices, selected, onChange }: Props) {
  if (groups.length === 0) return null;
  const picked = new Set(selected);

  return (
    <div className="space-y-5 border-t border-line pt-4" data-testid="variant-picker">
      {groups.map((g) => {
        const list = choices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
        if (list.length === 0) return null;
        const withImage = list.some((c) => c.image_url);
        const fixed = list.length === 1 && list[0].kind === 'fixed';
        const current = list.find((c) => picked.has(c.id));

        return (
          <section key={g.id} data-testid={`variant-group-${g.code}`}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 className="text-sm font-semibold">{g.name}</h3>
              {fixed ? (
                <span className="text-xs text-muted">この商品では変更できません</span>
              ) : (
                <span className="text-xs text-muted">{current ? current.name : '選んでください'}</span>
              )}
            </div>
            {g.note && <p className="mt-0.5 text-xs text-muted">{g.note}</p>}

            <ul className={cn('mt-2 gap-2', withImage ? 'grid grid-cols-3 sm:grid-cols-4' : 'flex flex-wrap')}>
              {list.map((c) => {
                const on = picked.has(c.id);
                const extra = c.price_on_request ? '別途見積' : c.extra_price > 0 ? `+${formatYen(c.extra_price)}` : null;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onChange(c.id, g.id)}
                      disabled={fixed}
                      aria-pressed={on}
                      data-testid={`variant-${c.code}`}
                      className={cn(
                        'w-full rounded-lg border text-left transition disabled:cursor-not-allowed disabled:opacity-70',
                        withImage ? 'overflow-hidden' : 'px-3 py-1.5 text-sm',
                        on ? 'border-brown bg-ivory/70 ring-2 ring-brown/60' : 'border-line hover:border-ink/40'
                      )}
                    >
                      {withImage && (
                        <span className="relative block aspect-square bg-sand">
                          {c.image_url ? (
                            <SmartImage src={c.image_url} alt={c.name} fill sizes="120px" className="object-cover" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-muted">
                              <ImageOff className="size-4" aria-hidden="true" />
                            </span>
                          )}
                          {on && (
                            <span className="absolute top-1 left-1 inline-flex size-5 items-center justify-center rounded-full bg-brown text-white">
                              <Check className="size-3" aria-hidden="true" />
                            </span>
                          )}
                        </span>
                      )}
                      <span className={cn('block', withImage && 'px-2 py-1.5')}>
                        <span className="block text-xs leading-snug font-medium">{c.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {c.kind !== 'option' && (
                            <span className="rounded bg-sand px-1 text-[0.6rem] text-muted">{VARIANT_KIND_LABELS[c.kind]}</span>
                          )}
                          {extra && <span className="text-[0.65rem] text-ink-soft">{extra}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
