import type { V25LineRow, V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';

/**
 * 標準見積v2.5の表示専用工事項目。3モデル共通の内外装4項目（千の風2026-11-17確定）。
 * 本体・大区分・商品台帳・group_label・sort_order・価格に一切書き戻さない。
 */
export const V25_DISPLAY_WORK_ITEMS = [
  { id: 'sash_wood', label: '1. サッシ・木製建具工事', name: 'サッシ・木製建具工事', categoryCodes: ['sash', 'interior-door', 'entrance-door', 'service-door'] },
  { id: 'roof', label: '2. 屋根工事', name: '屋根工事', categoryCodes: ['roof'] },
  { id: 'exterior', label: '3. 外壁工事', name: '外壁工事', categoryCodes: ['exterior-wall'] },
  { id: 'interior', label: '4. 内装仕上げ', name: '内装仕上げ', categoryCodes: ['floor', 'wall-ceiling'] },
] as const;

type WorkItemRule = { id: string; label: string; name: string; categoryCodes: readonly string[] };
export type V25WorkItemContext = {
  /** 大区分を越えた表示移動は禁止。省略時は既存の内外装4項目として扱う。 */
  sectionCode?: V25LineRow['section_code'];
  /** モデル・仕様の正本は本部の選択中の標準見積から受け取る。 */
  modelSlug?: string | null;
  specCode?: string | null;
};

const EQUIPMENT_CATEGORIES = [
  'ub', 'kitchen', 'washbasin', 'toilet', 'boiler', 'aircon',
  'smartlock', 'entrance-storage', 'bed',
] as const;

/**
 * オプションはExcelのモデル・仕様で番号が異なるため、一律の「設備機器」は作らない。
 * 商品の取付費・造作工事・養生・照明器具・外構部品などは、
 * 製品カテゴリーだけで施工区分を判断できないため自動分類しない。
 */
export function v25OptionWorkItems(context: V25WorkItemContext): readonly WorkItemRule[] {
  const { modelSlug, specCode } = context;
  if (modelSlug === 'wing-01' && ['hotel', 'residence', 'office'].includes(specCode ?? '')) {
    return [
      { id: 'equipment', label: '1. 設備機器', name: '設備機器', categoryCodes: EQUIPMENT_CATEGORIES },
      { id: 'other_equipment', label: '2. その他の設備', name: 'その他の設備', categoryCodes: [] },
      { id: 'care', label: '3. 各種養生（床養生マット、壁ビニールシート等）', name: '各種養生（床養生マット、壁ビニールシート等）', categoryCodes: [] },
    ];
  }
  if (modelSlug === 'box' && ['hotel', 'hotel-single', 'water-kit'].includes(specCode ?? '')) {
    const n = specCode === 'water-kit' ? '2' : '1';
    return [
      { id: 'equipment', label: n + '. 設備機器', name: '設備機器', categoryCodes: EQUIPMENT_CATEGORIES },
      { id: 'care', label: '4. 各種養生（床養生マット、壁ビニールシート等）', name: '各種養生（床養生マット、壁ビニールシート等）', categoryCodes: [] },
    ];
  }
  if (modelSlug === 'flat' && specCode === 'office') {
    return [
      { id: 'equipment', label: '2. 設備機器', name: '設備機器', categoryCodes: EQUIPMENT_CATEGORIES },
      // category=carpentry は現在「内外装工事」。ここへ表示上だけ移動させない。
      { id: 'carpentry', label: '3. 造作工事', name: '造作工事', categoryCodes: ['carpentry'] },
      { id: 'care', label: '4. 各種養生（床養生マット、壁ビニールシート等）', name: '各種養生（床養生マット、壁ビニールシート等）', categoryCodes: [] },
    ];
  }
  // モデル・仕様が確定できないときは誤分類しない。
  return [];
}

export interface V25DisplayWorkGroup {
  key: string;
  label: string;
  /** 商品行→手入力行。#666の混在並び替えは対象外。 */
  slots: V25SlotRow[];
  lines: V25LineRow[];
}

type DisplayGroupIdentity = { key: string; label: string; order: number };

function itemsForSection(context: V25WorkItemContext): readonly WorkItemRule[] {
  if (context.sectionCode === 'sitework') return [];
  if (context.sectionCode === 'option') return v25OptionWorkItems(context);
  return V25_DISPLAY_WORK_ITEMS;
}

/** 大区分の内側だけ、確実なカテゴリーコードを分類する（断熱4カテゴリーは対象外）。 */
export function v25WorkItemForCategory(
  categoryCode: string | null | undefined,
  context: V25WorkItemContext = {},
): DisplayGroupIdentity | null {
  const items = itemsForSection(context);
  const index = items.findIndex((item) => item.categoryCodes.includes(categoryCode ?? ''));
  if (index < 0) return null;
  const item = items[index];
  return { key: (context.sectionCode === 'option' ? 'option:' : 'work:') + item.id, label: item.label, order: index };
}

/** 中黒・全半角・空白だけを同等視。語尾・用途を削って誤統合しない。 */
function comparableWorkName(value: string): string {
  return value.normalize('NFKC').replace(/[・･·\s]/gu, '');
}

/**
 * 自由入力の既存group_labelは正本のまま維持する。
 * 一致した工事項目だけを同一見出しへ。旧Excelの「2. 外壁」「3. 内装」は
 * 名称まで完全一致する明確な旧番号のみに限って、3/4の表示見出しへ合流する。
 * 「2. 屋根外壁工事」のように屋根・外壁の内訳が不明な名称は分割しない。
 */
export function v25WorkItemForManual(
  groupLabel: string,
  context: V25WorkItemContext = {},
): DisplayGroupIdentity {
  const label = groupLabel.trim();
  if (!label) return { key: 'manual:empty', label: '工事項目未設定（手入力）', order: 101 };
  const normalized = label.normalize('NFKC').trim();
  const numbered = normalized.match(/^([1-9])(?:[.、]\s*|\s+)(.+)$/u);
  const name = numbered ? numbered[2] : normalized;
  const items = itemsForSection(context);
  const index = items.findIndex((item) => {
    const expectedNumber = Number(item.label.match(/^\d+/u)?.[0] ?? 0);
    const nameMatches = comparableWorkName(name) === comparableWorkName(item.name)
      || (item.id === 'care' && comparableWorkName(name) === comparableWorkName('各種養生'));
    if (!nameMatches) return false;
    if (!numbered || Number(numbered[1]) === expectedNumber) return true;
    // 旧版の明確な番号差だけを許す。その他の番号差は別見出しとする。
    return context.sectionCode !== 'option' && (
      (item.id === 'exterior' && numbered[1] === '2') ||
      (item.id === 'interior' && numbered[1] === '3')
    );
  });
  if (index >= 0) {
    const item = items[index];
    return { key: (context.sectionCode === 'option' ? 'option:' : 'work:') + item.id, label: item.label, order: index };
  }
  return { key: 'manual:' + label, label, order: 100 };
}

/** 同一大区分・同一表示グループの自由入力行のみ配列中の2要素を交換。 */
export function v25MoveManualLineWithinWorkGroup(
  lines: readonly V25LineRow[],
  key: string,
  direction: -1 | 1,
  context: V25WorkItemContext = {},
): V25LineRow[] {
  const currentIndex = lines.findIndex((line) => line.key === key);
  if (currentIndex < 0) return lines as V25LineRow[];
  const current = lines[currentIndex];
  const inSection = { ...context, sectionCode: current.section_code };
  const groupKey = v25WorkItemForManual(current.group_label, inSection).key;
  const sameGroup = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      line.section_code === current.section_code &&
      v25WorkItemForManual(line.group_label, inSection).key === groupKey);
  const groupIndex = sameGroup.findIndex(({ line }) => line.key === key);
  const adjacent = sameGroup[groupIndex + direction];
  if (!adjacent) return lines as V25LineRow[];
  const updated = [...lines];
  // 保存した並び順（row_order。2026-11-16 の先方の依頼）のある行は、並び順も入れ替える（上下の移動が見積書の並びにも効くように）
  if (current.row_order != null || adjacent.line.row_order != null) {
    updated[currentIndex] = { ...adjacent.line, row_order: current.row_order };
    updated[adjacent.index] = { ...current, row_order: adjacent.line.row_order };
    return updated;
  }
  updated[currentIndex] = adjacent.line;
  updated[adjacent.index] = current;
  return updated;
}

/**
 * 工事項目のプルダウンの選択肢（その大区分・モデル・仕様の分類の項目のラベル。2026-11-16 の先方の依頼）。
 * 別途工事・モデルや仕様が確定できないオプションは空（未設定と保存済みの値だけを選べる）
 */
export function v25WorkItemLabelsForSection(context: V25WorkItemContext): string[] {
  return itemsForSection(context).map((item) => item.label);
}

/** 商品台帳から選んだ商品の工事項目の自動の値（カテゴリーから。分類できなければ ''。2026-11-16 の先方の依頼） */
export function v25AutoWorkItemLabel(categoryCode: string | null | undefined, context: V25WorkItemContext): string {
  return v25WorkItemForCategory(categoryCode, context)?.label ?? '';
}

const DISPLAY_SECTIONS: readonly V25LineRow['section_code'][] = ['interior_exterior', 'option', 'sitework'];

/**
 * 保存する並び順（2026-11-16 の先方の依頼）：画面の表示の順＝区分→工事項目の見出し→その中の商品→手入力。
 * 見積書の明細もこの順になる。区分の分からない商品（台帳に無い）は含めない（保存のときに後ろへ付く）
 */
export function v25DisplayRowRefs(
  state: { slots: readonly V25SlotRow[]; lines: readonly V25LineRow[] },
  sectionOf: (optionId: string) => V25LineRow['section_code'] | undefined,
  categoryCodeOf: (optionId: string) => string | null | undefined,
  slotWorkItemOf: (slot: V25SlotRow) => string,
  context: Omit<V25WorkItemContext, 'sectionCode'>,
): { kind: 'slot' | 'line'; key: string }[] {
  return DISPLAY_SECTIONS.flatMap((sectionCode) =>
    v25WorkGroupsForDisplay(
      state.slots.filter((slot) => sectionOf(slot.option_id) === sectionCode),
      state.lines.filter((line) => line.section_code === sectionCode),
      categoryCodeOf,
      (line) => line.group_label,
      { ...context, sectionCode },
      slotWorkItemOf,
    ).flatMap((group) => [
      ...group.slots.map((slot) => ({ kind: 'slot' as const, key: slot.key })),
      ...group.lines.map((line) => ({ kind: 'line' as const, key: line.key })),
    ])
  );
}

/** 商品と自由入力を表示上だけ束ねる。section_code / group_label / 保存順序は変更しない。 */
export function v25WorkGroupsForDisplay(
  slots: readonly V25SlotRow[],
  lines: readonly V25LineRow[],
  categoryCodeOf: (optionId: string) => string | null | undefined,
  displayGroupLabelOf: (line: V25LineRow) => string = (line) => line.group_label,
  context: V25WorkItemContext = {},
  /** 商品の行の保存した工事項目（work_item）。あれば手入力と同じく名前で分類の項目に照合し、無ければカテゴリーで分ける */
  slotWorkItemOf: (slot: V25SlotRow) => string = (slot) => slot.work_item ?? '',
): V25DisplayWorkGroup[] {
  const groups = new Map<string, V25DisplayWorkGroup & { order: number; first: number }>();
  const ensureGroup = (identity: DisplayGroupIdentity) => {
    let group = groups.get(identity.key);
    if (!group) {
      group = { ...identity, slots: [], lines: [], first: groups.size };
      groups.set(identity.key, group);
    }
    return group;
  };
  for (const slot of slots) {
    const saved = slotWorkItemOf(slot).trim();
    const item = (saved ? v25WorkItemForManual(saved, context) : null) ??
      v25WorkItemForCategory(categoryCodeOf(slot.option_id), context) ??
      { key: 'products:unclassified', label: '工事項目未分類の商品', order: 102 };
    ensureGroup(item).slots.push(slot);
  }
  for (const line of lines) {
    ensureGroup(v25WorkItemForManual(displayGroupLabelOf(line), context)).lines.push(line);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.first - b.first)
    .map(({ key, label, slots: itemSlots, lines: itemLines }) => ({ key, label, slots: itemSlots, lines: itemLines }));
}
