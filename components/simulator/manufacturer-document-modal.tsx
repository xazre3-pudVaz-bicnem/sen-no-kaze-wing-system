'use client';

import { useEffect } from 'react';
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

  const hasSelectableVariants = groups.length > 0;

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
      </section>
    </div>,
    document.body
  );
}
