'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import type { OptionVariantChoice, OptionVariantGroup } from '@/lib/domain/types';
import { VariantPicker } from './variant-picker';

type Props = {
  open: boolean;
  url: string | null;
  productName: string;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
  selectedVariantIds: string[];
  onVariantChange: (choiceId: string, groupId: string) => void;
  onClose: () => void;
};

export function ManufacturerDocumentModal({
  open,
  url,
  productName,
  groups,
  choices,
  selectedVariantIds,
  onVariantChange,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // The product picker is already a native modal. A second native modal must
  // enter the browser top layer; a portal with z-index remains behind it.
  useEffect(() => {
    if (!open || !url) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, url]);

  if (!open || !url) return null;

  const hasSelectableVariants = groups.length > 0;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={`${productName} メーカー資料`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) onClose();
      }}
      className="fixed inset-0 m-auto flex h-[88vh] w-[min(96vw,90rem)] max-h-none max-w-none flex-col overflow-hidden rounded-2xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-black/55"
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
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-full border border-line bg-white text-ink transition hover:bg-sand"
              aria-label="メーカー資料を閉じる"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {hasSelectableVariants ? (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(15rem,1.35fr)_minmax(12rem,1fr)] bg-sand/45 md:grid-cols-[minmax(0,1.8fr)_minmax(19rem,0.8fr)] md:grid-rows-1">
            <div className="min-h-0 p-2 sm:p-3">
              <iframe
                src={url}
                title={`${productName} メーカー資料`}
                className="h-full w-full rounded-lg border border-line bg-white"
                loading="lazy"
              />
            </div>

            <aside
              className="min-h-0 overflow-y-auto border-t border-line bg-white px-4 py-3 md:border-l md:border-t-0 md:px-5 md:py-4"
              aria-label="メーカー資料を見ながら仕様を選ぶ"
              data-testid="manufacturer-document-variant-panel"
            >
              <div className="sticky top-0 z-10 -mx-4 -mt-3 border-b border-line bg-white/95 px-4 pb-3 pt-3 backdrop-blur md:-mx-5 md:-mt-4 md:px-5 md:pt-4">
                <h3 className="text-sm font-semibold text-ink">カラー・仕様を選ぶ</h3>
                <p className="mt-1 text-[0.68rem] leading-relaxed text-muted">
                  メーカー資料を見ながら選択できます。ここでの選択は商品詳細にもそのまま反映されます。
                </p>
              </div>
              <div className="pt-1">
                <VariantPicker
                  groups={groups}
                  choices={choices}
                  selected={selectedVariantIds}
                  onChange={onVariantChange}
                  showImages
                  showCurrentValue
                />
              </div>
            </aside>
          </div>
        ) : (
          <div className="min-h-0 flex-1 bg-sand/45 p-2 sm:p-3">
            <iframe
              src={url}
              title={`${productName} メーカー資料`}
              className="h-full w-full rounded-lg border border-line bg-white"
              loading="lazy"
            />
          </div>
        )}
    </dialog>,
    document.body
  );
}
