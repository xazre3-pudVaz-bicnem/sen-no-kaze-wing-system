'use client';

import { useEffect } from 'react';
import { ImageOff } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import type { OptionCategory, OptionVariantChoice, ProductOption } from '@/lib/domain/types';
import {
  exteriorFaceForElevation,
  exteriorFaceLabel,
  type ExteriorFaceCode,
  type ExteriorFaceSelection,
} from '@/lib/domain/exterior-wall';
import { SmartImage } from '@/components/ui/smart-image';
import { publishExteriorFaceDisplays, publishExteriorFacePicker } from './exterior-face-display-store';

interface Elevation {
  url: string;
  label: string;
  alt: string;
}

interface Props {
  /** 表示中の平面図（resolvePreview の結果） */
  plan: PreviewResolution;
  readOnly: boolean;
}

/**
 * 平面図。
 * 平面図のクリック領域（preview_hotspots）は先方の要望でいったん外している。
 */
export function PlanBoard({ plan, readOnly }: Props) {
  void readOnly;
  const planImage = plan.layers[0];

  return (
    <div className="space-y-4">
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
    </div>
  );
}

/** 立面図の横帯（4面）。各面をクリックすると、その面だけの外壁選択を開く。 */
export function ElevationStrip({
  elevations,
  categories,
  options,
  variantChoices,
  exteriorFaces,
  readOnly,
  onPickExteriorFace,
}: {
  elevations: Elevation[];
  categories: OptionCategory[];
  options: ProductOption[];
  variantChoices: OptionVariantChoice[];
  exteriorFaces: ExteriorFaceSelection[];
  readOnly: boolean;
  onPickExteriorFace: (face: ExteriorFaceCode) => void;
}) {
  const wallCat = categories.find((c) => c.code === 'exterior-wall');
  const wallOptions = options.filter((o) => o.category_id === wallCat?.id);

  useEffect(() => {
    publishExteriorFaceDisplays(
      exteriorFaces.map((face) => {
        const option = wallOptions.find((o) => o.id === face.option_id);
        const variantNames = face.variant_choice_ids
          .map((id) => variantChoices.find((choice) => choice.id === id)?.name)
          .filter((name): name is string => Boolean(name));
        return {
          face_code: face.face_code,
          option_id: face.option_id,
          option_name: option?.name ?? '選択なし',
          variant_names: variantNames,
          image_url: option?.image_url ?? null,
        };
      })
    );
  }, [exteriorFaces, variantChoices, wallOptions]);

  useEffect(() => {
    publishExteriorFacePicker(onPickExteriorFace);
    return () => publishExteriorFacePicker(null);
  }, [onPickExteriorFace]);

  if (elevations.length === 0) return null;

  const summary = (face: ExteriorFaceCode) => {
    const selected = exteriorFaces.find((f) => f.face_code === face);
    const option = wallOptions.find((o) => o.id === selected?.option_id);
    if (!option) return '外壁を選ぶ';
    const variants = (selected?.variant_choice_ids ?? [])
      .map((id) => variantChoices.find((c) => c.id === id)?.name)
      .filter(Boolean);
    return variants.length ? `${option.name} / ${variants.join('・')}` : option.name;
  };

  return (
    <figure className="card overflow-hidden">
      <figcaption className="border-b border-line px-4 py-2 text-sm font-semibold">
        立面図（4面）
        <span className="ml-2 text-xs font-normal text-muted">各面をクリックして外壁を個別に選べます</span>
      </figcaption>
      <ul className="grid grid-cols-2 gap-3 bg-white p-3 sm:grid-cols-4">
        {elevations.map((e, index) => {
          const face = exteriorFaceForElevation(e.label, index);
          return (
            <li key={e.url}>
              <button
                type="button"
                disabled={readOnly || !wallCat}
                onClick={() => onPickExteriorFace(face)}
                className="group block w-full text-left"
                data-testid={`elevation-${e.label}`}
              >
                <span className="relative block aspect-[2/1] overflow-hidden rounded border border-line bg-white transition-colors group-hover:border-brown">
                  <SmartImage src={e.url} alt={e.alt} fill sizes="(min-width: 640px) 22vw, 45vw" className="object-contain p-1.5" />
                </span>
                <span className="mt-1 block text-[0.7rem] font-semibold text-ink-soft">
                  {e.label} <span className="font-normal text-muted">（{exteriorFaceLabel(face)}）</span>
                </span>
                <span className="mt-0.5 block line-clamp-2 text-[0.62rem] leading-snug text-muted">{summary(face)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
