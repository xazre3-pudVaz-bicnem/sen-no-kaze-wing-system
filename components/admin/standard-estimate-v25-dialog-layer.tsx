'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type V25DialogLayerProps = {
  onClose: () => void;
  dirty?: boolean;
  /** 明細の「…」など、起動元が閉じるメニュー内の場合は明示的な復帰先を指定する。 */
  returnFocusTo?: HTMLElement | null;
  className?: string;
  children: (requestClose: () => void) => ReactNode;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * 標準見積v2.5のポップアップ共通閉鎖規則。
 * - 枠外クリック・Esc・右上×は同じ requestClose を通る
 * - 未確定入力があれば前面に破棄確認を重ね、取消では親の入力を維持する
 * - Esc / Tab は最前面のlayerだけに作用し、閉じたら起動元へフォーカスを戻す
 * - backdropはclick終了時に外す（pointerdownで外すと背面へのclick貫通が起こり得る）
 */
export function V25DialogLayer({ onClose, dirty = false, returnFocusTo, className, children }: V25DialogLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestedOpenerRef = useRef(returnFocusTo);
  const [discardOpen, setDiscardOpen] = useState(false);

  const requestClose = () => {
    if (dirty) setDiscardOpen(true);
    else onClose();
  };

  useEffect(() => {
    // 閉じたメニュー項目を起動元扱いしない。親から明示された「…」を最優先する。
    openerRef.current = requestedOpenerRef.current?.isConnected
      ? requestedOpenerRef.current
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      const layer = layerRef.current;
      if (!layer) return;
      // 入力開始が目的のダイアログだけ、閉じるボタンより入力欄を優先する。
      (layer.querySelector<HTMLElement>('[data-v25-dialog-initial-focus]') ??
        layer.querySelector<HTMLElement>('[data-v25-dialog-close]') ??
        layer.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
    });
    return () => {
      const opener = openerRef.current;
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const layer = layerRef.current;
      if (!layer) return;
      const layers = document.querySelectorAll('[data-v25-dialog-layer]');
      if (layers[layers.length - 1] !== layer) return;

      if (event.key === 'Escape') {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(layer.querySelectorAll<HTMLElement>(FOCUSABLE))
          .filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) { event.preventDefault(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    // captureで内側のExcel風Tab/Enter移動に先行。ただしTabのみ閉じ込め、Enterは内側へ渡す。
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  });

  return (
    <div ref={layerRef} data-v25-dialog-layer
      className={className ?? 'fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]'}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) {
          event.preventDefault();
          requestClose();
        }
      }}>
      {children(requestClose)}
      {discardOpen && (
        <V25DialogLayer
          dirty={false}
          onClose={() => setDiscardOpen(false)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          {(dismissConfirmation) => (
            <div role="alertdialog" aria-modal="true" aria-label="変更内容の破棄確認"
              data-testid="v25-wb-discard-confirm"
              className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">変更内容を破棄しますか？</h2>
                <button type="button" data-v25-dialog-close aria-label="確認を閉じる"
                  className="text-lg text-muted" onClick={dismissConfirmation}>×</button>
              </div>
              <p className="mt-3 text-sm text-muted">この画面で変更した未確定の入力は反映されません。</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={dismissConfirmation}>編集を続ける</button>
                <button type="button" className="btn-primary btn-sm"
                  data-testid="v25-wb-discard-confirm-accept" onClick={onClose}>破棄して閉じる</button>
              </div>
            </div>
          )}
        </V25DialogLayer>
      )}
    </div>
  );
}
