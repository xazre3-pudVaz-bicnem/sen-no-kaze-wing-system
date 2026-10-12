'use client';

import { useRef } from 'react';
import { X } from 'lucide-react';
import { SmartImage } from '@/components/ui/smart-image';

type FloorplanLightboxProps = {
  src: string;
  alt: string;
  modelName: string;
  presetName: string;
};

export function FloorplanLightbox({ src, alt, modelName, presetName }: FloorplanLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const title = `${modelName} ${presetName}の平面図`;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="absolute inset-0 block w-full cursor-zoom-in text-left"
        aria-label={`${title}を拡大`}
      >
        <SmartImage
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1280px) 28vw, (min-width: 768px) 44vw, 50vw"
          className="object-contain p-1.5 transition hover:opacity-90"
        />
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
              aria-label="平面図を閉じる"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="relative h-[min(78vh,820px)] w-full bg-[#f5f2eb]">
            <SmartImage src={src} alt={alt} fill sizes="96vw" className="object-contain p-3 sm:p-5" />
          </div>
        </div>
      </dialog>
    </>
  );
}
