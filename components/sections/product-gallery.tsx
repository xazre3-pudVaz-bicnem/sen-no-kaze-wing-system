'use client';

import { useState } from 'react';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface GalleryImage {
  url: string;
  alt: string;
  caption: string | null;
  kind: string;
}

export function ProductGallery({ images }: { images: GalleryImage[] }) {
  const [index, setIndex] = useState(0);
  const current = images[index];
  if (!current) return <div className="flex aspect-[4/3] items-center justify-center rounded-3xl bg-sand text-muted">画像準備中</div>;
  return (
    <div>
      <figure className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-sand">
        <SmartImage key={current.url} src={current.url} alt={current.alt} fill priority sizes="(min-width: 1024px) 56vw, 100vw" className="object-contain" />
        <figcaption className="absolute bottom-3 left-3 rounded-full bg-ink/70 px-3 py-1 text-xs text-white">
          {current.kind}
          {current.caption ? `｜${current.caption}` : ''}
        </figcaption>
      </figure>
      <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="商品画像サムネイル">
        {images.map((img, i) => (
          <li key={img.url + i}>
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`${img.kind}: ${img.alt}`}
              aria-pressed={i === index}
              className={cn('relative block aspect-[4/3] w-full overflow-hidden rounded-xl border-2 transition', i === index ? 'border-brown' : 'border-transparent hover:border-line')}
            >
              <SmartImage src={img.url} alt="" fill sizes="120px" className="object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
