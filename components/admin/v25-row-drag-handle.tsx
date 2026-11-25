'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { V25MoveSide } from './standard-estimate-v25-row-move';

type DragSession = {
  pointerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  dragging: boolean;
  table: HTMLTableElement;
  captureTarget: HTMLButtonElement;
};

/** Release on every exit path, including Escape, pointercancel and unmount. */
function releaseCapture(session: DragSession | null) {
  if (!session) return;
  try {
    if (session.captureTarget.hasPointerCapture(session.pointerId)) {
      session.captureTarget.releasePointerCapture(session.pointerId);
    }
  } catch {
    // A removed/disabled element can no longer own the capture.
  }
}

const EDGE_PX = 72;
const MIN_SCROLL_PX = 4;
const MAX_SCROLL_PX = 18;

/**
 * 専用ハンドルだけがタッチ/マウスを捕捉する。
 * 実際にドラッグ（8px以上）している間、表が画面外へ続く場合だけ
 * viewportの端でページを自動スクロールする。入力・ページの通常スクロールには介入しない。
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
  const scrollFrame = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const stopScroll = () => {
    if (scrollFrame.current !== null) {
      window.cancelAnimationFrame(scrollFrame.current);
      scrollFrame.current = null;
    }
  };
  // ロングリスト中の行がスクロールで入れ替わっても毎回現在座標で再判定。
  const hitRow = (x: number, y: number): { targetId: string; side: V25MoveSide } | null => {
    const current = drag.current;
    if (!current || !current.dragging || disabled) {
      onPreview(null, 'before');
      return null;
    }
    const hit = document.elementFromPoint(x, y);
    const targetRow = hit?.closest<HTMLTableRowElement>('tr[data-v25-dnd-row]');
    const targetId = targetRow?.dataset.v25DndRow;
    if (!targetRow || !current.table.contains(targetRow) ||
        targetRow.dataset.v25DndSection !== section || !targetId || targetId === rowId) {
      onPreview(null, 'before');
      return null;
    }
    const bounds = targetRow.getBoundingClientRect();
    const side: V25MoveSide = y < bounds.top + bounds.height / 2 ? 'before' : 'after';
    return onPreview(targetId, side) ? { targetId, side } : null;
  };

  /** テーブルの見えている区間・実際のページ端だけに発動を限定する。 */
  const scrollDelta = (session: DragSession): number => {
    const rect = session.table.getBoundingClientRect();
    const { x, y } = session;
    const height = window.innerHeight;
    if (x < Math.max(0, rect.left) || x > Math.min(window.innerWidth, rect.right) ||
        y <= 0 || y >= height || y < rect.top || y > rect.bottom) return 0;

    if (y < EDGE_PX && rect.top < 0 && window.scrollY > 0) {
      return -(MIN_SCROLL_PX + (1 - y / EDGE_PX) * (MAX_SCROLL_PX - MIN_SCROLL_PX));
    }
    if (y > height - EDGE_PX && rect.bottom > height &&
        window.scrollY < document.documentElement.scrollHeight - height - 1) {
      return MIN_SCROLL_PX + ((y - (height - EDGE_PX)) / EDGE_PX) * (MAX_SCROLL_PX - MIN_SCROLL_PX);
    }
    return 0;
  };

  const scrollStep = () => {
    scrollFrame.current = null;
    const session = drag.current;
    if (!session?.dragging || disabled) return;
    const delta = scrollDelta(session);
    if (!delta) return;
    const before = window.scrollY;
    window.scrollBy({ top: delta, behavior: 'instant' });
    if (window.scrollY === before) return;
    // ポインターが静止していてもスクロール後に別の行を指しているので再ヒットテスト。
    hitRow(session.x, session.y);
    scrollFrame.current = window.requestAnimationFrame(scrollStep);
  };

  const clear = () => {
    stopScroll();
    const session = drag.current;
    // Clear first: releasePointerCapture may dispatch lostpointercapture synchronously.
    drag.current = null;
    releaseCapture(session);
    setDragging(false);
    onPreview(null, 'before');
  };
  // Unmount while dragging must not leave a captured pointer or animation frame.
  useEffect(() => () => {
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    const session = drag.current;
    drag.current = null;
    releaseCapture(session);
  }, []);

  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const table = event.currentTarget.closest('table');
    if (!table) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId, originX: event.clientX, originY: event.clientY,
      x: event.clientX, y: event.clientY, dragging: false, table,
      captureTarget: event.currentTarget,
    };
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId || disabled) return;
    session.x = event.clientX;
    session.y = event.clientY;
    if (!session.dragging) {
      const distance = Math.hypot(session.x - session.originX, session.y - session.originY);
      if (distance < 8) return; // タップ・微小なタッチの揺れは変更しない
      session.dragging = true;
      setDragging(true);
    }
    hitRow(session.x, session.y);
    if (scrollDelta(session)) {
      if (scrollFrame.current === null) scrollFrame.current = window.requestAnimationFrame(scrollStep);
    } else {
      stopScroll();
    }
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = drag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    // 移動先が動いている場合、過去のヒット結果で確定しない。
    const target = session.dragging && !disabled ? hitRow(event.clientX, event.clientY) : null;
    clear();
    if (target) onDrop(target.targetId, target.side);
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
