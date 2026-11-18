'use client';

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';

/**
 * UI preferences only: never include these values in a Revision payload.
 * Keys are stable even when other PRs insert new columns before the product column.
 */
export const V25_GRID_COLUMNS = [
  { id: 'name', label: '品名', width: 320, min: 180, locked: true },
  { id: 'quantity', label: '数量', width: 56, min: 48, locked: true },
  { id: 'unit', label: '単位', width: 56, min: 48, locked: true },
  { id: 'cost_unit', label: '原価単価', width: 92, min: 72, locked: false },
  { id: 'cost_amount', label: '原価金額', width: 92, min: 72, locked: false },
  { id: 'sale_unit', label: '売価単価', width: 92, min: 72, locked: false },
  { id: 'sale_amount', label: '売価金額', width: 92, min: 80, locked: true },
  { id: 'gross', label: '粗利', width: 92, min: 72, locked: false },
  { id: 'note', label: '仕様・備考', width: 128, min: 80, locked: false },
  { id: 'actions', label: '操作', width: 72, min: 64, locked: true },
] as const;

export type V25GridColumnId = (typeof V25_GRID_COLUMNS)[number]['id'];
export type V25GridPrefs = {
  visible: Record<V25GridColumnId, boolean>;
  widths: Record<V25GridColumnId, number>;
};
export const V25_GRID_STORAGE_KEY = 'wing:v25:estimate-grid-display:v1';

export function v25DefaultGridPrefs(): V25GridPrefs {
  return {
    visible: Object.fromEntries(V25_GRID_COLUMNS.map((col) => [col.id, true])) as V25GridPrefs['visible'],
    widths: Object.fromEntries(V25_GRID_COLUMNS.map((col) => [col.id, col.width])) as V25GridPrefs['widths'],
  };
}

/** Discard unknown keys, invalid persisted widths and attempts to hide mandatory columns. */
export function v25SanitizeGridPrefs(value: unknown): V25GridPrefs {
  const defaults = v25DefaultGridPrefs();
  if (value === null || typeof value !== 'object') return defaults;
  const input = value as { visible?: Record<string, unknown>; widths?: Record<string, unknown> };
  for (const col of V25_GRID_COLUMNS) {
    if (!col.locked && typeof input.visible?.[col.id] === 'boolean') {
      defaults.visible[col.id] = input.visible[col.id] as boolean;
    }
    const width = input.widths?.[col.id];
    if (typeof width === 'number' && Number.isFinite(width)) {
      defaults.widths[col.id] = Math.min(640, Math.max(col.min, Math.round(width)));
    }
  }
  return defaults;
}

export function v25GridVisible(prefs: V25GridPrefs, id: V25GridColumnId): boolean {
  return prefs.visible[id];
}

export function v25GridWidth(prefs: V25GridPrefs): number {
  return V25_GRID_COLUMNS.reduce((sum, col) => sum + (prefs.visible[col.id] ? prefs.widths[col.id] : 0), 0);
}

/** Keyed to column identity, not nth-child, to survive extra columns from other PRs. */
export function useV25GridPreferences() {
  const [prefs, setPrefs] = useState<V25GridPrefs>(v25DefaultGridPrefs);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    // Hydration must finish before restoring local preferences. Schedule outside
    // the synchronous effect body (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = window.localStorage.getItem(V25_GRID_STORAGE_KEY);
        if (raw) setPrefs(v25SanitizeGridPrefs(JSON.parse(raw)));
      } catch {
        // Private browsing / disabled storage: continue with session-only UI settings.
      }
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!hydrated) return; // Do not overwrite saved settings with SSR defaults.
    try {
      window.localStorage.setItem(V25_GRID_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage errors must not block editing or saving the estimate.
    }
  }, [hydrated, prefs]);

  const setVisible = (id: V25GridColumnId, checked: boolean) => {
    const col = V25_GRID_COLUMNS.find((item) => item.id === id);
    if (!col || col.locked) return;
    setPrefs((current) => ({ ...current, visible: { ...current.visible, [id]: checked } }));
  };
  const setCostVisible = (checked: boolean) => {
    setPrefs((current) => ({ ...current, visible: { ...current.visible, cost_unit: checked, cost_amount: checked, gross: checked } }));
  };
  const setWidth = (id: V25GridColumnId, desiredWidth: number) => {
    const col = V25_GRID_COLUMNS.find((item) => item.id === id);
    if (!col || !Number.isFinite(desiredWidth)) return;
    const width = Math.min(640, Math.max(col.min, Math.round(desiredWidth)));
    setPrefs((current) => current.widths[id] === width ? current : ({
      ...current, widths: { ...current.widths, [id]: width },
    }));
  };
  const startResize = (event: ReactMouseEvent<HTMLElement>, id: V25GridColumnId) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = prefs.widths[id];
    const move = (next: MouseEvent) => { setWidth(id, startWidth + next.clientX - startX); };
    const finish = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
  };
  return {
    prefs,
    setVisible,
    setCostVisible,
    setWidth,
    startResize,
    showAll: () => setPrefs((current) => ({ ...current, visible: v25DefaultGridPrefs().visible })),
    reset: () => setPrefs(v25DefaultGridPrefs()),
  };
}

/**
 * Leave the column heading readable; mouse drag changes width, double-click
 * measures populated cells. The handle is also keyboard-operable.
 */
export function V25WidthHandle({
  id, width, onResizeStart, onWidth, onAutoWidth,
}: {
  id: V25GridColumnId;
  width: number;
  onResizeStart: (event: ReactMouseEvent<HTMLElement>, id: V25GridColumnId) => void;
  onWidth: (id: V25GridColumnId, width: number) => void;
  onAutoWidth: (id: V25GridColumnId) => void;
}) {
  return (
    <span
      role="separator" aria-orientation="vertical" aria-label={`${V25_GRID_COLUMNS.find((c) => c.id === id)?.label ?? id}の列幅を変更`}
      aria-valuenow={width} aria-valuemin={V25_GRID_COLUMNS.find((c) => c.id === id)?.min ?? 48} aria-valuemax={640}
      tabIndex={0} title="左右にドラッグして幅変更／ダブルクリックで自動調整"
      data-testid={`v25-grid-resize-${id}`}
      className="absolute inset-y-0 right-0 z-10 w-[7px] cursor-col-resize touch-none border-r border-transparent hover:border-blue-500 focus-visible:border-blue-600 focus-visible:outline-none"
      onMouseDown={(event) => onResizeStart(event, id)}
      onDoubleClick={(event) => { event.stopPropagation(); onAutoWidth(id); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onWidth(id, width + (event.key === 'ArrowRight' ? 8 : -8));
        }
      }}
    />
  );
}

export function V25ColumnDisplayMenu({
  prefs, setVisible, setCostVisible, showAll, reset,
}: {
  prefs: V25GridPrefs;
  setVisible: (id: V25GridColumnId, checked: boolean) => void;
  setCostVisible: (checked: boolean) => void;
  showAll: () => void;
  reset: () => void;
}) {
  const costOn = prefs.visible.cost_unit && prefs.visible.cost_amount && prefs.visible.gross;
  return (
    <details className="relative z-20" data-testid="v25-grid-column-menu">
      <summary className="cursor-pointer rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
        列の表示
      </summary>
      <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded border border-slate-300 bg-white p-3 text-[11px] shadow-lg">
        <label className="flex cursor-pointer items-center gap-2 border-b border-slate-200 pb-2 font-semibold">
          <input type="checkbox" checked={costOn} onChange={(e) => setCostVisible(e.target.checked)} data-testid="v25-wb-show-cost" />
          原価を表示（3列まとめて）
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {V25_GRID_COLUMNS.map((col) => (
            <label key={col.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <input type="checkbox" checked={prefs.visible[col.id]} disabled={col.locked}
                aria-label={`${col.label}列を表示`}
                data-testid={`v25-grid-visible-${col.id}`}
                onChange={(e) => setVisible(col.id, e.target.checked)} />
              {col.label}
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2 border-t border-slate-200 pt-2">
          <button type="button" onClick={showAll} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">すべて表示</button>
          <button type="button" onClick={reset} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">初期状態に戻す</button>
        </div>
      </div>
    </details>
  );
}
