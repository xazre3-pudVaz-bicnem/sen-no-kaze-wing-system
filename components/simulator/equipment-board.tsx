'use client';

import { CirclePlus, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { equipmentCategoryPriceState } from '@/lib/domain/equipment-price-display';
import type { SimulatorCardDelta, SimulatorCardTarget } from '@/lib/domain/simulator-card-price-delta';
import { simulatorCardPricePresentation } from '@/lib/domain/simulator-card-price-presentation';
import { isSimulatorSelectableProduct, productLedgerState } from '@/lib/domain/product-lifecycle';
import { ADD_TO_SEPARATE_ROOM_LABEL, INCLUDED_IN_UNIT_LABEL, SEPARATE_ROOM_LABEL } from '@/lib/domain/equipment-separate-room';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

/** 位置・用途の選択枠（v2.5 PR-S2）のタイル。位置ごとに選ぶカテゴリーは、カテゴリーのタイルの代わりに位置ごとに並べる */
export interface EquipmentSlotTile {
  slotCode: string;
  categoryId: string;
  /** 位置・用途の名前（掃出し窓など） */
  label: string;
  /** 今選んでいる商品（表示用の価格つき） */
  option: ProductOption | null;
  /** 選んだ選択肢の名前 */
  variantNames: string[];
  /** 本部画面の既存表示。お客様は正式税込差額評価器を使用。 */
  state?: 'standard' | 'changed' | 'price-on-request';
  deltaLabel?: string | null;
}

interface Props {
  categories: OptionCategory[];
  options: ProductOption[];
  selected: string[];
  baselineSelected: string[];
  selectedVariantIds?: string[];
  baselineVariantIds?: string[];
  variantGroups?: OptionVariantGroup[];
  variantChoices?: OptionVariantChoice[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
  slotTiles?: EquipmentSlotTile[];
  onPickSlot?: (slotCode: string) => void;
  /** 正式な見積総額の差による表示専用の税込影響額（PR #680）。 */
  getCardDelta?: (target: SimulatorCardTarget) => SimulatorCardDelta;
  /** 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリー → 含んでいる商品の名前 */
  includedCategoryNames?: Map<string, string[]>;
  /** 別室に追加した商品（表示用の価格つき） */
  separateRoomOptions?: ProductOption[];
  onAddSeparateRoom?: (categoryId: string) => void;
  onRemoveSeparateRoom?: (optionId: string) => void;
  /** 前からある重複（ユニットに含まれるカテゴリーの印なしの選択）を直す：外すか、別の部屋の設備にする */
  onResolveIncluded?: (categoryId: string, mode: 'remove' | 'separate') => void;
}

const INTERIOR_EXTERIOR_CATEGORY_ORDER = [
  'roof',
  'exterior-wall',
  'entrance-door',
  'service-door',
  'sash',
  'interior-door',
  'carpentry',
  'floor',
  'wall-ceiling',
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
  'entrance-storage',
  'closet',
  'bed',
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
 * 内外装工事は、モデル／仕様ごとに選択可能な屋根・外壁・建具・内装仕上げをまとめて表示する。
 * オプションとその他の商品は別のレスポンシブ単位として分ける。
 */
export function EquipmentBoard({
  categories,
  options,
  selected,
  baselineSelected,
  selectedVariantIds = [],
  baselineVariantIds = [],
  variantGroups = [],
  variantChoices = [],
  readOnly,
  onPickCategory,
  slotTiles = [],
  onPickSlot,
  getCardDelta,
  includedCategoryNames = new Map<string, string[]>(),
  separateRoomOptions = [],
  onAddSeparateRoom,
  onRemoveSeparateRoom,
  onResolveIncluded,
}: Props) {
  const selectedSet = new Set(selected);
  // categories は上位で本体分類表の「選択 / ×」を解決済み。
  // 候補商品が未登録でも「選択」の業務項目自体は表示し、商品一覧側で空状態を明示する。
  const shown = categories.filter((c) => c.code !== 'sitework');
  const interiorExteriorCats = sortCategoriesForDisplay(shown.filter(isInteriorExteriorCategory), INTERIOR_EXTERIOR_CATEGORY_ORDER);
  const optionCats = sortCategoriesForDisplay(
    shown.filter((c) => OPTION_CATEGORY_CODES.has(c.code)),
    OPTION_CATEGORY_ORDER
  );
  const otherProductCats = sortCategoriesForDisplay(shown.filter(isOtherProductCategory), OTHER_PRODUCT_CATEGORY_ORDER);

  const priceTone = (tone: ReturnType<typeof simulatorCardPricePresentation>['tone']) =>
    tone === 'increase' ? 'text-red-700' : tone === 'decrease' ? 'text-blue-700' : 'text-muted';

  const slotTile = (cat: OptionCategory, tile: EquipmentSlotTile) => {
    const delta = getCardDelta?.({ kind: 'slot', slotCode: tile.slotCode });
    const display = delta ? simulatorCardPricePresentation(delta) : null;
    const state = delta ? delta.kind : tile.state;
    const badge =
      state === 'standard'
        ? { label: '標準', className: 'border-gold/45 bg-sand/70 text-brown' }
        : state === 'changed'
          ? { label: '変更済', className: 'border-brown/35 bg-ivory text-brown' }
          : { label: delta ? '要確認' : '別途見積', className: 'border-line bg-white text-ink-soft' };
    const main = tile.option;
    return (
      <li key={`slot-${tile.slotCode}`} className="bg-white">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onPickSlot?.(tile.slotCode)}
          title={main?.description ?? cat.description ?? undefined}
          className={cn(
            'group grid h-full min-h-24 w-full grid-cols-2 items-stretch text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed',
            state === 'changed' && 'bg-ivory/35'
          )}
          data-testid={`equip-slot-${tile.slotCode}`}
        >
          <span className="block min-h-24 w-full p-1.5 sm:p-2">
            <span className="relative block h-24 w-full overflow-hidden rounded border border-line/60 bg-white sm:h-28">
              {main?.image_url ? (
                <SmartImage
                  src={main.image_url}
                  alt={main.name}
                  fill
                  sizes="(min-width: 1024px) 12.5vw, (min-width: 640px) 16.7vw, 25vw"
                  className="object-contain p-1.5"
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
              <span className="truncate text-[0.65rem] font-semibold text-muted">
                {cat.name}・{tile.label}
              </span>
              {!readOnly && <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
            </span>
            <span
              className={cn('mt-0.5 mb-1 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold leading-none', badge.className)}
              data-testid={`equip-slot-state-${tile.slotCode}`}
            >
              {badge.label}
            </span>
            <span className={cn('block text-xs leading-snug font-semibold', !main && 'text-muted')}>{main ? main.name : '選択なし'}</span>
            {tile.variantNames.length > 0 && (
              <span className="mt-0.5 block truncate text-[0.62rem] text-muted">{tile.variantNames.join('・')}</span>
            )}
            {display ? (
              <span
                className={cn('mt-0.5 block break-words text-[0.72rem] font-semibold tabular-nums', priceTone(display.tone))}
                data-testid={`equip-slot-price-${tile.slotCode}`}
                data-price-tone={display.tone}
              >
                {display.label}
              </span>
            ) : tile.state === 'changed' && tile.deltaLabel ? (
              <span className="mt-0.5 block text-[0.72rem] font-semibold text-brown" data-testid={`equip-slot-price-${tile.slotCode}`}>
                {tile.deltaLabel}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  const normalTile = (cat: OptionCategory) => {
    // 位置ごとに選ぶカテゴリー（v2.5 PR-S2）は、位置ごとのタイルを並べる
    const tiles = slotTiles.filter((tile) => tile.categoryId === cat.id);
    if (tiles.length > 0) return tiles.map((tile) => slotTile(cat, tile));
    const chosen = options.filter((o) => o.category_id === cat.id && selectedSet.has(o.id));
    const main = chosen[0] ?? null;
    const extraCount = chosen.length - 1;
    const delta = getCardDelta?.({ kind: 'category', categoryId: cat.id });
    const display = delta ? simulatorCardPricePresentation(delta) : null;

    if (!main) {
      return (
        <li key={cat.id} className="bg-white">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onPickCategory(cat.id)}
            title={cat.description ?? undefined}
            className="group flex min-h-20 w-full items-center gap-3 p-3 text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed sm:p-4"
            data-testid={`equip-${cat.code}`}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded border border-line bg-ivory text-muted sm:size-11">
              <CirclePlus className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
              <span className="mt-0.5 block text-xs font-semibold text-muted">選択なし</span>
              {delta && delta.kind !== 'standard' && display && (
                <span
                  className={cn('mt-0.5 block text-[0.72rem] font-semibold tabular-nums', priceTone(display.tone))}
                  data-testid={`equip-price-${cat.code}`}
                  data-price-tone={display.tone}
                >
                  {display.label}
                </span>
              )}
            </span>
            {!readOnly && (
              <Pencil className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            )}
          </button>
        </li>
      );
    }


    // 本部画面だけ従来の差額計算を維持。お客様は税込の見積総額差を表示する。
    const priceState = delta ? null : equipmentCategoryPriceState({
      categoryId: cat.id,
      options,
      selectedIds: selected,
      baselineIds: baselineSelected,
      selectedVariantIds,
      baselineVariantIds,
      variantGroups,
      variantChoices,
    });
    const selectedVariantPriceOnRequest = selectedVariantIds.some((choiceId) => {
      const choice = variantChoices.find((row) => row.id === choiceId);
      if (!choice?.price_on_request) return false;
      const group = variantGroups.find((row) => row.id === choice.group_id);
      return Boolean(group && chosen.some((option) => option.id === group.option_id));
    });
    const currentPriceOnRequest = chosen.some((option) => option.price_on_request) || selectedVariantPriceOnRequest;
    const legacyState =
      currentPriceOnRequest || priceState?.kind === 'price-on-request'
        ? 'price-on-request'
        : priceState?.kind === 'standard'
          ? 'standard'
          : 'changed';
    const state = delta ? delta.kind : legacyState;
    const deltaLabel =
      priceState?.kind === 'delta'
        ? priceState.delta > 0 ? `+${formatYen(priceState.delta)}` : formatYen(priceState.delta)
        : priceState?.kind === 'no-change' ? '追加費用なし' : null;

    // 保存済みの選択として残っている、新しくは選べない商品（販売停止・廃番・シミュレーター非表示）。標準構成の非表示の商品は標準として扱う
    const retained = chosen.find((option) => !isSimulatorSelectableProduct(option) && !baselineSelected.includes(option.id)) ?? null;
    const retainedLabel = retained
      ? productLedgerState(retained) === 'retired'
        ? `${retained.discontinued_at ? '廃番' : '販売停止'}の商品（保存済みの選択）`
        : '新しくは選べない商品（保存済みの選択）'
      : null;

    const badge =
      state === 'standard'
        ? { label: '標準', className: 'border-gold/45 bg-sand/70 text-brown' }
        : state === 'changed'
          ? { label: '変更済', className: 'border-brown/35 bg-ivory text-brown' }
          : { label: delta ? '要確認' : '別途見積', className: 'border-line bg-white text-ink-soft' };

    return (
      <li key={cat.id} className="bg-white">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onPickCategory(cat.id)}
          title={main?.description ?? cat.description ?? undefined}
          className={cn(
            'group grid h-full min-h-24 w-full grid-cols-2 items-stretch text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed',
            state === 'changed' && 'bg-ivory/35'
          )}
          data-testid={`equip-${cat.code}`}
        >
          <span className="block min-h-24 w-full p-1.5 sm:p-2">
            <span className="relative block h-24 w-full overflow-hidden rounded border border-line/60 bg-white sm:h-28">
              {main?.image_url ? (
                <SmartImage
                  src={main.image_url}
                  alt={main.name}
                  fill
                  sizes="(min-width: 1024px) 12.5vw, (min-width: 640px) 16.7vw, 25vw"
                  className="object-contain p-1.5"
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
            {badge && (
              <span
                className={cn(
                  'mt-0.5 mb-1 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold leading-none',
                  badge.className
                )}
                data-testid={`equip-state-${cat.code}`}
              >
                {badge.label}
              </span>
            )}
            <span className={cn('block text-xs leading-snug font-semibold', !main && 'text-muted')}>
              {main ? main.name : '選択なし'}
              {extraCount > 0 && <span className="ml-1 font-normal text-[0.65rem] text-muted">ほか {extraCount} 点</span>}
            </span>
            {retainedLabel && (
              <span className="mt-0.5 block text-[0.62rem] font-semibold text-warn" data-testid={`equip-retained-${cat.code}`}>
                {retainedLabel}
              </span>
            )}
            {display ? (
              <span
                className={cn('mt-0.5 block break-words text-[0.72rem] font-semibold tabular-nums', priceTone(display.tone))}
                data-testid={`equip-price-${cat.code}`}
                data-price-tone={display.tone}
              >
                {display.label}
              </span>
            ) : state === 'changed' && deltaLabel ? (
              <span className="mt-0.5 block text-[0.72rem] font-semibold text-brown" data-testid={`equip-price-${cat.code}`}>
                {deltaLabel}
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  /** ユニットに含まれるカテゴリー（#628 の続き・A 案）。前からある印なしの選択があれば、直す操作を出す */
  const includedTile = (cat: OptionCategory, sourceNames: string[]) => {
    const duplicates = options.filter((o) => o.category_id === cat.id && selectedSet.has(o.id));
    if (duplicates.length > 0) {
      return (
        <li key={cat.id} className="bg-white" data-testid={`equip-included-duplicate-${cat.code}`}>
          <div className="flex min-h-20 w-full flex-col gap-1 p-3 sm:p-4">
            <span className="block truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
            <span className="block text-xs font-semibold leading-snug">{duplicates.map((o) => o.name).join('・')}</span>
            <span className="block text-[0.62rem] font-semibold leading-relaxed text-warn">
              「{sourceNames.join('・')}」に含まれています。選択を外すか、別の部屋の設備にしてください
            </span>
            {!readOnly && onResolveIncluded && (
              <span className="mt-0.5 flex flex-wrap gap-x-3 text-[0.68rem] font-semibold">
                <button type="button" className="text-brown underline underline-offset-2 hover:no-underline" onClick={() => onResolveIncluded(cat.id, 'remove')} data-testid={`equip-resolve-remove-${cat.code}`}>
                  選択を外す
                </button>
                <button type="button" className="text-brown underline underline-offset-2 hover:no-underline" onClick={() => onResolveIncluded(cat.id, 'separate')} data-testid={`equip-resolve-separate-${cat.code}`}>
                  別室の設備にする
                </button>
              </span>
            )}
          </div>
        </li>
      );
    }
    return (
      <li key={cat.id} className="bg-white" data-testid={`equip-included-${cat.code}`}>
        <div className="flex min-h-20 w-full flex-col gap-1 p-3 sm:p-4">
          <span className="block truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
          <span className="inline-flex w-fit items-center rounded-full border border-gold/45 bg-sand/70 px-2 py-0.5 text-[0.62rem] font-semibold leading-none text-brown">
            {INCLUDED_IN_UNIT_LABEL}
          </span>
          <span className="block text-[0.62rem] leading-relaxed text-muted">「{sourceNames.join('・')}」に含まれます</span>
          {!readOnly && onAddSeparateRoom && (
            <button type="button" className="mt-0.5 w-fit text-[0.68rem] font-semibold text-brown underline underline-offset-2 hover:no-underline" onClick={() => onAddSeparateRoom(cat.id)} data-testid={`equip-add-separate-${cat.code}`}>
              {ADD_TO_SEPARATE_ROOM_LABEL}
            </button>
          )}
        </div>
      </li>
    );
  };

  /** 別室に追加した商品（#628 の続き・A 案）。普通の追加の設備として金額に入る */
  const separateTiles = (cat: OptionCategory) =>
    separateRoomOptions
      .filter((option) => option.category_id === cat.id)
      .map((option) => (
        <li key={`${cat.id}-separate-${option.id}`} className="bg-white" data-testid={`equip-separate-${cat.code}`}>
          <div className="flex min-h-20 w-full items-center gap-3 p-3 sm:p-4">
            <span className="relative block size-12 shrink-0 overflow-hidden rounded border border-line/60 bg-white">
              {option.image_url ? (
                <SmartImage src={option.image_url} alt={option.name} fill sizes="48px" className="object-contain p-1" />
              ) : (
                <span className="flex h-full items-center justify-center bg-ivory text-[0.55rem] text-muted">画像未登録</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
              <span className="mt-0.5 mb-1 inline-flex w-fit items-center rounded-full border border-brown/35 bg-ivory px-2 py-0.5 text-[0.62rem] font-semibold leading-none text-brown">
                {SEPARATE_ROOM_LABEL}
              </span>
              <span className="block text-xs font-semibold leading-snug">{option.name}</span>
              <span className="mt-0.5 block text-[0.72rem] font-semibold tabular-nums text-brown">
                {option.price_on_request ? '別途お見積り' : `+${formatYen(option.price)}`}
              </span>
              {!readOnly && (
                <span className="mt-1 flex flex-wrap gap-x-3 text-[0.68rem] font-semibold">
                  <button type="button" className="text-brown underline underline-offset-2 hover:no-underline" onClick={() => onAddSeparateRoom?.(cat.id)} data-testid={`equip-change-separate-${cat.code}`}>
                    変更
                  </button>
                  <button type="button" className="text-muted underline underline-offset-2 hover:no-underline" onClick={() => onRemoveSeparateRoom?.(option.id)} data-testid={`equip-remove-separate-${cat.code}`}>
                    外す
                  </button>
                </span>
              )}
            </span>
          </div>
        </li>
      ));

  /** カテゴリーのタイル：ユニットに含まれるときは包含のタイル、それ以外は今までどおり。別室に追加した商品はその後ろに並べる */
  const categoryTiles = (cat: OptionCategory) => {
    const sourceNames = includedCategoryNames.get(cat.id);
    return [sourceNames ? includedTile(cat, sourceNames) : normalTile(cat), ...separateTiles(cat)].flat();
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
            {interiorExteriorCats.map(categoryTiles)}
          </ul>
        ) : (
          emptyState
        )}
      </section>

      <section aria-labelledby="option-heading" className="overflow-hidden border border-gold bg-white" data-testid="equipment-board-option-section">
        {sectionHeader('option-heading', 'オプション')}
        {optionCats.length > 0 ? (
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-options">
            {optionCats.map(categoryTiles)}
          </ul>
        ) : (
          emptyState
        )}
      </section>

      <section aria-labelledby="other-products-heading" className="overflow-hidden border border-gold bg-white" data-testid="equipment-board-other-products">
        {sectionHeader('other-products-heading', 'その他の商品', '外構及びオリジナル制作家具など')}
        {otherProductCats.length > 0 ? (
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-other-products-list">
            {otherProductCats.map(categoryTiles)}
          </ul>
        ) : (
          emptyState
        )}
      </section>
      {getCardDelta && (
        <p className="px-1 text-[0.7rem] leading-relaxed text-muted" data-testid="equipment-price-impact-note">
          ※差額は、ほかの選択を維持してこの商品だけを標準に戻した場合との、税込見積総額の差です。各商品の差額は単純合計できない場合があります。
        </p>
      )}
    </div>
  );
}