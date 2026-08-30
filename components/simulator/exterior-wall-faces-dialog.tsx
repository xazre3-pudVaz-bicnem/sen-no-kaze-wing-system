'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ImageOff, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import {
  EXTERIOR_FACES,
  defaultVariantIdsForExteriorOption,
  exteriorFaceLabel,
  normalizeExteriorFaces,
  type ExteriorFaceCode,
  type ExteriorFaceSelection,
} from '@/lib/domain/exterior-wall';
import type { OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { visibleVariantGroups } from '@/lib/domain/preset';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';
import { VariantPicker } from './variant-picker';
import { cn } from '@/lib/utils';

interface Props {
  options: ProductOption[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  selectedOptionIds: string[];
  selectedVariantIds: string[];
  current: ExteriorFaceSelection[];
  initialFace: ExteriorFaceCode;
  onClose: () => void;
  onApply: (faces: ExteriorFaceSelection[]) => void;
}

export function ExteriorWallFacesDialog({
  options,
  variantGroups,
  variantChoices,
  selectedOptionIds,
  selectedVariantIds,
  current,
  initialFace,
  onClose,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const normalized = useMemo(
    () => normalizeExteriorFaces(current, options, variantGroups, variantChoices, selectedOptionIds, selectedVariantIds),
    [current, options, variantGroups, variantChoices, selectedOptionIds, selectedVariantIds]
  );
  const [faces, setFaces] = useState<ExteriorFaceSelection[]>(normalized);
  const [activeFace, setActiveFace] = useState<ExteriorFaceCode>(initialFace);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const active = faces.find((f) => f.face_code === activeFace);
  const activeOption = options.find((o) => o.id === active?.option_id) ?? options[0];
  const activeGroups = activeOption
    ? visibleVariantGroups(
        variantGroups.filter((g) => g.option_id === activeOption.id),
        variantChoices,
        active?.variant_choice_ids ?? []
      )
    : [];

  const replaceFace = (next: ExteriorFaceSelection) => {
    setFaces((prev) => EXTERIOR_FACES.map((face) => (face.code === next.face_code ? next : prev.find((x) => x.face_code === face.code) ?? next)));
  };

  const chooseProduct = (optionId: string) => {
    replaceFace({
      face_code: activeFace,
      option_id: optionId,
      variant_choice_ids: defaultVariantIdsForExteriorOption(optionId, variantGroups, variantChoices),
    });
  };

  const chooseVariant = (choiceId: string, groupId: string) => {
    if (!activeOption) return;
    const currentIds = active?.variant_choice_ids ?? [];
    const next = [
      ...currentIds.filter((id) => variantChoices.find((c) => c.id === id)?.group_id !== groupId),
      choiceId,
    ];
    replaceFace({ face_code: activeFace, option_id: activeOption.id, variant_choice_ids: next });
  };

  const copyToAll = () => {
    if (!activeOption) return;
    const variants = [...(active?.variant_choice_ids ?? [])];
    setFaces(EXTERIOR_FACES.map((face) => ({ face_code: face.code, option_id: activeOption.id, variant_choice_ids: [...variants] })));
  };

  const summary = (face: ExteriorFaceCode) => {
    const row = faces.find((f) => f.face_code === face);
    const option = options.find((o) => o.id === row?.option_id);
    if (!option) return '未選択';
    const variants = (row?.variant_choice_ids ?? [])
      .map((id) => variantChoices.find((c) => c.id === id)?.name)
      .filter(Boolean);
    return variants.length ? `${option.name} / ${variants.join('・')}` : option.name;
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(96vw,68rem)] rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="exterior-face-title"
      data-testid="exterior-wall-faces-dialog"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h2 id="exterior-face-title" className="text-xl">外壁を4面ごとに選ぶ</h2>
          <p className="mt-1 text-xs text-muted">正面・右側面・背面・左側面で、外壁材と色を個別に指定できます。</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[76vh] overflow-y-auto px-4 py-4 sm:px-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="外壁の面">
          {EXTERIOR_FACES.map((face) => (
            <button
              key={face.code}
              type="button"
              role="tab"
              aria-selected={activeFace === face.code}
              onClick={() => setActiveFace(face.code)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition',
                activeFace === face.code ? 'border-brown bg-ivory ring-2 ring-brown/40' : 'border-line bg-white hover:border-ink/40'
              )}
              data-testid={`exterior-face-tab-${face.code}`}
            >
              <span className="block text-sm font-semibold">{face.label}</span>
              <span className="mt-0.5 block line-clamp-2 text-[0.65rem] leading-snug text-muted">{summary(face.code)}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">{exteriorFaceLabel(activeFace)}の外壁材</h3>
            <p className="text-xs text-muted">商品を選んだあと、登録されている色・仕様を選べます。</p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={copyToAll} disabled={!activeOption}>
            <Copy className="size-4" aria-hidden="true" />
            この内容を4面すべてにコピー
          </Button>
        </div>

        {options.length > 0 ? (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {options.map((o) => {
              const selected = activeOption?.id === o.id;
              const price = o.price_on_request ? '別途見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => chooseProduct(o.id)}
                    aria-pressed={selected}
                    className={cn(
                      'flex h-full w-full flex-col overflow-hidden rounded-lg border text-left transition',
                      selected ? 'border-brown bg-ivory/70 ring-2 ring-brown/50' : 'border-line hover:border-ink/40'
                    )}
                    data-testid={`exterior-face-product-${o.code}`}
                  >
                    <span className="relative block aspect-[4/3] bg-sand">
                      {o.image_url ? (
                        <SmartImage src={o.image_url} alt={o.name} fill sizes="(min-width: 1024px) 14rem, 45vw" className="object-cover" />
                      ) : (
                        <span className="flex h-full flex-col items-center justify-center gap-1 text-[0.65rem] text-muted">
                          <ImageOff className="size-5" aria-hidden="true" />
                          商品画像 準備中
                        </span>
                      )}
                      {selected && (
                        <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-brown px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">
                          <Check className="size-3" aria-hidden="true" />
                          選択中
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col p-2">
                      {o.manufacturer && <span className="text-[0.6rem] text-muted">{o.manufacturer}</span>}
                      <span className="text-xs leading-snug font-semibold">{o.name}</span>
                      <span className="mt-auto pt-1.5 text-xs text-ink-soft">{price}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 rounded-lg bg-sand p-4 text-sm text-muted">外壁商品がまだ登録されていません。</p>
        )}

        {activeOption && activeGroups.length > 0 && (
          <VariantPicker
            groups={activeGroups}
            choices={variantChoices}
            selected={active?.variant_choice_ids ?? []}
            onChange={chooseVariant}
          />
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button type="button" variant="ghost" onClick={onClose}>キャンセル</Button>
        <Button type="button" onClick={() => onApply(faces)} disabled={faces.length !== 4} data-testid="exterior-faces-apply">
          4面の外壁を変更する
        </Button>
      </div>
    </dialog>
  );
}
