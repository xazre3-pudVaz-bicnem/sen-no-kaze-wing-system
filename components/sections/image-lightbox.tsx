'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';
import { SmartImage } from '@/components/ui/smart-image';

type ImageLightboxProps = {
  src: string;
  alt: string;
  title: string;
  triggerSizes: string;
  triggerImageClassName: string;
  modalImageClassName?: string;
  modalBackgroundClassName?: string;
};

export function ImageLightbox({
  src,
  alt,
  title,
  triggerSizes,
  triggerImageClassName,
  modalImageClassName = 'object-contain p-3 sm:p-5',
  modalBackgroundClassName = 'bg-[#f5f2eb]',
}: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="absolute inset-0 block w-full cursor-zoom-in text-left"
        aria-label={`${title}を拡大`}
      >
        <SmartImage src={src} alt={alt} fill sizes={triggerSizes} className={triggerImageClassName} />
        <span className="absolute right-2 top-2 z-10 rounded-full border border-line bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-forest shadow-sm backdrop-blur">
          拡大
        </span>
      </button>

      <dialog
        ref={dialogRef}
        aria-label={title}
        className="m-auto max-h-[94vh] w-[min(96vw,1200px)] max-w-none overflow-hidden rounded-xl border border-line bg-white p-0 shadow-2xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="flex max-h-[94vh] flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-4">
            <p className="truncate text-sm font-semibold text-ink sm:text-base">{title}</p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-forest hover:text-forest"
              aria-label="画像を閉じる"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className={`relative h-[min(78vh,820px)] w-full cursor-zoom-out ${modalBackgroundClassName}`}
            aria-label={`${title}を閉じる`}
          >
            <SmartImage src={src} alt={alt} fill sizes="96vw" className={modalImageClassName} />
          </button>
        </div>
      </dialog>
    </>
  );
}
