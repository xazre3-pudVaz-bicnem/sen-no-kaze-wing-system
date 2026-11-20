type MatrixSnapshot = {
  id: string;
  lock_version: number;
  fire_selectable: boolean;
  selectable_items: string[];
};

export type MatrixSettingsDraft = {
  fire: boolean;
  items: string[];
  /** 保存時の楽観ロック。復元した後でも取得し直した新しい版にすり替えない。 */
  lockVersion: number;
};

export type MatrixSettingsDraftCache = {
  selectedId: string;
  drafts: Record<string, MatrixSettingsDraft>;
};

type StoredDrafts = MatrixSettingsDraftCache & { version: 1 };

function sameItems(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().every((item, index) => item === [...b].sort()[index]);
}

/** JSONの破損・他画面の行・既に保存済みの変更は復元しない。古い版の未保存変更は保持する。 */
export function restoreMatrixSettingsDrafts(raw: string | null, rows: MatrixSnapshot[]): MatrixSettingsDraftCache {
  const empty: MatrixSettingsDraftCache = { selectedId: '', drafts: {} };
  if (!raw) return empty;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
      !('drafts' in value) || !value.drafts || typeof value.drafts !== 'object') return empty;
    const cached = value as StoredDrafts;
    const drafts: Record<string, MatrixSettingsDraft> = {};

    for (const row of rows) {
      const draft = cached.drafts[row.id];
      if (!draft || typeof draft.fire !== 'boolean' || !Array.isArray(draft.items) ||
        !draft.items.every((item) => typeof item === 'string') ||
        !Number.isInteger(draft.lockVersion) || draft.lockVersion < 1) continue;

      if (draft.fire !== row.fire_selectable || !sameItems(draft.items, row.selectable_items) ||
        draft.lockVersion !== row.lock_version) {
        drafts[row.id] = {
          fire: draft.fire,
          items: [...draft.items],
          lockVersion: draft.lockVersion,
        };
      }
    }

    return {
      selectedId: typeof cached.selectedId === 'string' && rows.some((row) => row.id === cached.selectedId)
        ? cached.selectedId : '',
      drafts,
    };
  } catch {
    return empty;
  }
}

export function serializeMatrixSettingsDrafts(cache: MatrixSettingsDraftCache): string {
  return JSON.stringify({ version: 1, selectedId: cache.selectedId, drafts: cache.drafts } satisfies StoredDrafts);
}
