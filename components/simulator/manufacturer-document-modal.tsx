'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';

type Props = {
  open: boolean;
  url: string | null;
  productName: string;
  onClose: () => void;
};

export function ManufacturerDocumentModal({ open, url, productName, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open || !url) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-testid="manufacturer-document-modal-backdrop"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${productName} メーカー資料`}
        className="flex h-[88vh] w-[min(96vw,90rem)] flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        data-testid="manufacturer-document-modal"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-brown">メーカー資料</p>
            <h2 className="truncate text-sm font-semibold text-ink sm:text-base">{productName}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-2 text-xs font-semibold text-ink transition hover:bg-sand"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">別タブで開く</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink transition hover:bg-sand"
              aria-label="メーカー資料を閉じる"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 bg-sand/45 p-2 sm:p-3">
          <iframe
            src={url}
            title={`${productName} メーカー資料`}
            className="h-full w-full rounded-lg border border-line bg-white"
            loading="lazy"
          />
        </div>
      </section>
    </div>,
    document.body
  );
}
