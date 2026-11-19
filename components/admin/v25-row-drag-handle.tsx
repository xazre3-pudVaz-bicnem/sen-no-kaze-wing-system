'use client';

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { V25MoveSide } from './standard-estimate-v25-row-move';

type DragSession = {
  pointerId: number;
  originX: number;
  originY: number;
  dragging: boolean;
  targetId: string | null;
  side: V25MoveSide;
};

/**
 * 左端の専用ハンドルからのみポインター操作を開始する。
 * mouse / touch / pen 共通。入力欄・行全体にはリスナーやtouch-noneを付けない。
 * 移動先は実際の表の行だけを拾い、実行可否は呼び出し元の正式な行移動計画で再確認する。
 */
export function V25RowDragHandle({
  rowId, section, disabled, onPreview, onDrop,
}: {
  rowId: string;
  section: string;
  disabled: boolean;
  onPreview: (targetId: string | null, side: V25MoveSide) => boolean;
  onDrop: (targetId: string, side: V25MoveSide) => void;
}) {
  const drag = useRef<DragSession | null>(null);
  const [dragging, setDragging] = useState(false);

  const clear = () => {
    drag.current = null;
    setDragging(false);
    onPreview(null, 'before');
  };
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, originX: event.clientX, originY: event.clientY,
      dragging: false, targetId: null, side: 'before',
    };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId || disabled) return;
    if (!session.dragging) {
      const distance = Math.hypot(event.clientX - session.originX, event.clientY - session.originY);
      if (distance < 8) return; // タップ・微小なタッチの揺れは並び替えしない
      session.dragging = true;
      setDragging(true);
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const targetRow = hit?.closest<HTMLTableRowElement>('tr[data-v25-dnd-row]');
    const targetId = targetRow?.dataset.v25DndRow ?? null;
    if (!targetRow || targetRow.dataset.v25DndSection !== section || !targetId || targetId === rowId) {
      session.targetId = null;
      onPreview(null, 'before');
      return;
    }
    const bounds = targetRow.getBoundingClientRect();
    const side: V25MoveSide = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    if (onPreview(targetId, side)) {
      session.targetId = targetId;
      session.side = side;
    } else {
      session.targetId = null;
    }
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const target = session.dragging && !disabled ? session.targetId : null;
    const side = session.side;
    clear();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (target) onDrop(target, side);
  };

  return (
    <button type="button" aria-label="この明細をドラッグして移動" title="ドラッグで行を移動（スマホでも使用可能）。↑↓でも移動できます"
      data-testid="v25-wb-row-drag-handle" data-dragging={dragging || undefined}
      disabled={disabled}
      className="flex size-6 shrink-0 touch-none select-none items-center justify-center rounded text-emerald-900 cursor-grab hover:bg-emerald-100 active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
      onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerCancel={clear} onLostPointerCapture={() => { if (drag.current) clear(); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); clear(); }
      }}>
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
}
