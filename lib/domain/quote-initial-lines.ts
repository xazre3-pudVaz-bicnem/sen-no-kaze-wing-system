import type { QuoteInitialLine } from './types';

/**
 * Web のお客様の見積（第 1 版）を初めて編集するときに、「別途工事」へ足す初期明細（2026-11-04 先方回答 A-3）。
 * 第 2 版以降の編集では足さない（前の版で代理店が要らない行を外したあとに、また並べないため）。
 * 前の版に同じ名前の行がある工事も足さない（9 品目を商品として選んでいた頃の見積と重ならないように）
 */
export function initialSiteworkLinesToAdd(
  revision: number,
  existingNames: readonly string[],
  lines: readonly QuoteInitialLine[]
): QuoteInitialLine[] {
  if (revision !== 1) return [];
  const existing = new Set(existingNames.map((name) => name.trim()));
  return lines
    .filter((line) => line.section_code === 'sitework' && !existing.has(line.name.trim()))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'));
}
