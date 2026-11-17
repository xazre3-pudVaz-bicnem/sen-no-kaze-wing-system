import { canRestoreSimulatorDraft } from './simulator-draft-ownership';
import { FINISH_LEVELS, type FinishLevel } from './types';

/**
 * The original per-model key is kept read-only. Customer edits use new, unguessable
 * work IDs, so opening another plan cannot overwrite a historical browser draft.
 */
export const legacySimulatorDraftKey = (slug: string) => `wing:sim:${slug}`;
export const workSimulatorDraftKey = (slug: string, id: string) => `wing:sim:work:${slug}:${id}`;
/** Per-tab marker only; the browser drafts themselves remain in localStorage. */
export const activeSimulatorWorkSessionKey = (slug: string) => `wing:sim:active-work:${slug}`;
const workPrefix = (slug: string) => `wing:sim:work:${slug}:`;
export const validSimulatorDraftId = (id: string | null | undefined): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(id) && id.length <= 64;

export interface BrowserDraftRecord {
  selected: string[];
  ownerId?: string | null;
  configId?: string | null;
  name?: string;
  savedAt?: number;
  pending?: 'save' | 'quote' | null;
  [key: string]: unknown;
}
export interface DraftStorageReader {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
}
export type ResumeCandidate = { kind: 'legacy' | 'work'; id: string | null; savedAt: number };

/** Login changes the editor identity, so a guest work copy must not be overwritten. */
export function mayReuseActiveBrowserWork(
  openedDraftId: string | null,
  sessionDraftId: string | null,
  workOwnerId: string | null | undefined,
  viewerId: string | null
): boolean {
  return validSimulatorDraftId(openedDraftId) &&
    sessionDraftId === openedDraftId &&
    (workOwnerId ?? null) === viewerId;
}

/** Preserve the user's original scope instead of resetting every draft to its spec's default. */
export function restoredDraftFinishLevel(saved: unknown, fallback: FinishLevel): FinishLevel {
  return typeof saved === 'string' && FINISH_LEVELS.some((level) => level === saved)
    ? (saved as FinishLevel)
    : fallback;
}

/** A failure never deletes or modifies the legacy per-model draft. */
export function writeBrowserWorkDraft(
  storage: { setItem(key: string, value: string): void },
  slug: string,
  id: string,
  snapshot: { selected: string[] }
): boolean {
  if (!validSimulatorDraftId(id)) return false;
  try {
    storage.setItem(workSimulatorDraftKey(slug, id), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}


export function readBrowserDraft(storage: Pick<DraftStorageReader, 'getItem'>, key: string): BrowserDraftRecord | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return null;
    const record = draft as BrowserDraftRecord;
    if (!Array.isArray(record.selected) || !record.selected.every((id) => typeof id === 'string')) return null;
    if (record.ownerId != null && typeof record.ownerId !== 'string') return null;
    if (record.configId != null && typeof record.configId !== 'string') return null;
    if (record.variantIds != null && (!Array.isArray(record.variantIds) || !record.variantIds.every((id) => typeof id === 'string'))) return null;
    if (record.exteriorFaces != null && (!Array.isArray(record.exteriorFaces) ||
      !record.exteriorFaces.every((face) => face && typeof face === 'object' &&
        typeof face.face_code === 'string' && typeof face.option_id === 'string' &&
        (face.variant_choice_ids == null || (Array.isArray(face.variant_choice_ids) &&
          face.variant_choice_ids.every((id: unknown) => typeof id === 'string')))))) return null;
    if (record.slotSelections != null && !Array.isArray(record.slotSelections)) return null;
    if (record.spec != null && typeof record.spec !== 'string') return null;
    if (record.name != null && typeof record.name !== 'string') return null;
    if (record.sitePrefecture != null && typeof record.sitePrefecture !== 'string') return null;
    if (record.siteMunicipality != null && typeof record.siteMunicipality !== 'string') return null;
    if (record.siteLocationUndecided != null && typeof record.siteLocationUndecided !== 'boolean') return null;
    if (record.pending != null && record.pending !== 'save' && record.pending !== 'quote') return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Discovery does not show anonymous drafts to a different signed-in account.
 * A guest may explicitly carry a draft through login using its URL ID, but
 * scanning a shared browser cannot silently grant another account a draft.
 */
export function latestResumableBrowserDraft(
  storage: DraftStorageReader,
  slug: string,
  viewerId: string | null
): ResumeCandidate | null {
  try {
    const keys: Array<{ key: string; kind: 'legacy' | 'work'; id: string | null }> = [
      { key: legacySimulatorDraftKey(slug), kind: 'legacy', id: null },
    ];
    const prefix = workPrefix(slug);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (validSimulatorDraftId(id)) keys.push({ key, kind: 'work', id });
    }
    const candidates = keys.flatMap(({ key, kind, id }) => {
      const draft = readBrowserDraft(storage, key);
      if (!draft || draft.configId || !canRestoreSimulatorDraft(draft, viewerId)) return [];
      if ((draft.ownerId ?? null) !== viewerId) return [];
      return [{ kind, id, savedAt: typeof draft.savedAt === 'number' && Number.isFinite(draft.savedAt) ? draft.savedAt : 0 }];
    });
    candidates.sort((a, b) => b.savedAt - a.savedAt);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}
