import type { ProductOption } from './types';

export type LedgerQuickFilter = 'all' | 'draft' | 'needs-attention';

export function productAttentionReasons(option: ProductOption): string[] {
  // 商品台帳の「要確認」は、公開中なのにお客様表示の基本素材が欠けている商品だけを対象にする。
  // 下書きは通常の作業状態で、型番は工事・造作等では存在しない場合があるため警告理由にしない。
  if (option.status !== 'published') return [];
  return option.image_url ? [] : ['画像未登録'];
}

export function needsProductAttention(option: ProductOption): boolean {
  return productAttentionReasons(option).length > 0;
}

export function optionMatchesLedgerFilters(
  option: ProductOption,
  filters: {
    query: string;
    categoryId: string;
    status: string;
    quick: LedgerQuickFilter;
    manufacturer?: string;
    baseModelId?: string;
  }
): boolean {
  if (filters.categoryId && option.category_id !== filters.categoryId) return false;
  if (filters.status && option.status !== filters.status) return false;
  if (filters.manufacturer && (option.manufacturer?.trim() ?? '') !== filters.manufacturer) return false;
  if (filters.baseModelId === '__shared__' && option.base_model_id !== null) return false;
  if (filters.baseModelId && filters.baseModelId !== '__shared__' && option.base_model_id !== filters.baseModelId) return false;
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
