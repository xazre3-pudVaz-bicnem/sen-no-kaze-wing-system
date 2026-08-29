'use client';

import { ImageOff } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import type { OptionCategory } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';

interface Elevation {
  url: string;
  label: string;
  alt: string;
}

interface Props {
  /** 表示中の平面図（resolvePreview の結果） */
  plan: PreviewResolution;
  categories: OptionCategory[];
  elevations: Elevation[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/**
 * 左半分：平面図＋立面図4面＋外観パース。
 *
 * 平面図のクリック領域（preview_hotspots）は先方の要望でいったん外している。
 * データとテーブルは残してあるので、戻すときはこのファイルに重ね直せばよい。
 * 設備の変更は「標準設備及び仕上げ表」と「御見積書の明細」から行う。
 */
export function PlanBoard({ plan, categories, elevations, readOnly, onPickCategory }: Props) {
  const planImage = plan.layers[0];
  const wallCat = categories.find((c) => c.code === 'exterior-wall');

  return (
    <div className="-mt-5 space-y-4">
      {/* 平面図 */}
      <figure className="card overflow-hidden" data-testid="plan-board">
        <figcaption className="border-b border-line px-4 py-2.5 text-sm font-semibold">平面図</figcaption>
        <div className="relative aspect-[4/3] bg-white" data-testid="plan-image" data-plan-src={planImage?.url ?? ''}>
          {planImage ? (
            <SmartImage src={planImage.url} alt={planImage.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-contain p-2" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <ImageOff className="size-7" aria-hidden="true" />
              <p className="text-sm">この構成の平面図は準備中です</p>
            </div>
          )}
        </div>
        {plan.approximate && (
          <p className="border-t border-line bg-ivory px-4 py-2 text-xs text-ink-soft">
            選択中の仕様に完全一致する平面図がないため、最も近い図面を表示しています。
          </p>
        )}
      </figure>

      {/* 立面図（4面） */}
      {elevations.length > 0 && (
        <figure className="card overflow-hidden">
          <figcaption className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            立面図（4面）
            <span className="ml-2 text-xs font-normal text-muted">クリックすると外壁を選べます</span>
          </figcaption>
          <ul className="grid grid-cols-2 gap-3 bg-white p-3">
            {elevations.map((e) => (
              <li key={e.url}>
                <button
                  type="button"
                  disabled={readOnly || !wallCat}
                  onClick={() => wallCat && onPickCategory(wallCat.id)}
                  className="group block w-full text-left"
                  data-testid={`elevation-${e.label}`}
                >
                  <span className="relative block aspect-[2/1] overflow-hidden rounded border border-line bg-white transition-colors group-hover:border-brown">
                    <SmartImage src={e.url} alt={e.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-contain p-1.5" />
                  </span>
                  <span className="mt-1 block text-[0.7rem] text-muted">{e.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </figure>
      )}

    </div>
  );
}
