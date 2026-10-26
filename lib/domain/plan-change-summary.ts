import type { CatalogBundle } from './types';
import type { ExteriorFaceSelection } from './exterior-wall';
import { makeDefaultExteriorFaces } from './exterior-wall';

type Catalog = Pick<CatalogBundle, 'options' | 'categories' | 'variantGroups' | 'variantChoices'>;

export interface PlanSelections {
  optionIds: string[];
  variantChoiceIds: string[];
  /** 保存時に外壁4面が設定済みなら渡す。旧形式の空配列は従来の単一外壁として扱う。 */
  exteriorFaces?: ExteriorFaceSelection[];
}

export interface PlanChange {
  category: string;
  kind: '商品変更' | '追加' | '取り外し' | '選択肢変更' | '外壁4面変更';
  detail: string | null;
}

export interface PlanChangeSummary {
  items: PlanChange[];
  /** 現在のカタログに保存済みの商品や選択肢がないときは、標準のままと断定しない。 */
  complete: boolean;
}

function sameSet(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((x) => b.has(x));
}

function faceChanged(left: ExteriorFaceSelection[], right: ExteriorFaceSelection[]) {
  if (left.length !== 4 || right.length !== 4) return false;
  return left.some((face) => {
    const corresponding = right.find((x) => x.face_code === face.face_code);
    return !corresponding || face.option_id !== corresponding.option_id ||
      !sameSet(face.variant_choice_ids, corresponding.variant_choice_ids);
  });
}

/**
 * 表示専用: 「現在」の標準選択（シミュレーターと同じ baseline）との差分。
 * 保存時の標準Revisionや金額の証跡として使わない。
 * 変更数は明細行数ではなく商品カテゴリー数として数える。
 */
export function summarizePlanChanges(
  catalog: Catalog,
  current: PlanSelections,
  baseline: PlanSelections
): PlanChangeSummary {
  const knownOptions = new Map(catalog.options.map((o) => [o.id, o]));
  const choices = new Map(catalog.variantChoices.map((c) => [c.id, c]));
  const allIds = [...current.optionIds, ...baseline.optionIds];
  const allChoices = [
    ...current.variantChoiceIds, ...baseline.variantChoiceIds,
    ...(current.exteriorFaces ?? []).flatMap((f) => f.variant_choice_ids),
  ];
  const complete = [
    ...allIds,
    ...(current.exteriorFaces ?? []).map((face) => face.option_id),
  ].every((id) => knownOptions.has(id)) &&
    allChoices.every((id) => choices.has(id));
  // カタログ外の商品を「削除した商品」と誤表示しない。比較不能なら項目数も表示しない。
  if (!complete) return { items: [], complete: false };
  const selectedByCategory = (ids: string[], categoryId: string) =>
    ids.filter((id) => knownOptions.get(id)?.category_id === categoryId);
  const sortedCategories = [...catalog.categories].sort(
    (a, b) => a.group_sort - b.group_sort || a.sort_order - b.sort_order
  );
  const changes: PlanChange[] = [];

  for (const category of sortedCategories) {
    const selected = selectedByCategory(current.optionIds, category.id);
    const standard = selectedByCategory(baseline.optionIds, category.id);
    if (!sameSet(selected, standard)) {
      changes.push({
        category: category.name,
        kind: standard.length === 0 ? '追加' : selected.length === 0 ? '取り外し' : '商品変更',
        detail: null,
      });
      continue;
    }
    const groupsForCategory = catalog.variantGroups.filter((g) =>
      selected.includes(g.option_id)
    );
    const differentGroups = groupsForCategory.filter((g) => {
      const mine = current.variantChoiceIds.filter((id) => choices.get(id)?.group_id === g.id);
      const standardChoices = baseline.variantChoiceIds.filter((id) => choices.get(id)?.group_id === g.id);
      return !sameSet(mine, standardChoices);
    });
    if (differentGroups.length) {
      changes.push({
        category: category.name,
        kind: '選択肢変更',
        detail: differentGroups.map((g) => g.name).join('・'),
      });
    }
  }

  const exteriorCategory = catalog.categories.find((c) => c.code === 'exterior-wall');
  if (exteriorCategory) {
    const wallOptions = catalog.options.filter((o) => o.category_id === exteriorCategory.id);
    const defaultFaces = makeDefaultExteriorFaces(
      wallOptions, catalog.variantGroups, catalog.variantChoices,
      baseline.optionIds, baseline.variantChoiceIds
    );
    // 旧形式 [] は外壁1商品方式。4面を持つ場合だけ4面の追加差分を判定する。
    const currentFaces = current.exteriorFaces ?? [];
    if (faceChanged(currentFaces, defaultFaces) &&
      !changes.some((x) => x.category === exteriorCategory.name)) {
      changes.push({ category: exteriorCategory.name, kind: '外壁4面変更', detail: null });
    }
  }
  // 不明な商品・選択肢がある場合は、差分が0件でも「標準仕様のまま」と断定しない。
  return { items: changes, complete };
}
