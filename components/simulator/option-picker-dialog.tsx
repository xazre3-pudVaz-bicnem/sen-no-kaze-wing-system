'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ImageOff, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Props {
  category: OptionCategory;
  options: ProductOption[];
  selectedIds: string[];
  blocked: Map<string, string>;
  onClose: () => void;
  /** 選択を確定（ラジオ: 1 件、チェック: 追加/解除の対象 ID 一覧） */
  onApply: (nextSelectedInCategory: string[]) => void;
}

/**
 * 見積項目をクリックしたときに開く商品選択ポップアップ。
 * カテゴリー内の商品を画像付きで並べ、「選択」→「変更」で確定する。
 */
export function OptionPickerDialog({ category, options, selectedIds, blocked, onClose, onApply }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<string[]>(options.filter((o) => selectedIds.includes(o.id)).map((o) => o.id));
  const single = category.selection_mode === 'single';

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
                onClick={() => !reason && toggle(o.id)}
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
                  <span className="font-semibold">{o.name}</span>
                  {o.description && <span className="mt-0.5 text-xs text-ink-soft">{o.description}</span>}
                  <span className="mt-auto pt-2 text-sm">{o.price_on_request ? '別途見積' : o.price === 0 ? '追加費用なし' : `+${formatYen(o.price)}`}</span>
                  {reason && <span className="mt-1 text-xs text-warn">{reason}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button type="button" onClick={() => onApply(picked)} data-testid="picker-apply">
          変更する
        </Button>
      </div>
    </dialog>
  );
}
