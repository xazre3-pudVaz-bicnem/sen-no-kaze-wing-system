import type { CatalogBundle, OptionVariantChoice, OptionVariantGroup, ProductOption } from './types';

export type ExteriorFaceCode = 'front' | 'right' | 'back' | 'left';

export interface ExteriorFaceSelection {
  face_code: ExteriorFaceCode;
  option_id: string;
  variant_choice_ids: string[];
}

export const EXTERIOR_FACES: { code: ExteriorFaceCode; label: string }[] = [
  { code: 'front', label: '正面' },
  { code: 'right', label: '右側面' },
  { code: 'back', label: '背面' },
  { code: 'left', label: '左側面' },
];

export function exteriorFaceForElevation(label: string, index: number): ExteriorFaceCode {
  if (/正面|南/.test(label)) return 'front';
  if (/右|東/.test(label)) return 'right';
  if (/背面|北/.test(label)) return 'back';
  if (/左|西/.test(label)) return 'left';
  return EXTERIOR_FACES[index % EXTERIOR_FACES.length].code;
}

export function exteriorFaceLabel(code: ExteriorFaceCode): string {
  return EXTERIOR_FACES.find((f) => f.code === code)?.label ?? code;
}

export function defaultVariantIdsForExteriorOption(
  optionId: string,
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  current: string[] = []
): string[] {
  const out: string[] = [];
  for (const group of groups.filter((g) => g.option_id === optionId).sort((a, b) => a.sort_order - b.sort_order)) {
    const list = choices.filter((c) => c.group_id === group.id).sort((a, b) => a.sort_order - b.sort_order);
    if (!list.length) continue;
    const already = list.find((c) => current.includes(c.id));
    out.push((already ?? list.find((c) => c.kind === 'standard' || c.kind === 'fixed') ?? list[0]).id);
  }
  return out;
}

export function makeDefaultExteriorFaces(
  options: ProductOption[],
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  selectedOptionIds: string[],
  selectedVariantIds: string[]
): ExteriorFaceSelection[] {
  const option = options.find((o) => selectedOptionIds.includes(o.id)) ?? options[0];
  if (!option) return [];
  const variants = defaultVariantIdsForExteriorOption(option.id, groups, choices, selectedVariantIds);
  return EXTERIOR_FACES.map((face) => ({ face_code: face.code, option_id: option.id, variant_choice_ids: [...variants] }));
}

export function normalizeExteriorFaces(
  input: ExteriorFaceSelection[] | null | undefined,
  options: ProductOption[],
  groups: OptionVariantGroup[],
  choices: OptionVariantChoice[],
  selectedOptionIds: string[],
  selectedVariantIds: string[]
): ExteriorFaceSelection[] {
  const validOptionIds = new Set(options.map((o) => o.id));
  const byFace = new Map<ExteriorFaceCode, ExteriorFaceSelection>();
  for (const row of input ?? []) {
    if (!EXTERIOR_FACES.some((f) => f.code === row.face_code) || !validOptionIds.has(row.option_id)) continue;
    const validGroups = new Set(groups.filter((g) => g.option_id === row.option_id).map((g) => g.id));
    const validChoices = row.variant_choice_ids.filter((id) => {
      const choice = choices.find((c) => c.id === id);
      return Boolean(choice && validGroups.has(choice.group_id));
    });
    byFace.set(row.face_code, {
      face_code: row.face_code,
      option_id: row.option_id,
      variant_choice_ids: defaultVariantIdsForExteriorOption(row.option_id, groups, choices, validChoices),
    });
  }
  if (byFace.size === EXTERIOR_FACES.length) return EXTERIOR_FACES.map((f) => byFace.get(f.code)!);
  return makeDefaultExteriorFaces(options, groups, choices, selectedOptionIds, selectedVariantIds);
}

export function validateExteriorFaces(bundle: CatalogBundle, faces: ExteriorFaceSelection[]): string | null {
  if (!faces.length) return null;
  if (faces.length !== EXTERIOR_FACES.length || new Set(faces.map((f) => f.face_code)).size !== EXTERIOR_FACES.length) {
    return '外壁は正面・右側面・背面・左側面の4面を指定してください。';
  }
  const wallCategory = bundle.categories.find((c) => c.code === 'exterior-wall');
  if (!wallCategory) return '外壁カテゴリーが見つかりません。';
  for (const face of faces) {
    const option = bundle.options.find((o) => o.id === face.option_id && o.category_id === wallCategory.id && o.status === 'published');
    if (!option) return `${exteriorFaceLabel(face.face_code)}の外壁商品が正しくありません。`;
    const groupIds = new Set(bundle.variantGroups.filter((g) => g.option_id === option.id).map((g) => g.id));
    const seenGroups = new Set<string>();
    for (const id of face.variant_choice_ids) {
      const choice = bundle.variantChoices.find((c) => c.id === id);
      if (!choice || !groupIds.has(choice.group_id)) return `${exteriorFaceLabel(face.face_code)}の外壁仕様が正しくありません。`;
      if (seenGroups.has(choice.group_id)) return `${exteriorFaceLabel(face.face_code)}の同じ選択項目が重複しています。`;
      seenGroups.add(choice.group_id);
    }
  }
  return null;
}
