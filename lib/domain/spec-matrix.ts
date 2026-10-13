import type { MatrixRow, SpecMatrix } from './types';

/** 本体仕様マトリクスの行を決める識別子（機種 × 仕様 × サイズ） */
export interface MatrixIdentity {
  base_model_id: string;
  spec_code: string;
  size_code: string;
}

/**
 * 機種・仕様・サイズが一致し、行・仕様・サイズのいずれも retired ではない行。
 * 見つからなければ null（呼び出し側は選択不可として扱う＝fail closed）。
 */
export function findMatrixRow(matrix: SpecMatrix, identity: MatrixIdentity): MatrixRow | null {
  const row = matrix.rows.find(
    (candidate) =>
      candidate.base_model_id === identity.base_model_id &&
      candidate.spec_code === identity.spec_code &&
      candidate.size_code === identity.size_code
  );
  if (!row || row.status !== 'active') return null;
  const spec = matrix.specs.find((candidate) => candidate.code === row.spec_code);
  const size = matrix.sizes.find((candidate) => candidate.code === row.size_code);
  if (spec?.status !== 'active' || size?.status !== 'active') return null;
  return row;
}

/**
 * その項目を選択できるか。
 * 行が無い・項目が無い／retired・セルが無い場合は、すべて選択できない（fail closed）。
 */
export function isMatrixItemSelectable(matrix: SpecMatrix, identity: MatrixIdentity, itemCode: string): boolean {
  const row = findMatrixRow(matrix, identity);
  if (!row) return false;
  const item = matrix.items.find((candidate) => candidate.code === itemCode);
  if (item?.status !== 'active') return false;
  const cell = matrix.cells.find((candidate) => candidate.matrix_row_id === row.id && candidate.matrix_item_code === itemCode);
  return cell?.selectable === true;
}

/** 防火の本体を選べるか（行が無ければ選べない） */
export function isFireSelectable(matrix: SpecMatrix, identity: MatrixIdentity): boolean {
  return findMatrixRow(matrix, identity)?.fire_selectable === true;
}
