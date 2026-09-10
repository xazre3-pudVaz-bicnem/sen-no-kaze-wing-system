'use client';

import { Pencil } from 'lucide-react';
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

const INTERIOR_EXTERIOR_CATEGORY_ORDER = [
  'interior-door',
  'sash',
] as const;

const OPTION_CATEGORY_ORDER = [
  'ub',
  'toilet',
  'washbasin',
  'kitchen',
  'boiler',
  'aircon',
  'lighting',
  'smartlock',
] as const;

const OTHER_PRODUCT_CATEGORY_ORDER = [
  'furniture',
  'appliances',
  'exterior-parts',
  'office-supplies',
  'free-product',
] as const;

const INTERIOR_EXTERIOR_CATEGORY_CODES = new Set<string>(INTERIOR_EXTERIOR_CATEGORY_ORDER);
const OPTION_CATEGORY_CODES = new Set<string>(OPTION_CATEGORY_ORDER);
const OTHER_PRODUCT_CATEGORY_CODES = new Set<string>(OTHER_PRODUCT_CATEGORY_ORDER);

function sortCategoriesForDisplay(categories: OptionCategory[], preferredCodes: readonly string[]): OptionCategory[] {
  const rank = new Map(preferredCodes.map((code, index) => [code, index]));
  return [...categories].sort((a, b) => {
    const aRank = rank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.group_sort - b.group_sort || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja');
  });
}

function isInteriorExteriorCategory(category: OptionCategory): boolean {
  return INTERIOR_EXTERIOR_CATEGORY_CODES.has(category.code);
}

function isOtherProductCategory(category: OptionCategory): boolean {
  return OTHER_PRODUCT_CATEGORY_CODES.has(category.code);
}

/**
 * プランボード後半の仕様表。
 * 内外装工事は、既存の内部建具・サッシカテゴリーだけを表示する。
 * オプションとその他の商品は別のレスポンシブ単位として分ける。
 */
export function EquipmentBoard({ categories, options, selected, readOnly, onPickCategory }: Props) {
  const selectedSet = new Set(selected);
  const shown = categories.filter((c) => c.code !== 'sitework' && options.some((o) => o.category_id === c.id));
  const interiorExteriorCats = sortCategoriesForDisplay(shown.filter(isInteriorExteriorCategory), INTERIOR_EXTERIOR_CATEGORY_ORDER);
  const optionCats = sortCategoriesForDisplay(
    shown.filter((c) => OPTION_CATEGORY_CODES.has(c.code)),
    OPTION_CATEGORY_ORDER
  );
  const otherProductCats = sortCategoriesForDisplay(shown.filter(isOtherProductCategory), OTHER_PRODUCT_CATEGORY_ORDER);

  const normalTile = (cat: OptionCategory) => {
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
          className="group grid h-full min-h-24 w-full grid-cols-2 items-stretch text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed"
          data-testid={`equip-${cat.code}`}
        >
          <span className="block min-h-24 w-full p-1.5 sm:p-2">
            <span className="relative block h-full min-h-20 w-full overflow-hidden rounded bg-sand">
              {main?.image_url ? (
                <SmartImage
                  src={main.image_url}
                  alt={main.name}
                  fill
                  sizes="(min-width: 1024px) 12.5vw, (min-width: 640px) 16.7vw, 25vw"
                  className="object-cover"
                />
              ) : (
                <span className="flex h-full min-h-20 items-center justify-center bg-ivory px-2 text-center text-[0.65rem] text-muted">
                  画像未登録
                </span>
              )}
            </span>
          </span>
          <span className="flex min-w-0 flex-col justify-center p-2">
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

  const sectionHeader = (id: string, title: string, description?: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/50 bg-white px-4 py-2">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold">
          【{title}】
        </h2>
        {description && <p className="mt-0.5 text-[0.7rem] text-muted">{description}</p>}
      </div>
      <span className="text-[0.7rem] text-muted">{readOnly ? '確認のみ' : '項目をクリックして変更'}</span>
    </div>
  );

  const emptyState = <p className="px-4 py-6 text-sm text-muted">現在選択されている商品はありません</p>;

  return (
    <div className="space-y-4" data-testid="equipment-board">
      <section aria-labelledby="interior-exterior-heading" className="overflow-hidden border border-gold bg-white" data-testid="equipment-board-interior-exterior">
        {sectionHeader('interior-exterior-heading', '内外装工事')}
        {interiorExteriorCats.length > 0 ? (
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-interior-exterior-list">
            {interiorExteriorCats.map(normalTile)}
          </ul>
        ) : (
          emptyState
        )}
      </section>

      <section aria-labelledby="option-heading" className="overflow-hidden border border-gold bg-white" data-testid="equipment-board-option-section">
        {sectionHeader('option-heading', 'オプション')}
        {optionCats.length > 0 ? (
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-options">
            {optionCats.map(normalTile)}
          </ul>
        ) : (
          emptyState
        )}
      </section>

      <section aria-labelledby="other-products-heading" className="overflow-hidden border border-gold bg-white" data-testid="equipment-board-other-products">
        {sectionHeader('other-products-heading', 'その他の商品', '外構及びオリジナル制作家具など')}
        {otherProductCats.length > 0 ? (
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-other-products-list">
            {otherProductCats.map(normalTile)}
          </ul>
        ) : (
          emptyState
        )}
      </section>
    </div>
  );
}
