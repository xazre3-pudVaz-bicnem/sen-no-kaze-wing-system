'use client';

import { Check, Info, RotateCcw } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { CatalogBundle, ModelPreset, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Props {
  bundle: CatalogBundle;
  selected: string[];
  blocked: Map<string, string>;
  onToggle: (id: string) => void;
  onReset: () => void;
  readOnly: boolean;
  presets: ModelPreset[];
  activePreset: string | null;
  onApplyPreset: (code: string) => void;
}

/**
 * オプション選択パネル。
 * 全カテゴリーを縦に並べて常に見える状態にし（隠れた項目を作らない）、
 * 上部のチップで該当カテゴリーへスクロールする。
 */
export function OptionPanel({ bundle, selected, blocked, onToggle, onReset, readOnly, presets, activePreset, onApplyPreset }: Props) {
  const groups = bundle.categories
    .map((c) => ({ category: c, options: bundle.options.filter((o) => o.category_id === c.id) }))
    .filter((g) => g.options.length > 0);
  const selectedSet = new Set(selected);

  return (
    <section aria-labelledby="options-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="options-heading" className="text-lg">オプションを選ぶ</h2>
        <button type="button" onClick={onReset} disabled={readOnly} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink disabled:opacity-40">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          標準に戻す
        </button>
      </div>

      {presets.length > 0 && (
        <div className="border-b border-line bg-sand/40 px-4 py-3">
          <p className="text-xs font-semibold text-muted">プランから始める</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.code}
                type="button"
                onClick={() => onApplyPreset(p.code)}
                disabled={readOnly}
                title={p.description}
                aria-pressed={activePreset === p.code}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition disabled:opacity-50',
                  activePreset === p.code ? 'border-brown bg-brown text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
                )}
                data-testid={`preset-${p.code}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          {activePreset && <p className="mt-1.5 text-xs text-muted">{presets.find((p) => p.code === activePreset)?.description}</p>}
        </div>
      )}

      <nav aria-label="カテゴリーへ移動" className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-white/95 px-3 py-2 backdrop-blur [scrollbar-width:none] lg:top-24">
        {groups.map(({ category, options }) => {
          const count = options.filter((o) => selectedSet.has(o.id) && o.price > 0).length;
          return (
            <a
              key={category.id}
              href={`#cat-${category.code}`}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-sand"
            >
              {category.name}
              {count > 0 && <span className="ml-1 rounded-full bg-sand px-1.5 text-[0.65rem]">{count}</span>}
            </a>
          );
        })}
      </nav>

      <div className="divide-y divide-line">
        {groups.map(({ category, options }) => (
          <section key={category.id} id={`cat-${category.code}`} aria-labelledby={`cat-heading-${category.code}`} className="scroll-mt-36 space-y-2.5 p-3 lg:scroll-mt-40">
            <div className="px-1 pt-1">
              <h3 id={`cat-heading-${category.code}`} className="font-sans text-sm font-semibold">
                {category.name}
                <span className="ml-2 text-xs font-normal text-muted">{category.selection_mode === 'single' ? '1つ選択' : '複数選択可'}</span>
              </h3>
              {category.description && <p className="text-xs text-muted">{category.description}</p>}
            </div>
            {options.map((o) => (
              <OptionCard
                key={o.id}
                option={o}
                single={category.selection_mode === 'single'}
                checked={selectedSet.has(o.id)}
                blockedReason={blocked.get(o.id) ?? null}
                disabled={readOnly}
                onToggle={() => onToggle(o.id)}
              />
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function OptionCard({
  option,
  single,
  checked,
  blockedReason,
  disabled,
  onToggle,
}: {
  option: ProductOption;
  single: boolean;
  checked: boolean;
  blockedReason: string | null;
  disabled: boolean;
  onToggle: () => void;
}) {
  const priceLabel = option.price_on_request ? '別途見積' : option.price === 0 ? '標準（追加費用なし）' : `+${formatYen(option.price)}`;
  return (
    <label
      className={cn(
        'flex cursor-pointer gap-3 rounded-xl border p-3 transition-all',
        checked ? 'border-brown bg-wood-light/30 shadow-soft' : 'border-line bg-white hover:border-ink/30',
        blockedReason && !checked && 'border-dashed bg-sand/50',
        disabled && 'cursor-not-allowed opacity-70'
      )}
      data-testid={`option-${option.code}`}
    >
      <input
        type={single ? 'radio' : 'checkbox'}
        name={single ? `cat-${option.category_id}` : undefined}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        // ラジオは選択済みの項目をクリックしても change が発火しないため click で切り替える
        onChange={() => undefined}
        onClick={onToggle}
        aria-describedby={blockedReason ? `blocked-${option.id}` : undefined}
      />
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center border-2 transition-colors',
          single ? 'rounded-full' : 'rounded-md',
          checked ? 'border-brown bg-brown text-white' : 'border-ink/30 bg-white'
        )}
      >
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
      {option.image_url && (
        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-sand">
          <SmartImage src={option.image_url} alt="" fill sizes="56px" className="object-cover" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{option.name}</span>
          <span className={cn('shrink-0 text-sm', option.price > 0 ? 'text-ink' : 'text-muted')}>{priceLabel}</span>
        </span>
        {option.description && <span className="mt-0.5 block text-xs text-ink-soft">{option.description}</span>}
        {blockedReason && !checked && (
          <span id={`blocked-${option.id}`} className="mt-1.5 flex items-start gap-1 text-xs text-warn">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {blockedReason}
          </span>
        )}
      </span>
    </label>
  );
}
