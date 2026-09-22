import type { ProductOption } from './types';

export type LedgerQuickFilter = 'all' | 'draft' | 'needs-attention';

export function needsProductAttention(option: ProductOption): boolean {
  return option.status === 'draft' || !option.model_no?.trim() || !option.image_url;
}

export function optionMatchesLedgerFilters(option: ProductOption, filters: { query: string; categoryId: string; status: string; quick: LedgerQuickFilter }): boolean {
  if (filters.categoryId && option.category_id !== filters.categoryId) return false;
  if (filters.status && option.status !== filters.status) return false;
  if (filters.quick === 'draft' && option.status !== 'draft') return false;
  if (filters.quick === 'needs-attention' && !needsProductAttention(option)) return false;
  const query = filters.query.trim().toLocaleLowerCase('ja-JP');
  return !query || [option.name, option.manufacturer ?? '', option.model_no ?? '', option.code].join(' ').toLocaleLowerCase('ja-JP').includes(query);
}

export function selectedOptionAfterFilter(selectedId: string | null, visibleIds: readonly string[]): string | null {
  return selectedId && visibleIds.includes(selectedId) ? selectedId : null;
}
