'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { SmartImage } from '@/components/ui/smart-image';

export type ProductGalleryImage = { url: string; label: string };

interface Props {
  open: boolean;
  productName: string;
  images: ProductGalleryImage[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

export function ProductImageLightbox({ open, productName, images, selectedIndex, onSelect, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const index = images.length ? Math.min(Math.max(0, selectedIndex), images.length - 1) : 0;
  const image = images[index] ?? null;

  // The simulator uses a native <dialog>. A second native modal is required to
  // appear above its top layer; a z-index-only portal would remain underneath.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previouslyFocused?.focus();
    };
  }, [open]);

  const move = (direction: -1 | 1) => {
    if (images.length < 2) return;
    setZoom(1);
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollLeft = 0;
      scrollAreaRef.current.scrollTop = 0;
    }
    onSelect((index + direction + images.length) % images.length);
  };

  const handleKeys = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (images.length < 2) return;
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
  };

  const handleBackdrop = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  };

  if (!open || !image || typeof document === 'undefined') return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label={`${productName} 商品画像の拡大表示`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={handleBackdrop}
      onKeyDown={handleKeys}
      className="fixed inset-0 m-auto h-[min(92dvh,54rem)] w-[min(96vw,80rem)] max-h-none max-w-none overflow-hidden rounded-xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-black/80"
      data-testid="product-detail-image-lightbox"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted">表示中の画像</p>
            <p className="truncate text-[13px] font-semibold" title={image.label}>{image.label}</p>
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {index + 1} / {images.length}
          </span>
          <div className="ml-1 flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={zoom <= 1}
              className="rounded-md border border-line p-2 hover:bg-sand disabled:opacity-40" aria-label="画像を縮小">
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <span className="w-9 text-center text-[11px] tabular-nums text-muted">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => Math.min(4, value + 0.5))} disabled={zoom >= 4}
              className="rounded-md border border-line p-2 hover:bg-sand disabled:opacity-40" aria-label="画像を拡大">
              <Plus className="size-4" aria-hidden="true" />
            </button>
            <button ref={closeButtonRef} type="button" onClick={onClose}
              className="ml-1 rounded-md border border-line p-2 hover:bg-sand" aria-label="拡大表示を閉じる">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div ref={scrollAreaRef} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-sand/45" data-testid="product-detail-image-zoom-area">
          <div
            className="relative min-h-full"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <SmartImage
              src={image.url}
              alt={`${productName} ${image.label}`}
              fill
              sizes="(min-width: 768px) 95vw, 96vw"
              className="object-contain p-2 sm:p-4"
              unoptimized
            />
          </div>
        </div>
        {images.length > 1 && (
          <footer className="flex shrink-0 items-center justify-between border-t border-line px-3 py-2">
            <button type="button" onClick={() => move(-1)}
              className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-semibold hover:bg-sand"
              aria-label="拡大画像の前の画像">
              <ChevronLeft className="size-4" aria-hidden="true" />前の画像
            </button>
            <button type="button" onClick={() => move(1)}
              className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-xs font-semibold hover:bg-sand"
              aria-label="拡大画像の次の画像">
              次の画像<ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </footer>
        )}
      </div>
    </dialog>,
    document.body
  );
}
