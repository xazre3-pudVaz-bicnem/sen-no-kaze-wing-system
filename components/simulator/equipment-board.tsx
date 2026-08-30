'use client';

import { useSyncExternalStore } from 'react';
import { ImageOff, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { EXTERIOR_FACES } from '@/lib/domain/exterior-wall';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';
import {
  getExteriorFaceDisplaysServerSnapshot,
  getExteriorFaceDisplaysSnapshot,
  requestExteriorFacePicker,
  subscribeExteriorFaceDisplays,
} from './exterior-face-display-store';

interface Props {
  categories: OptionCategory[];
  options: ProductOption[];
  selected: string[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

const INSULATION_ORDER = ['insulation-floor', 'insulation-wall', 'insulation-ceiling'] as const;

const OPTION_CATEGORY_ORDER = [
  'floor',
  'wall-ceiling',
  'interior-door',
  'carpentry',
  'ub',
  'toilet',
  'washbasin',
  'kitchen',
  'boiler',
  'aircon',
  'lighting',
  'smartlock',
  'furniture',
  'appliances',
  'exterior-parts',
  'office-supplies',
  'free-product',
] as const;

function sortCategoriesForDisplay(categories: OptionCategory[], preferredCodes: readonly string[]): OptionCategory[] {
  const rank = new Map(preferredCodes.map((code, index) => [code, index]));
  return [...categories].sort((a, b) => {
    const aRank = rank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
    const bRank = rank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.group_sort - b.group_sort || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja');
  });
}

/**
 * 「標準設備及び仕上げ表」。
 * 本体仕様は「外壁4面 → 断熱3部位 → その他本体仕様」の行構成で表示する。
 * サッシは将来、平面図ごとの設置位置に応じた可変枚数の行として追加する。
 * オプションは本体仕様から明確に区切り、お客様が仕様を決める順に並べる。
 */
export function EquipmentBoard({ categories, options, selected, readOnly, onPickCategory }: Props) {
  const selectedSet = new Set(selected);
  const exteriorDisplays = useSyncExternalStore(
    subscribeExteriorFaceDisplays,
    getExteriorFaceDisplaysSnapshot,
    getExteriorFaceDisplaysServerSnapshot
  );
  const shown = categories.filter((c) => c.code !== 'sitework' && options.some((o) => o.category_id === c.id));
  const baseCats = shown.filter((c) => c.finish_level === 'shell');
  const optionCats = sortCategoriesForDisplay(
    shown.filter((c) => c.finish_level !== 'shell'),
    OPTION_CATEGORY_ORDER
  );

  const exteriorCat = baseCats.find((c) => c.code === 'exterior-wall') ?? null;
  const insulationCats = sortCategoriesForDisplay(
    baseCats.filter((c) => INSULATION_ORDER.includes(c.code as (typeof INSULATION_ORDER)[number])),
    INSULATION_ORDER
  );
  const otherBaseCats = baseCats.filter(
    (c) => c.code !== 'exterior-wall' && !INSULATION_ORDER.includes(c.code as (typeof INSULATION_ORDER)[number])
  );

  const exteriorRows = EXTERIOR_FACES.map((face) => ({
    ...face,
    display: exteriorDisplays.find((row) => row.face_code === face.code) ?? null,
  }));
  const hasExteriorFaces = exteriorRows.every((row) => {
    const display = row.display;
    return Boolean(display && options.some((option) => option.id === display.option_id));
  });

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
                <span className="flex h-full min-h-20 items-center justify-center text-muted">
                  <ImageOff className="size-5" aria-hidden="true" />
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

  const exteriorTiles = (cat: OptionCategory) =>
    exteriorRows.map((row) => {
      const display = row.display;
      const option = display ? options.find((o) => o.id === display.option_id) ?? null : null;
      return (
        <li key={`${cat.id}-${row.code}`} className="bg-white">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              if (!requestExteriorFacePicker(row.code)) onPickCategory(cat.id);
            }}
            title={`${row.label}の外壁を変更`}
            className="group grid h-full min-h-24 w-full grid-cols-2 items-stretch text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed"
            data-testid={row.code === 'front' ? `equip-${cat.code}` : `equip-${cat.code}-${row.code}`}
            data-exterior-face={row.code}
          >
            <span className="block min-h-24 w-full p-1.5 sm:p-2">
              <span className="relative block h-full min-h-20 w-full overflow-hidden rounded bg-sand">
                {display?.image_url ? (
                  <SmartImage
                    src={display.image_url}
                    alt={`${row.label} ${display.option_name}`}
                    fill
                    sizes="(min-width: 1024px) 12.5vw, (min-width: 640px) 16.7vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full min-h-20 items-center justify-center text-muted">
                    <ImageOff className="size-5" aria-hidden="true" />
                  </span>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-ink/75 px-1.5 py-0.5 text-[0.55rem] font-semibold leading-none text-white">
                  {row.label}
                </span>
              </span>
            </span>
            <span className="flex min-w-0 flex-col justify-center p-2">
              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-[0.65rem] font-semibold text-muted">外壁（{row.label}）</span>
                {!readOnly && <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
              </span>
              <span className={cn('block text-xs leading-snug font-semibold', !display && 'text-muted')}>
                {display?.option_name ?? '選択なし'}
              </span>
              {(display?.variant_names.length ?? 0) > 0 && (
                <span className="mt-0.5 block line-clamp-2 text-[0.65rem] leading-snug text-muted">
                  {display?.variant_names.join('・')}
                </span>
              )}
              {option && <span className="mt-0.5 block text-[0.65rem] text-ink-soft">面別指定</span>}
            </span>
          </button>
        </li>
      );
    });

  const baseTile = (cat: OptionCategory) => {
    if (cat.code === 'exterior-wall' && hasExteriorFaces) return exteriorTiles(cat);
    return normalTile(cat);
  };

  return (
    <section aria-labelledby="equipment-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 id="equipment-heading" className="text-sm font-semibold">
          標準設備及び仕上げ表
        </h2>
        <span className="text-[0.7rem] text-muted">項目をクリックして変更</span>
      </div>

      {(exteriorCat || insulationCats.length > 0 || otherBaseCats.length > 0) && (
        <div data-testid="equipment-board">
          {exteriorCat && (
            <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4">
              {baseTile(exteriorCat)}
            </ul>
          )}

          {insulationCats.length > 0 && (
            <ul className="mt-px grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-insulation">
              {insulationCats.map(normalTile)}
            </ul>
          )}

          {otherBaseCats.length > 0 && (
            <ul className="mt-px grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-other-base">
              {otherBaseCats.map(normalTile)}
            </ul>
          )}
        </div>
      )}

      {optionCats.length > 0 && (
        <>
          <div className="flex items-center gap-3 bg-white px-4 py-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs font-semibold tracking-wide text-ink-soft">オプション</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-options">
            {optionCats.map(normalTile)}
          </ul>
        </>
      )}
    </section>
  );
}
