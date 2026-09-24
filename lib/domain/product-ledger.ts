import type { ProductOption } from './types';

export type LedgerQuickFilter = 'all' | 'draft' | 'needs-attention';

export function productAttentionReasons(option: ProductOption): string[] {
  const reasons: string[] = [];
  if (option.status === 'draft') reasons.push('下書き');
  if (!option.model_no?.trim()) reasons.push('型番未設定');
  if (!option.image_url) reasons.push('画像未登録');
  return reasons;
}

export function needsProductAttention(option: ProductOption): boolean {
  return productAttentionReasons(option).length > 0;
}

export function optionMatchesLedgerFilters(option: ProductOption, filters: { query: string; categoryId: string; status: string; quick: LedgerQuickFilter }): boolean {
  if (filters.categoryId && option.category_id !== filters.categoryId) return false;
  if (filters.status && option.status !== filters.status) return false;
  if (filters.quick === 'draft' && option.status !== 'draft') return false;
  if (filters.quick === 'needs-attention' && !needsProductAttention(option)) return false;
  const query = filters.query.trim().toLocaleLowerCase('ja-JP');
  return !query || [option.name, option.product_no ?? '', option.manufacturer ?? '', option.model_no ?? '', option.code].join(' ').toLocaleLowerCase('ja-JP').includes(query);
}

export function selectedOptionAfterFilter(selectedId: string | null, visibleIds: readonly string[]): string | null {
  return selectedId && visibleIds.includes(selectedId) ? selectedId : null;
}


export type ProductDuplicateReason = 'manufacturer-model' | 'category-manufacturer-name';

export interface ProductDuplicateCandidate {
  option: ProductOption;
  reason: ProductDuplicateReason;
}

function normalizeIdentityPart(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ja-JP');
}

export function findProductDuplicateCandidates(
  options: readonly ProductOption[],
  input: {
    categoryId: string;
    manufacturer: string;
    name: string;
    modelNo: string;
    excludeId?: string | null;
  }
): ProductDuplicateCandidate[] {
  const categoryId = input.categoryId.trim();
  const manufacturer = normalizeIdentityPart(input.manufacturer);
  const name = normalizeIdentityPart(input.name);
  const modelNo = normalizeIdentityPart(input.modelNo);

  if (!manufacturer && !modelNo && !name) return [];

  const candidates: ProductDuplicateCandidate[] = [];

  for (const option of options) {
    if (input.excludeId && option.id === input.excludeId) continue;

    const optionManufacturer = normalizeIdentityPart(option.manufacturer);
    const optionName = normalizeIdentityPart(option.name);
    const optionModelNo = normalizeIdentityPart(option.model_no);

    if (manufacturer && modelNo && optionManufacturer === manufacturer && optionModelNo === modelNo) {
      candidates.push({ option, reason: 'manufacturer-model' });
      continue;
    }

    if (
      categoryId &&
      manufacturer &&
      name &&
      option.category_id === categoryId &&
      optionManufacturer === manufacturer &&
      optionName === name
    ) {
      candidates.push({ option, reason: 'category-manufacturer-name' });
    }
  }

  return candidates.sort((a, b) => {
    const rank = (reason: ProductDuplicateReason) => (reason === 'manufacturer-model' ? 0 : 1);
    return rank(a.reason) - rank(b.reason) || a.option.name.localeCompare(b.option.name, 'ja');
  });
}
