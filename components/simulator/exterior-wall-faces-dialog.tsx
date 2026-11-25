'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import {
  EXTERIOR_FACES,
  defaultVariantIdsForExteriorOption,
  exteriorFaceLabel,
  normalizeExteriorFaces,
  type ExteriorFaceCode,
  type ExteriorFaceSelection,
} from '@/lib/domain/exterior-wall';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { visibleVariantGroups } from '@/lib/domain/preset';
import { Button } from '@/components/ui';
import { ProductList } from './product-list';
import { productChoicePoints } from '@/lib/domain/simulator-product-choice-guide';
import { simulatorCardPricePresentation } from '@/lib/domain/simulator-card-price-presentation';
import type { SimulatorCardDelta } from '@/lib/domain/simulator-card-price-delta';
import { VariantPicker } from './variant-picker';
import { cn } from '@/lib/utils';

interface Props {
  category: OptionCategory;
  /** 現在値の復元に使う全商品。保存済みlegacy商品も含める。 */
  options: ProductOption[];
  /** 新たに選択できる商品。未指定時は options と同じ。 */
  selectableOptions?: ProductOption[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  selectedOptionIds: string[];
  baselineSelectedIds: string[];
  selectedVariantIds: string[];
  current: ExteriorFaceSelection[];
  initialFace: ExteriorFaceCode;
  onClose: () => void;
  onApply: (faces: ExteriorFaceSelection[]) => void;
  getCandidateFaceDelta?: (face: ExteriorFaceCode, faces: ExteriorFaceSelection[]) => SimulatorCardDelta;
}

export function ExteriorWallFacesDialog({
  category,
  options,
  selectableOptions,
  variantGroups,
  variantChoices,
  selectedOptionIds,
  baselineSelectedIds,
  selectedVariantIds,
  current,
  initialFace,
  onClose,
  onApply,
  getCandidateFaceDelta,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const availableOptions = selectableOptions ?? options;
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

  const candidateFaceSelection = (optionId: string): ExteriorFaceSelection[] =>
    EXTERIOR_FACES.map((face) => face.code === activeFace
      ? { face_code: face.code, option_id: optionId,
          variant_choice_ids: defaultVariantIdsForExteriorOption(optionId, variantGroups, variantChoices) }
      : faces.find((row) => row.face_code === face.code) ??
        { face_code: face.code, option_id: optionId, variant_choice_ids: [] });
  const candidateFacePrice = (optionId: string) => getCandidateFaceDelta
    ? simulatorCardPricePresentation(getCandidateFaceDelta(activeFace, candidateFaceSelection(optionId)))
    : null;
  const activeFacePrice = getCandidateFaceDelta
    ? simulatorCardPricePresentation(getCandidateFaceDelta(activeFace, faces))
    : null;

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
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[min(96vw,68rem)] rounded-xl p-0 shadow-lift backdrop:bg-ink/40"
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
        <section className="mb-3 rounded-lg border border-line bg-ivory/55 px-3 py-2.5" aria-label="外壁の選ぶポイント" data-testid="exterior-wall-choice-guide">
          <h3 className="text-xs font-semibold text-ink">選ぶポイント</h3>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {productChoicePoints(category.code).map((point) => (
              <li key={point} className="rounded-md border border-line/70 bg-white px-2 py-1 text-[0.7rem] text-ink-soft">{point}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-[0.65rem] leading-relaxed text-muted">比較するときの目安です。実際の仕様は商品詳細やメーカー資料でご確認ください。</p>
        </section>
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

        <div className="mt-3">
          <ProductList
            category={category}
            options={availableOptions}
            selectedIds={activeOption ? [activeOption.id] : []}
            baselineSelectedIds={baselineSelectedIds}
            getPriceLabel={(option) =>
              candidateFacePrice(option.id)?.label ?? (option.price_on_request
                ? '別途見積'
                : option.price === 0
                  ? '追加費用なし'
                  : `+${formatYen(option.price)}`)
            }
            getPriceTone={getCandidateFaceDelta ? (option) => candidateFacePrice(option.id)?.tone ?? 'neutral' : undefined}
            onOpenProduct={(option) => chooseProduct(option.id)}
            emptyMessage="現在選択できる外壁商品はありません"
            actionLabel="選ぶ"
          />
        </div>

        {getCandidateFaceDelta && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-ivory/55 px-3 py-2 text-xs" data-testid="exterior-face-total-delta">
            <span>この面の基本プランとの差額（税込）</span>
            <strong className={cn('text-sm', activeFacePrice?.tone === 'increase' ? 'text-red-700' : activeFacePrice?.tone === 'decrease' ? 'text-blue-700' : 'text-ink')} data-price-tone={activeFacePrice?.tone ?? 'neutral'}>
              {activeFacePrice?.label ?? '金額確認中'}
            </strong>
          </div>
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
