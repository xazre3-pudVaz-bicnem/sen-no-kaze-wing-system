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

const PLAN_DISPLAY_URLS: Record<string, string> = {
  '/images/plan/wing-hotel.png': '/images/plan/display/wing-hotel.png',
  '/images/plan/wing-residence.png': '/images/plan/display/wing-residence.png',
};

interface Props {
  /** 表示中の平面図（resolvePreview の結果） */
  plan: PreviewResolution;
  specName: string;
  planSize: string | null;
  readOnly: boolean;
}

/**
 * 平面図。
 * 平面図のクリック領域（preview_hotspots）は先方の要望でいったん外している。
 */
export function PlanBoard({ plan, specName, planSize, readOnly }: Props) {
  void readOnly;
  const planImage = plan.layers[0];
  const displayPlanUrl = planImage ? (PLAN_DISPLAY_URLS[planImage.url] ?? planImage.url) : '';
  const shortSize = planSize?.split('（')[0]?.replace(/\s*mm$/, '').replace(/\s*×\s*/g, '×').trim() ?? null;
  const specLabel = specName ? specName.replace('仕様', '用') : '';

  return (
    <figure className="overflow-hidden rounded-lg border border-[#e8b100] bg-white lg:rounded-none" data-testid="plan-board">
      <figcaption className="px-4 pt-3 pb-2 text-base font-medium leading-tight text-ink">
        <span className="font-semibold">【平面図】</span>
        {(specLabel || shortSize) && (
          <span className="ml-1">
            {specLabel}
            {specLabel && shortSize ? '/' : ''}
            {shortSize}
          </span>
        )}
      </figcaption>
      <div
        className="relative aspect-[4/3] bg-white px-2 pb-2"
        data-testid="plan-image"
        data-plan-src={planImage?.url ?? ''}
        data-plan-display-src={displayPlanUrl}
      >
        {planImage ? (
          <SmartImage src={displayPlanUrl} alt={planImage.alt} fill sizes="(min-width: 1280px) 38rem, (min-width: 1024px) 50vw, 100vw" className="object-contain p-1" />
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

  const selectionDetails = (face: ExteriorFaceCode) => {
    const selected = exteriorFaces.find((f) => f.face_code === face);
    const option = wallOptions.find((o) => o.id === selected?.option_id);
    const variants = (selected?.variant_choice_ids ?? [])
      .map((id) => variantChoices.find((choice) => choice.id === id))
      .filter((choice): choice is OptionVariantChoice => Boolean(choice));
    return {
      materialName: option?.name.replace(/^外壁\s*/, '') ?? '未選択',
      finishName: variants.length ? variants.map((choice) => choice.name).join('・') : '指定なし',
      imageUrl: variants.find((choice) => choice.image_url)?.image_url ?? option?.image_url ?? null,
    };
  };
  const elevationGroups = [elevations.slice(0, 2), elevations.slice(2, 4)].filter((group) => group.length > 0);

  return (
    <figure className="overflow-hidden rounded-lg border border-[#e8b100] bg-white lg:-mt-px lg:rounded-none">
      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 pt-3 pb-2">
        <span className="text-base font-semibold text-ink">【立面図（4面）】</span>
        <span className="text-xs font-normal text-muted">各面をクリックして外壁を個別に選べます。</span>
        <span className="text-[0.68rem] text-muted">（外壁は内外装工事に含まれます）</span>
      </figcaption>
      <div className="grid border-t border-[#e8b100] lg:grid-cols-2">
        {elevationGroups.map((group, groupIndex) => (
          <ul
            key={group[0]?.url}
            className={`grid grid-cols-2 bg-white p-3 [&>li+li]:border-l [&>li+li]:border-line lg:p-4 ${
              groupIndex === 1 ? 'border-t border-[#e8b100] lg:border-t-0 lg:border-l' : ''
            }`}
            data-testid={groupIndex === 0 ? 'elevation-group-front' : 'elevation-group-back'}
          >
            {group.map((e, index) => {
              const face = exteriorFaceForElevation(e.label, groupIndex * 2 + index);
              const details = selectionDetails(face);
              return (
                <li key={e.url} className="min-w-0 px-1.5 sm:px-3">
                  <button
                    type="button"
                    disabled={readOnly || !wallCat}
                    onClick={() => onPickExteriorFace(face)}
                    className="group flex h-full w-full flex-col text-left"
                    data-testid={`elevation-${e.label}`}
                    aria-label={`${e.label}の外壁を変更`}
                  >
                    <span className="relative block aspect-[1.85/1] w-full overflow-hidden rounded-md border border-line bg-white transition-colors group-hover:border-brown">
                      <SmartImage src={e.url} alt={e.alt} fill sizes="(min-width: 1280px) 18rem, (min-width: 1024px) 24vw, (min-width: 640px) 45vw, 100vw" className="object-contain p-1" />
                    </span>
                    <span className="mt-2 block text-[0.72rem] font-semibold leading-tight text-ink-soft">
                      {e.label} <span className="font-normal text-muted">（{exteriorFaceLabel(face)}）</span>
                    </span>
                    <span className="mt-2 flex w-full min-w-0 items-start gap-2 border-t border-line pt-2">
                      {details.imageUrl && (
                        <span className="relative block size-14 shrink-0 overflow-hidden border border-line bg-sand">
                          <SmartImage src={details.imageUrl} alt="" fill sizes="3.5rem" className="object-cover" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[0.68rem] leading-snug font-semibold text-ink">{details.materialName}</span>
                        <span className="mt-1 block truncate border border-line bg-ivory px-1.5 py-1 text-[0.6rem] leading-none text-ink-soft" title={`色・仕様：${details.finishName}`}>
                          色・仕様：{details.finishName}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </figure>
  );
}
