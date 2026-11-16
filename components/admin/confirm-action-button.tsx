'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';

type ConfirmActionButtonProps = Omit<ComponentProps<'button'>, 'onClick'> & {
  message: string;
  dialogTitle?: string;
  confirmLabel?: string;
  destructive?: boolean;
  showCloseButton?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmActionButton({
  message,
  dialogTitle = 'この操作を実行しますか？',
  confirmLabel = '実行する',
  destructive = false,
  showCloseButton = false,
  onConfirm,
  children,
  ...props
}: ConfirmActionButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;

  const closeDialog = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      queueMicrotask(() => triggerRef.current?.focus());
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);
    cancelButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const confirm = () => {
    setOpen(false);
    void onConfirm();
  };

  return (
    <>
      <button {...props} ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        {children}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4"
          onClick={(event) => {
            // pointerdown で消すと後続の click が背後の操作へ抜けるため、click 完了時に閉じる。
            event.stopPropagation();
            if (event.target === event.currentTarget) { event.preventDefault(); closeDialog(); }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-semibold text-ink">{dialogTitle}</h2>
              {showCloseButton && (
                <button type="button" aria-label="確認画面を閉じる" title="閉じる" data-testid="confirm-action-close"
                  className="text-xl text-ink-soft" onClick={closeDialog}>×</button>
              )}
            </div>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-soft">{message}</p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancelButtonRef}
                type="button"
                className="btn-secondary btn-sm min-w-24"
                onClick={closeDialog}
              >
                キャンセル
              </button>
              <button
                type="button"
                className={destructive
                  ? 'inline-flex min-h-9 min-w-24 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2'
                  : 'btn-primary min-w-24'}
                onClick={confirm}
              >
                {confirmLabel}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
