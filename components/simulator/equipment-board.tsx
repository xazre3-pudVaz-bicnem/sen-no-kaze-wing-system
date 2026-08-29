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
 * 「標準設備及び仕上げ表」。
 * 先方指示（2026-08-29）：全体的に最小の高さに。エクセル（分類表）と同じく
 * 「ここまでが本体／下がオプション」の区分けを見せる。説明はカーソルで表示。
 */
export function EquipmentBoard({ categories, options, selected, readOnly, onPickCategory }: Props) {
  const selectedSet = new Set(selected);
  const shown = categories.filter((c) => c.code !== 'sitework' && options.some((o) => o.category_id === c.id));
  // 分類表の区分：本体（工場生産分に含む）とオプション
  const baseCats = shown.filter((c) => c.finish_level === 'shell');
  const optionCats = shown.filter((c) => c.finish_level !== 'shell');

  const tile = (cat: OptionCategory) => {
    const chosen = options.filter((o) => o.category_id === cat.id && selectedSet.has(o.id));
    const main = chosen[0] ?? null;
    const extraCount = chosen.length - 1;
    return (
      <li key={cat.id} className="bg-white">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onPickCategory(cat.id)}
          title={main?.description ?? cat.description ?? undefined}
          className="group flex h-full w-full items-center gap-2 p-2 text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed"
          data-testid={`equip-${cat.code}`}
        >
          <span className="relative block size-12 shrink-0 overflow-hidden rounded bg-sand">
            {main?.image_url ? (
              <SmartImage src={main.image_url} alt={main.name} fill sizes="48px" className="object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-muted">
                <ImageOff className="size-4" aria-hidden="true" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-1">
              <span className="truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
              {!readOnly && <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
            </span>
            <span className={cn('block text-xs leading-snug font-semibold', !main && 'text-muted')}>
              {main ? main.name : '選択なし'}
              {extraCount > 0 && <span className="ml-1 font-normal text-[0.65rem] text-muted">ほか {extraCount} 点</span>}
            </span>
            {main && (
              <span className="block text-[0.7rem] text-ink-soft">
                {main.price_on_request ? '別途見積' : main.price === 0 ? '標準' : `+${formatYen(main.price)}`}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section aria-labelledby="equipment-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 id="equipment-heading" className="text-sm font-semibold">
          標準設備及び仕上げ表
        </h2>
        <span className="text-[0.7rem] text-muted">項目をクリックして変更</span>
      </div>
      {baseCats.length > 0 && (
        <>
          <p className="bg-sand/50 px-4 py-1 text-[0.65rem] font-semibold text-ink-soft">本体（工場生産分に含む）</p>
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board">
            {baseCats.map(tile)}
          </ul>
        </>
      )}
      {optionCats.length > 0 && (
        <>
          <p className="border-t border-line bg-sand/50 px-4 py-1 text-[0.65rem] font-semibold text-ink-soft">オプション</p>
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-options">
            {optionCats.map(tile)}
          </ul>
        </>
      )}
    </section>
  );
}
