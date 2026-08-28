'use client';

import { ImageOff, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Props {
  categories: OptionCategory[];
  options: ProductOption[];
  selected: string[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/**
 * 先方モックアップの「標準設備及び仕上げ表」。
 * カテゴリーごとに現在選ばれている商品名・価格を表示し、商品が選択されている場合だけ
 * 表示順が最初の画像あり商品を代表画像として使う。未選択時は画像枠自体を表示しない。
 * クリックで選択ポップアップを開く（変更方法①）。
 */
export function EquipmentBoard({ categories, options, selected, readOnly, onPickCategory }: Props) {
  const selectedSet = new Set(selected);
  const shown = categories.filter((c) => c.code !== 'sitework' && options.some((o) => o.category_id === c.id));

  return (
    <section aria-labelledby="equipment-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="equipment-heading" className="text-base font-semibold">
          標準設備及び仕上げ表
        </h2>
        <span className="text-xs text-muted">項目をクリックして変更</span>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4" data-testid="equipment-board">
        {shown.map((cat) => {
          const categoryOptions = options
            .filter((o) => o.category_id === cat.id)
            .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
          const chosen = categoryOptions.filter((o) => selectedSet.has(o.id));
          const main = chosen[0] ?? null;
          const representative = main ? categoryOptions.find((o) => Boolean(o.image_url)) ?? null : null;
          const extraCount = chosen.length - 1;
          return (
            <li key={cat.id} className="bg-white">
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onPickCategory(cat.id)}
                className="group flex h-full w-full flex-col gap-2 p-3 text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed"
                data-testid={`equip-${cat.code}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted">{cat.name}</span>
                  {!readOnly && <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
                </span>
                {main && (
                  <span className="relative block aspect-[4/3] w-full overflow-hidden rounded bg-sand">
                    {representative?.image_url ? (
                      <SmartImage src={representative.image_url} alt={`${cat.name}の代表画像`} fill sizes="(min-width: 640px) 11rem, 45vw" className="object-cover" />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted">
                        <ImageOff className="size-5" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm leading-snug font-semibold', !main && 'text-muted')}>{main ? main.name : '選択なし'}</span>
                  {extraCount > 0 && <span className="block text-[0.7rem] text-muted">ほか {extraCount} 点</span>}
                  {main && (
                    <span className="mt-0.5 block text-xs text-ink-soft">
                      {main.price_on_request ? '別途見積' : main.price === 0 ? '標準' : `+${formatYen(main.price)}`}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
