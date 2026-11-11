import { validateIncludedCategorySaveInput } from '@/lib/domain/included-equipment-save-validation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IncludedCategoryContractResult =
  | { ok: true; ids: string[] }
  | { ok: false; code: 'INVALID' | 'CONFLICT' | 'INCONSISTENT' };

export function sameCategoryIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/** Server-read current / allowed are authoritative. Browser-provided expected is never replaced. */
export function validateIncludedCategoryContract(input: {
  ownCategoryId: string;
  currentIds: readonly string[];
  allowedIds: readonly string[];
  expectedIds: readonly string[];
  nextIds: readonly string[];
}): IncludedCategoryContractResult {
  const { ownCategoryId, currentIds, allowedIds, expectedIds, nextIds } = input;
  if (![...expectedIds, ...nextIds, ...currentIds, ...allowedIds].every((id) => typeof id === 'string' && UUID.test(id)) ||
      new Set(expectedIds).size !== expectedIds.length ||
      new Set(currentIds).size !== currentIds.length) return { ok: false, code: 'INVALID' };
  if (currentIds.some((id) => !allowedIds.includes(id))) return { ok: false, code: 'INCONSISTENT' };
  if (!sameCategoryIdSet(currentIds, expectedIds)) return { ok: false, code: 'CONFLICT' };
  const validated = validateIncludedCategorySaveInput({
    ownCategoryId, existingIds: currentIds, editableCategoryIds: allowedIds, requestedIds: nextIds,
  });
  return validated.ok ? { ok: true, ids: validated.categoryIds } : { ok: false, code: 'INVALID' };
}

/**
 * A refreshed server snapshot must not silently overwrite unsaved selections.
 * The browser remains fail-closed while a save is in flight or its result is uncertain.
 */
export function decideIncludedCategoryRefresh(input: {
  previousServerIds: readonly string[];
  nextServerIds: readonly string[];
  savedIds: readonly string[];
  selectedIds: readonly string[];
  saving: boolean;
  reloadRequired: boolean;
}): 'unchanged' | 'synchronize' | 'reload' {
  if (sameCategoryIdSet(input.previousServerIds, input.nextServerIds)) return 'unchanged';
  if (input.saving || input.reloadRequired || !sameCategoryIdSet(input.savedIds, input.selectedIds)) return 'reload';
  return 'synchronize';
}

export function includedCategoryRpcError(error: { code?: string; message?: string }): 'CONFLICT' | 'TIMEOUT' | 'FORBIDDEN' | 'FAILED' {
  if (error.message?.startsWith('CONFLICT:')) return 'CONFLICT';
  if (error.code === '55P03' || error.message?.includes('lock timeout')) return 'TIMEOUT';
  if (error.code === '42501' || error.message?.startsWith('FORBIDDEN:')) return 'FORBIDDEN';
  return 'FAILED';
}
