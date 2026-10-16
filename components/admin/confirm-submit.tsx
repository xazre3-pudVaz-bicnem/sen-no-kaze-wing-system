'use client';

import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';

type ConfirmSubmitProps = ComponentProps<'button'> & {
  message: string;
};

export function ConfirmSubmit({ message, children, ...props }: ConfirmSubmitProps) {
  const [open, setOpen] = useState(false);
  const submitterRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const descriptionId = `${dialogId}-description`;
  const destructive = message.includes('削除しますか');
  const dialogTitle = message.includes('登録しますか')
    ? 'この内容で登録しますか？'
    : destructive
      ? '削除しますか？'
      : 'この操作を実行しますか？';
  const confirmLabel = typeof children === 'string' ? children : destructive ? '削除する' : '実行する';

  const closeDialog = () => {
    setOpen(false);
    queueMicrotask(() => submitterRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      queueMicrotask(() => submitterRef.current?.focus());
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    cancelButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const confirmSubmit = () => {
    const submitter = submitterRef.current;
    const form = submitter?.form;
    if (!submitter || !form) {
      closeDialog();
      return;
    }

    setOpen(false);
    queueMicrotask(() => form.requestSubmit(submitter));
  };

  return (
    <>
      <button
        {...props}
        ref={submitterRef}
        type="submit"
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (form && !form.reportValidity()) {
            event.preventDefault();
            return;
          }

          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {dialogTitle}
            </h2>
            <p id={descriptionId} className="mt-2 text-sm leading-6 text-ink-soft">
              {message}
            </p>

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
                onClick={confirmSubmit}
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
