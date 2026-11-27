import { INCLUDED_IN_UNIT_LABEL } from './equipment-inclusion';
import type { OptionCategory, OptionIncludedCategory, ProductOption } from './types';

/**
 * 設備包含（#628 の続き・A 案）：ユニットに含まれるカテゴリーの二重の選択の防止と「別室に追加」。
 *
 * - 包含元（例：3 点ユニット）を選んでいる間、含まれるカテゴリー（トイレ・洗面）は「ユニットに含まれています」で、選択も金額も無し
 * - お客様が「別室に追加する」から選んだ商品だけ、別の部屋の追加の設備として選べ、金額に入る（印つきの明細）
 * - 印の無い同じカテゴリーの選択は、保存・見積依頼で止める（DB の validate_configuration_items と同じ判定・同じ文言）
 *
 * 金額の計算は今のまま（含まれるカテゴリーの商品を選ばなければ、「選んだ商品 − 標準」の差額から標準の単体の分が外れる）。
 */
export { INCLUDED_IN_UNIT_LABEL };
export const ADD_TO_SEPARATE_ROOM_LABEL = '別室に追加する';
export const SEPARATE_ROOM_LABEL = '別室';

/** 「別室に追加」の印を付けられるカテゴリーのコード（#628 の包含先と同じ。DB の validate_configuration_items と同じ） */
export const SEPARATE_ROOM_CATEGORY_CODES: readonly string[] = ['toilet', 'washbasin'];

/** 別室に追加できる設備の数の上限（DB の save_configuration_atomic・入力の検査と同じ） */
export const SEPARATE_ROOM_MAX_ITEMS = 10;

/** DB と同じ文言（保存・見積依頼で止めたときにそのまま出る） */
export function includedDuplicateMessage(categoryName: string, sourceNames: readonly string[]): string {
  return `「${categoryName}」は「${sourceNames.join('・')}」に含まれています。別の部屋に追加する場合は「別室に追加する」から選んでください`;
}

export function separateRoomNotAllowedMessage(optionName: string): string {
  return `「${optionName}」は別室に追加できません（別室に追加できるのはトイレ・洗面の商品です）`;
}

/**
 * 印なしで選んだ商品（カテゴリー単位・位置の枠）のうち包含元のものが含むカテゴリー → 含んでいる商品の ID（重複なし）。
 * 別室の明細は包含元にならない（印を付けられるのはトイレ・洗面だけ）
 */
export function includedCategorySources(
  selectedIds: readonly string[],
  relations: readonly OptionIncludedCategory[] | null | undefined,
): Map<string, string[]> {
  const selected = new Set(selectedIds);
  const out = new Map<string, string[]>();
  for (const relation of relations ?? []) {
    if (!selected.has(relation.option_id)) continue;
    const sources = out.get(relation.included_category_id) ?? [];
    if (!sources.includes(relation.option_id)) sources.push(relation.option_id);
    out.set(relation.included_category_id, sources);
  }
  return out;
}

export interface EquipmentInclusionIssue {
  type: 'included' | 'separate_room';
  message: string;
  /** 直す対象の商品（印の無い重複の商品・印を付けられない商品） */
  option_ids: string[];
  category_id: string | null;
}

/**
 * 保存・見積依頼と同じ判定（DB の validate_configuration_items の包含の部分）。
 * selectedIds は印なしの選択（カテゴリー単位と位置の枠）、separateRoomIds は別室に追加した商品。
 * 判定の順は DB と同じ（印を付けられない商品 → 含まれるカテゴリーの印の無い重複。カテゴリーの並び順）
 */
export function equipmentInclusionIssues(input: {
  options: readonly ProductOption[];
  categories: readonly OptionCategory[];
  relations: readonly OptionIncludedCategory[] | null | undefined;
  selectedIds: readonly string[];
  separateRoomIds?: readonly string[];
}): EquipmentInclusionIssue[] {
  const optionById = new Map(input.options.map((option) => [option.id, option]));
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const issues: EquipmentInclusionIssue[] = [];

  for (const id of new Set(input.separateRoomIds ?? [])) {
    const option = optionById.get(id);
    const code = option ? categoryById.get(option.category_id)?.code : undefined;
    if (!option || !code || !SEPARATE_ROOM_CATEGORY_CODES.includes(code)) {
      issues.push({
        type: 'separate_room',
        message: separateRoomNotAllowedMessage(option?.name ?? '不明な商品'),
        option_ids: [id],
        category_id: option?.category_id ?? null,
      });
    }
  }

  const sources = includedCategorySources(input.selectedIds, input.relations);
  const duplicates = [...sources.entries()]
    .map(([categoryId, sourceIds]) => ({
      category: categoryById.get(categoryId),
      categoryId,
      sourceIds,
      duplicateIds: [...new Set(input.selectedIds)].filter((id) => optionById.get(id)?.category_id === categoryId),
    }))
    .filter((entry) => entry.duplicateIds.length > 0)
    .sort((a, b) =>
      (a.category?.sort_order ?? 0) - (b.category?.sort_order ?? 0) || (a.category?.name ?? '').localeCompare(b.category?.name ?? ''));
  for (const entry of duplicates) {
    const sourceNames = [...new Set(entry.sourceIds.map((id) => optionById.get(id)?.name ?? '不明な商品'))].sort();
    issues.push({
      type: 'included',
      message: includedDuplicateMessage(entry.category?.name ?? '不明なカテゴリー', sourceNames),
      option_ids: entry.duplicateIds,
      category_id: entry.categoryId,
    });
  }
  return issues;
}

/** 見積の区分（DB の estimate_section_for_option と同じ。standard-estimate-pricing の内外装のコードと同じ並び） */
const INTERIOR_EXTERIOR_CODES = new Set([
  'floor', 'flooring', 'wall-ceiling', 'interior-door', 'exterior-wall', 'roof', 'sash', 'entrance-door', 'service-door', 'carpentry',
]);
function quoteSectionOf(categoryCode: string, isInstallation: boolean): 'interior_exterior' | 'option' | 'sitework' {
  if (isInstallation || categoryCode === 'free-product') return 'sitework';
  return INTERIOR_EXTERIOR_CODES.has(categoryCode) ? 'interior_exterior' : 'option';
}
const SECTION_SORT_BASE = { interior_exterior: 1000, option: 2000, sitework: 3000 } as const;
const SECTION_KIND = { interior_exterior: 'interior_exterior', option: 'option', sitework: 'installation' } as const;

export interface InclusionQuoteNoteLine {
  kind: 'interior_exterior' | 'option' | 'installation';
  name: string;
  description: string;
  unit: '式';
  remark: string;
  quantity: number;
  image_url: string | null;
  sort_order: number;
}

/**
 * 見積の写しの 0 円の行（DB の write_configuration_inclusion_quote_notes と同じ中身・同じ並び）。
 * - ユニットに含まれるカテゴリー（含まれるカテゴリーの商品を印なしで選んでいないもの）：「（ユニットに含まれています）」の注記
 * - copySeparateRoom のとき、別室に追加した明細の写し（明細を 1 行ずつ写す旧仕様では写さない）
 */
export function inclusionQuoteNoteLines(input: {
  options: readonly ProductOption[];
  categories: readonly OptionCategory[];
  relations: readonly OptionIncludedCategory[] | null | undefined;
  items: readonly { option_id: string; separate_room?: boolean; quantity?: number; variant_label?: string | null }[];
  copySeparateRoom: boolean;
}): InclusionQuoteNoteLine[] {
  const optionById = new Map(input.options.map((option) => [option.id, option]));
  const categoryById = new Map(input.categories.map((category) => [category.id, category]));
  const unmarked = input.items.filter((item) => !item.separate_room).map((item) => item.option_id);
  const unmarkedCategories = new Set(unmarked.map((id) => optionById.get(id)?.category_id).filter(Boolean));
  const lines: InclusionQuoteNoteLine[] = [];

  const included = [...includedCategorySources(unmarked, input.relations).entries()]
    .filter(([categoryId]) => !unmarkedCategories.has(categoryId))
    .map(([categoryId, sourceIds]) => ({ category: categoryById.get(categoryId), sourceIds }))
    .filter((entry): entry is { category: OptionCategory; sourceIds: string[] } => Boolean(entry.category))
    .sort((a, b) => a.category.sort_order - b.category.sort_order || a.category.code.localeCompare(b.category.code));
  included.forEach((entry, index) => {
    const section = quoteSectionOf(entry.category.code, false);
    const sourceNames = [...new Set(entry.sourceIds.map((id) => optionById.get(id)?.name ?? '不明な商品'))].sort();
    lines.push({
      kind: SECTION_KIND[section],
      name: `${entry.category.name}（${INCLUDED_IN_UNIT_LABEL}）`,
      description: `「${sourceNames.join('・')}」に含まれています`,
      unit: '式',
      remark: '単体の商品は選んでいません（二重に計上しません）',
      quantity: 1,
      image_url: null,
      sort_order: SECTION_SORT_BASE[section] + 880 + index + 1,
    });
  });

  if (input.copySeparateRoom) {
    const separate = input.items
      .filter((item) => item.separate_room)
      .map((item) => ({ item, option: optionById.get(item.option_id) }))
      .filter((entry): entry is { item: (typeof input.items)[number]; option: ProductOption } => Boolean(entry.option))
      .map((entry) => ({ ...entry, category: categoryById.get(entry.option.category_id) }))
      .sort(
        (a, b) =>
          (a.category?.sort_order ?? 0) - (b.category?.sort_order ?? 0) ||
          a.option.sort_order - b.option.sort_order ||
          a.option.id.localeCompare(b.option.id)
      );
    separate.forEach((entry, index) => {
      const section = quoteSectionOf(entry.category?.code ?? '', entry.option.is_installation);
      lines.push({
        kind: SECTION_KIND[section],
        name: `${entry.category?.name ?? ''}（${SEPARATE_ROOM_LABEL}）`,
        description: `${entry.option.name}${entry.item.variant_label ? ` ／ ${entry.item.variant_label}` : ''}`,
        unit: '式',
        remark: '別室に追加した設備（価格は選択商品の変更差額に反映）',
        quantity: entry.item.quantity ?? 1,
        image_url: entry.option.image_url,
        sort_order: SECTION_SORT_BASE[section] + 860 + index + 1,
      });
    });
  }
  return lines;
}

/**
 * 選び直しの後の印なしの選択を、包含の変化に合わせてそろえる（シミュレーターの選び直しと、カード・候補の差額の仮計算で共通）。
 * - 新しく含まれるカテゴリー：印なしの選択を外す
 * - 含まれなくなったカテゴリー：印なしの選択が無ければ、標準の単体（standardIds のうちそのカテゴリーの商品）に戻す
 * 前から含まれているカテゴリーの印なしの選択（読み込んだプランの重複）は変えない（画面で直してもらう）
 */
export function reconcileIncludedSelection(input: {
  options: readonly ProductOption[];
  relations: readonly OptionIncludedCategory[] | null | undefined;
  prevIds: readonly string[];
  nextIds: readonly string[];
  /** 位置の枠で選んでいる商品（包含元になりうる。ここでは変えない） */
  slotOptionIds?: readonly string[];
  /** 戻す標準の単体（標準のユニットが含むカテゴリーを外す前の標準構成） */
  standardIds?: readonly string[];
  /** 戻してよい商品か（今の仕様で選べるか）。省略時はすべて戻す */
  canRestore?: (id: string) => boolean;
}): { next: string[]; dropped: string[]; restored: string[]; newlyIncluded: Map<string, string[]> } {
  const nextIds = [...input.nextIds];
  const relations = input.relations ?? [];
  if (relations.length === 0) return { next: nextIds, dropped: [], restored: [], newlyIncluded: new Map() };
  const optionById = new Map(input.options.map((option) => [option.id, option]));
  const categoryOf = (id: string) => optionById.get(id)?.category_id;
  const slots = input.slotOptionIds ?? [];
  const before = includedCategorySources([...input.prevIds, ...slots], relations);
  const after = includedCategorySources([...nextIds, ...slots], relations);
  const dropped = nextIds.filter((id) => {
    const categoryId = categoryOf(id);
    return Boolean(categoryId && after.has(categoryId) && !before.has(categoryId));
  });
  let next = nextIds.filter((id) => !dropped.includes(id));
  const restored: string[] = [];
  for (const categoryId of before.keys()) {
    if (after.has(categoryId) || next.some((id) => categoryOf(id) === categoryId)) continue;
    const standard = (input.standardIds ?? []).filter(
      (id) => categoryOf(id) === categoryId && !next.includes(id) && (input.canRestore?.(id) ?? true)
    );
    if (standard.length === 0) continue;
    next = [...next, ...standard];
    restored.push(...standard);
  }
  return { next, dropped, restored, newlyIncluded: new Map([...after].filter(([categoryId]) => !before.has(categoryId))) };
}

/**
 * 包含元を選んだときの選択の整理（シミュレーターの操作）：含まれるカテゴリーの印なしの選択を外す。
 * 外した商品を返す（画面で「ユニットに含まれるため外しました」と知らせ、別室に追加し直せるようにする）
 */
export function dropIncludedSelections(input: {
  options: readonly ProductOption[];
  relations: readonly OptionIncludedCategory[] | null | undefined;
  selectedIds: readonly string[];
}): { next: string[]; dropped: string[] } {
  const optionById = new Map(input.options.map((option) => [option.id, option]));
  const included = includedCategorySources(input.selectedIds, input.relations);
  const dropped = input.selectedIds.filter((id) => {
    const option = optionById.get(id);
    return Boolean(option && included.has(option.category_id));
  });
  return { next: input.selectedIds.filter((id) => !dropped.includes(id)), dropped };
}
