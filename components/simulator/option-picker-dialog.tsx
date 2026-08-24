'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ImageOff, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';
import { VariantPicker } from './variant-picker';
import { cn } from '@/lib/utils';

/** 選択項目ごとに、すでに選ばれているものか「標準」の選択肢を選ぶ */
function defaultVariants(groups: OptionVariantGroup[], choices: OptionVariantChoice[], current: string[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    const list = choices.filter((c) => c.group_id === g.id).sort((a, b) => a.sort_order - b.sort_order);
    if (list.length === 0) continue;
    const already = list.find((c) => current.includes(c.id));
    out.push((already ?? list.find((c) => c.kind === 'standard' || c.kind === 'fixed') ?? list[0]).id);
  }
  return out;
}

interface Props {
  category: OptionCategory;
  options: ProductOption[];
  selectedIds: string[];
  blocked: Map<string, string>;
  /** 商品の選択項目（壁色・扉色など） */
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  /** 選択中の選択肢 ID */
  selectedVariantIds: string[];
  onClose: () => void;
  /** 選択を確定（ラジオ: 1 件、チェック: 追加/解除の対象 ID 一覧）と、選ばれた選択肢 */
  onApply: (nextSelectedInCategory: string[], variantIds: string[]) => void;
}

/**
 * 見積項目をクリックしたときに開く商品選択ポップアップ。
 * カテゴリー内の商品を画像付きで並べ、「選択」→「変更」で確定する。
 */
export function OptionPickerDialog({
  category,
  options,
  selectedIds,
  blocked,
  variantGroups,
  variantChoices,
  selectedVariantIds,
  onClose,
  onApply,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<string[]>(options.filter((o) => selectedIds.includes(o.id)).map((o) => o.id));
  const single = category.selection_mode === 'single';

  /** 選ばれている商品の選択項目だけを出す。既定は「標準」の選択肢 */
  const activeGroups = variantGroups.filter((g) => picked.includes(g.option_id)).sort((a, b) => a.sort_order - b.sort_order);
  const [variants, setVariants] = useState<string[]>(() => defaultVariants(activeGroups, variantChoices, selectedVariantIds));

  const chooseVariant = (choiceId: string, groupId: string) => {
    setVariants((cur) => {
      const others = cur.filter((id) => variantChoices.find((c) => c.id === id)?.group_id !== groupId);
      return [...others, choiceId];
    });
  };

  const chooseProduct = (id: string) => {
    toggle(id);
    // 商品を替えたら、その商品の標準の選択肢に入れ替える
    const groups = variantGroups.filter((g) => g.option_id === id);
    setVariants((cur) => {
      const keep = cur.filter((cid) => {
        const g = variantChoices.find((c) => c.id === cid)?.group_id;
        return g && variantGroups.find((x) => x.id === g)?.option_id !== id;
      });
      return [...keep, ...defaultVariants(groups, variantChoices, cur)];
    });
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (single) return cur.includes(id) && !category.is_required ? [] : [id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(94vw,56rem)] rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="picker-title"
      data-testid="option-picker"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 id="picker-title" className="text-xl">{category.name}を選ぶ</h2>
          <p className="text-xs text-muted">
            {single ? '1つ選択' : '複数選択可'}
            {category.description ? `・${category.description}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <ul className="grid max-h-[60vh] gap-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((o) => {
          const checked = picked.includes(o.id);
          const reason = !checked ? blocked.get(o.id) : null;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => !reason && chooseProduct(o.id)}
                aria-pressed={checked}
                disabled={Boolean(reason)}
                className={cn(
                  'flex h-full w-full flex-col overflow-hidden rounded-xl border text-left transition',
                  checked ? 'border-brown shadow-soft' : 'border-line hover:border-ink/40',
                  reason && 'cursor-not-allowed opacity-60'
                )}
                data-testid={`pick-${o.code}`}
              >
                <span className="relative block aspect-[4/3] bg-sand">
                  {o.image_url ? (
                    <SmartImage src={o.image_url} alt={o.name} fill sizes="(min-width: 1024px) 18rem, 50vw" className="object-cover" />
                  ) : (
                    <span className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted">
                      <ImageOff className="size-6" aria-hidden="true" />
                      商品画像 準備中
                    </span>
                  )}
                  {checked && (
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-brown px-2 py-0.5 text-xs font-semibold text-white">
                      <Check className="size-3" aria-hidden="true" />
                      選択中
                    </span>
                  )}
                </span>
                <span className="flex flex-1 flex-col p-3">
                  {(o.manufacturer || o.highlight) && (
                    <span className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[0.65rem]">
                      {o.manufacturer && <span className="text-muted">{o.manufacturer}</span>}
                      {o.highlight && <span className="rounded-full bg-sand px-1.5 py-0.5 text-forest">{o.highlight}</span>}
                    </span>
                  )}
                  <span className="font-semibold">{o.name}</span>
                  {o.size_note && <span className="mt-0.5 text-[0.7rem] text-muted">{o.size_note}</span>}
                  {o.description && <span className="mt-0.5 text-xs text-ink-soft">{o.description}</span>}
                  <span className="mt-auto pt-2 text-sm">{o.price_on_request ? '別途見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`}</span>
                  {o.list_price ? <span className="text-[0.65rem] text-muted">メーカー参考価格 {formatYen(o.list_price)}</span> : null}
                  {reason && <span className="mt-1 text-xs text-warn">{reason}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {activeGroups.length > 0 && (
        <div className="max-h-[40vh] overflow-y-auto px-6 pb-4">
          <VariantPicker groups={activeGroups} choices={variantChoices} selected={variants} onChange={chooseVariant} />
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button type="button" onClick={() => onApply(picked, variants)} data-testid="picker-apply">
          変更する
        </Button>
      </div>
    </dialog>
  );
}
