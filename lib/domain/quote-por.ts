/**
 * 正式見積で未解決の別途見積（POR）を残さない（D1 までの暫定。2026-10-19 の先方回答 ③）。
 *
 * DB の quote_line_is_unresolved_por・configuration_por_selections（20261016111000）と同じ決まり。
 * 発行を止めるのは DB で、画面はこの関数で先に案内する。ローカル検証モードはこの関数で同じ止めをする。
 */
import { EXTERIOR_FACES, type ExteriorFaceSelection } from './exterior-wall';

/** POR の目印になる備考（手入力・改訂の画面は「別途見積」、標準見積からの概算は「価格未確定（別途お見積り）」） */
export const POR_REMARKS = ['別途見積', '価格未確定（別途お見積り）'] as const;
/** 外壁の面の明細で、別途見積の項目を含むときの備考の書き出し */
export const POR_FACE_REMARK_PREFIX = '別途見積項目あり';
/** Web の概算で POR の商品に付く説明 */
export const POR_DESCRIPTION = '設置場所確認後に別途お見積り';

/** SQL の btrim と同じく、前後の半角スペースだけを取り除く */
function btrim(value: string | null | undefined): string {
  return (value ?? '').replace(/^ +| +$/g, '');
}

export interface PorLineInput {
  unit_price: number | null | undefined;
  description?: string | null;
  remark?: string | null;
  /** 商品台帳の別途見積（price_on_request）の商品を指す行か */
  optionIsPor?: boolean;
}

/**
 * 未解決の POR の行か。0 円で、備考が POR の目印、または備考が空で説明が「設置場所確認後に別途お見積り」か POR の商品を指す行。
 * 解消のしかた：売価を入れる／0 円のままにするなら備考に理由（ほかの明細に含む など）を書く／明細から外す。
 */
export function isUnresolvedPorLine(line: PorLineInput): boolean {
  if ((line.unit_price ?? 0) !== 0) return false;
  const remark = btrim(line.remark);
  if ((POR_REMARKS as readonly string[]).includes(remark)) return true;
  if (remark.startsWith(POR_FACE_REMARK_PREFIX)) return true;
  if (remark !== '') return false;
  return btrim(line.description) === POR_DESCRIPTION || Boolean(line.optionIsPor);
}

/** お客様が選んだ別途見積の商品・選択肢・外壁の面（DB の configuration_por_selections の 1 行） */
export interface QuotePorSelection {
  key: string;
  option_id: string;
  name: string;
  detail: string | null;
}

export interface QuotePorSelectionState {
  selections: QuotePorSelection[];
  /** 自分（発行する担当者）の確認が、いまの一覧を覆っているか */
  confirmed: boolean;
  /** DB に確認の仕組みがあるか（migration の適用前は false。画面は確認欄を出さない） */
  available: boolean;
}

export const EMPTY_POR_SELECTION_STATE: QuotePorSelectionState = { selections: [], confirmed: false, available: false };

export function porSelectionLabel(selection: QuotePorSelection): string {
  return selection.detail ? `${selection.name}（${selection.detail}）` : selection.name;
}

export const UNRESOLVED_POR_LINES_MESSAGE =
  '売価を入力するか、0 円のままにする場合は備考に理由（ほかの明細に含む など）を書くか、明細から外してから発行してください';

/** DB と同じ文面（ローカル検証モードの止めに使う） */
export function unresolvedPorLinesError(names: string[], action: '発行' | '正式保存' = '発行'): string {
  const message = UNRESOLVED_POR_LINES_MESSAGE.replace('発行してください', `${action}してください`);
  return `別途見積（価格未確定）の明細が ${names.length} 行残っています（${names.join('、').slice(0, 200)}）。${message}`;
}

export function unconfirmedPorSelectionsError(selections: QuotePorSelection[]): string {
  const names = selections.map(porSelectionLabel).join('、').slice(0, 200);
  return `お客様が選んだ別途見積の商品（${selections.length} 件：${names}）について、金額を明細に入れたか、お客様と合意のうえ対象外にしたことの確認が済んでいません。画面の「別途見積の確認」で確認してから発行してください`;
}

export interface PorSelectionCatalog {
  options: { id: string; name: string; category_id: string; price_on_request: boolean; sort_order: number }[];
  categories: { id: string; code: string; sort_order: number }[];
  variantGroups: { id: string; option_id: string; name: string; sort_order: number }[];
  variantChoices: { id: string; group_id: string; name: string; price_on_request: boolean; sort_order: number }[];
}

/** configuration_por_selections の TypeScript 版（ローカル検証モード用。並び順も DB と同じ） */
export function configurationPorSelections(
  input: {
    items: { option_id: string; variant_choice_ids?: string[] | null }[];
    exteriorFaces?: ExteriorFaceSelection[] | null;
  },
  catalog: PorSelectionCatalog
): QuotePorSelection[] {
  const optionById = new Map(catalog.options.map((option) => [option.id, option]));
  const categoryById = new Map(catalog.categories.map((category) => [category.id, category]));
  const groupById = new Map(catalog.variantGroups.map((group) => [group.id, group]));
  const choiceById = new Map(catalog.variantChoices.map((choice) => [choice.id, choice]));
  const faces = input.exteriorFaces ?? [];
  const hasFaces = faces.length === 4;

  type Row = QuotePorSelection & { sort: number[] };
  const rows: Row[] = [];

  for (const item of input.items) {
    const option = optionById.get(item.option_id);
    const category = option ? categoryById.get(option.category_id) : undefined;
    if (!option || !category) continue;
    // 外壁を面ごとに選んだ構成では、外壁の商品は面の選択として数える
    if (hasFaces && category.code === 'exterior-wall') continue;
    if (option.price_on_request) {
      rows.push({ key: `product:${option.id}`, option_id: option.id, name: option.name, detail: null, sort: [0, category.sort_order, option.sort_order, 0] });
    }
    for (const choiceId of item.variant_choice_ids ?? []) {
      const choice = choiceById.get(choiceId);
      const group = choice ? groupById.get(choice.group_id) : undefined;
      if (!choice || !group || !choice.price_on_request || group.option_id !== option.id) continue;
      rows.push({
        key: `variant:${option.id}:${choice.id}`,
        option_id: option.id,
        name: option.name,
        detail: `${group.name}：${choice.name}`,
        sort: [0, category.sort_order, option.sort_order, 1 + group.sort_order * 10000 + choice.sort_order],
      });
    }
  }

  if (hasFaces) {
    faces.forEach((face, index) => {
      const option = optionById.get(face.option_id);
      if (!option) return;
      const porChoices = (face.variant_choice_ids ?? [])
        .map((id) => choiceById.get(id))
        .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice?.price_on_request))
        .map((choice) => ({ choice, group: groupById.get(choice.group_id) }))
        .filter((row): row is { choice: typeof row.choice; group: NonNullable<typeof row.group> } => row.group?.option_id === option.id)
        .sort((a, b) => a.group.sort_order - b.group.sort_order || a.choice.sort_order - b.choice.sort_order);
      if (!option.price_on_request && porChoices.length === 0) return;
      const label = EXTERIOR_FACES.find((row) => row.code === face.face_code)?.label ?? face.face_code;
      const labels = porChoices.map(({ group, choice }) => `${group.name}：${choice.name}`).join('／');
      rows.push({
        key: `face:${face.face_code}:${option.id}`,
        option_id: option.id,
        name: option.name,
        detail: `外壁（${label}）${labels ? `：${labels}` : ''}`,
        sort: [1, 0, index + 1, 0],
      });
    });
  }

  rows.sort((a, b) => {
    for (let i = 0; i < a.sort.length; i += 1) {
      if (a.sort[i] !== b.sort[i]) return a.sort[i] - b.sort[i];
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return rows.map((row) => ({ key: row.key, option_id: row.option_id, name: row.name, detail: row.detail }));
}

/** 画面に出した一覧と、いまの一覧が同じか（順番は問わない。DB の確認の RPC と同じ比べ方） */
export function samePorSelectionKeys(given: readonly string[], current: readonly QuotePorSelection[]): boolean {
  const a = [...new Set(given)].sort();
  const b = [...new Set(current.map((selection) => selection.key))].sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
