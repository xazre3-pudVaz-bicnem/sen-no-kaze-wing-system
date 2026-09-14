'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ImageOff, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, OptionVariantChoice, OptionVariantGroup, ProductOption } from '@/lib/domain/types';
import { pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';
import { ProductList } from './product-list';
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
 * 開いた直後は、選択済み商品があっても必ず共通商品一覧を表示する。
 * 商品カードまたは「詳しく見る」を押したら、その商品を選択対象として詳細・仕様選択へ進む。
 * 「他の商品から選ぶ」でいつでも一覧に戻れる。
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
  /** 商品選択ポップアップは、現在の選択有無にかかわらず必ず一覧から開始する */
  const [browsing, setBrowsing] = useState(true);

  /** 選ばれている商品の選択項目。表示条件（壁プラン→壁色など）を満たすものだけ出す */
  const pickedGroups = variantGroups.filter((g) => picked.includes(g.option_id)).sort((a, b) => a.sort_order - b.sort_order);
  const [variants, setVariants] = useState<string[]>(() =>
    pruneHiddenVariantChoices(pickedGroups, variantChoices, defaultVariants(pickedGroups, variantChoices, selectedVariantIds))
  );
  const activeGroups = visibleVariantGroups(pickedGroups, variantChoices, variants);

  const chooseVariant = (choiceId: string, groupId: string) => {
    setVariants((cur) => {
      const others = cur.filter((id) => variantChoices.find((c) => c.id === id)?.group_id !== groupId);
      const next = [...others, choiceId];
      // 表示条件を満たさなくなった項目（例：全面ホワイトに戻したときの壁色）の選択は取り除き、
      // 新たに表示された項目には標準の選択肢を入れる
      const visible = visibleVariantGroups(pickedGroups, variantChoices, next);
      const withDefaults = [...next, ...defaultVariants(visible, variantChoices, next).filter((id) => !next.includes(id))];
      return pruneHiddenVariantChoices(pickedGroups, variantChoices, withDefaults);
    });
  };

  const toggle = (id: string) => {
    setPicked((cur) => {
      if (single) return cur.includes(id) && !category.is_required ? [] : [id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };

  const chooseProduct = (id: string) => {
    const wasPicked = picked.includes(id);

    // 「詳しく見る」は選択解除ではなく詳細表示の入口。
    // 未選択の商品だけ選択対象へ加え、すでに選択中の商品はそのまま保持する。
    if (!wasPicked) toggle(id);

    // 商品を替えたら、その商品の標準の選択肢に入れ替える。
    // すでに選択中の商品では現在の仕様を優先して保持する。
    const groups = variantGroups.filter((g) => g.option_id === id);
    setVariants((cur) => {
      if (wasPicked) return cur;
      const keep = cur.filter((cid) => {
        const g = variantChoices.find((c) => c.id === cid)?.group_id;
        return g && variantGroups.find((x) => x.id === g)?.option_id !== id;
      });
      const next = [...keep, ...defaultVariants(groups, variantChoices, cur)];
      return pruneHiddenVariantChoices(variantGroups, variantChoices, next);
    });

    // カード全体／「詳しく見る」のどちらからでも詳細・仕様選択へ進む。
    setBrowsing(false);
  };

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const pickedOptions = options.filter((o) => picked.includes(o.id));
  const priceLabel = (o: ProductOption) =>
    o.price_on_request ? '別途見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(96vw,56rem)] rounded-xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="picker-title"
      data-testid="option-picker"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
        <div>
          <h2 id="picker-title" className="text-lg">{category.name}を選ぶ</h2>
          <p className="text-xs text-muted">
            {single ? '1つ選択' : '複数選択可'}
            {category.description ? `・${category.description}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {/* 本文はスクロール 1 本。商品一覧 → 色・仕様の順にそのまま下へ流れる */}
      <div className="max-h-[74vh] overflow-y-auto px-4 py-3 sm:px-5">
        {!browsing && pickedOptions.length > 0 ? (
          /* 選択済み：参考例（Housetec）の「ポップUP画面」のように、選択中の商品を大きな写真で見せる */
          <div className="space-y-3">
            <div className={cn('grid gap-3', pickedOptions.length > 1 && 'sm:grid-cols-2')}>
              {pickedOptions.map((o) => (
                <div key={o.id} className="overflow-hidden rounded-xl border-2 border-brown bg-ivory/60" data-testid="picker-selected">
                  <span className={cn('relative block bg-sand', pickedOptions.length > 1 ? 'aspect-[4/3]' : 'aspect-[16/9]')}>
                    {o.image_url ? (
                      <SmartImage src={o.image_url} alt={o.name} fill sizes="(min-width: 640px) 52rem, 94vw" className="object-cover" />
                    ) : (
                      <span className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted">
                        <ImageOff className="size-6" aria-hidden="true" />
                        商品画像 準備中
                      </span>
                    )}
                    <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-brown px-2 py-0.5 text-xs font-semibold text-white">
                      <Check className="size-3" aria-hidden="true" />
                      選択中
                    </span>
                  </span>
                  <div className="flex items-center gap-3 p-3">
                    <span className="min-w-0 flex-1">
                      {o.manufacturer && <span className="block text-[0.65rem] text-muted">{o.manufacturer}</span>}
                      <span className="block text-sm leading-snug font-semibold">{o.name}</span>
                      {o.size_note && <span className="block text-[0.7rem] text-muted">{o.size_note}</span>}
                      <span className="mt-0.5 block text-xs text-ink-soft">{priceLabel(o)}</span>
                    </span>
                    {(!single || !category.is_required) && (
                      <button
                        type="button"
                        onClick={() => toggle(o.id)}
                        className="btn-ghost btn-sm shrink-0 text-warn"
                        aria-label={`${o.name} を外す`}
                        data-testid={`picker-remove-${o.code}`}
                      >
                        外す
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <button type="button" onClick={() => setBrowsing(true)} className="btn-secondary btn-sm" data-testid="picker-expand">
                <ChevronLeft className="size-4" aria-hidden="true" />
                {single ? '他の商品から選ぶ' : '商品を追加・変更する'}
              </button>
            </div>
          </div>
        ) : (
          <ProductList
            category={category}
            options={options}
            selectedIds={picked}
            getPriceLabel={priceLabel}
            getDisabledReason={(option) => (picked.includes(option.id) ? null : blocked.get(option.id) ?? null)}
            onOpenProduct={(option) => chooseProduct(option.id)}
          />
        )}

        {/* 色・仕様（サイズ）の選択。同じスクロールの中でそのまま下に続く */}
        {activeGroups.length > 0 && (
          <VariantPicker groups={activeGroups} choices={variantChoices} selected={variants} onChange={chooseVariant} />
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
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
