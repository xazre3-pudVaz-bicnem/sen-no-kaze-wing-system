'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImageOff, Plus, Search, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { SmartImage } from '@/components/ui/smart-image';
import { Button } from '@/components/ui';

export interface CatalogPickerItem {
  code: string;
  name: string;
  category: string;
  price: number;
  price_on_request: boolean;
  image_url: string | null;
  manufacturer: string | null;
  unit?: string | null;
}

/**
 * 見積書の行へ商品台帳から商品を選ぶポップアップ。
 * 追加モードでは商品をクリックすると新しい行を追加し、置換モードでは現在の行へ商品情報を反映する。
 * 自由入力は従来どおり残し、必要なときだけ商品台帳を呼び出せる。
 */
export function CatalogPickerDialog<K extends string>({
  catalog,
  kinds,
  kindLabels,
  onPick,
  onClose,
  mode = 'add',
}: {
  catalog: CatalogPickerItem[];
  /** 追加・置換できる区分。置換時は現在行の区分だけを渡す */
  kinds: K[];
  kindLabels: Record<string, string>;
  onPick: (item: CatalogPickerItem, kind: K) => void;
  onClose: () => void;
  mode?: 'add' | 'replace';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<K>((kinds.includes('installation' as K) ? ('installation' as K) : kinds[0]) as K);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((c) => `${c.name} ${c.category} ${c.manufacturer ?? ''}`.toLowerCase().includes(needle));
  }, [catalog, q]);

  /** カテゴリーごとにまとめて表示する */
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogPickerItem[]>();
    for (const c of filtered) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(94vw,44rem)] rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="catalog-picker-title"
      data-testid="catalog-picker"
    >
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="catalog-picker-title" className="text-lg">
              {mode === 'replace' ? '既存商品から選択' : '商品台帳から行を追加'}
            </h2>
            <p className="text-xs text-muted">
              {mode === 'replace'
                ? '商品をクリックすると、選択中の見積行へ商品情報を反映します。'
                : '商品をクリックすると見積書に行が追加されます（続けて追加できます）'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="商品名・カテゴリー・メーカーで検索"
              className="w-full rounded-lg border border-line py-1.5 pr-3 pl-8 text-sm"
              data-testid="catalog-picker-search"
            />
          </label>
          {mode === 'add' && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              追加する区分
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as K)}
                className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink"
                data-testid="catalog-picker-kind"
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {kindLabels[k] ?? k}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
        {grouped.map(([category, list]) => (
          <section key={category} className="mb-3">
            <h3 className="sticky top-0 bg-white py-1 text-xs font-semibold text-muted">{category}</h3>
            <ul className="divide-y divide-line/70">
              {list.map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(c, kind);
                      if (mode === 'replace') {
                        onClose();
                        return;
                      }
                      setAdded((n) => n + 1);
                    }}
                    className="flex w-full items-center gap-3 py-2 text-left hover:bg-ivory"
                    data-testid={`catalog-pick-${c.code}`}
                  >
                    <span className="relative block size-10 shrink-0 overflow-hidden rounded bg-sand">
                      {c.image_url ? (
                        <SmartImage src={c.image_url} alt="" fill sizes="40px" className="object-cover" />
                      ) : (
                        <span className="flex h-full items-center justify-center text-muted"><ImageOff className="size-4" aria-hidden="true" /></span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.name}</span>
                      {c.manufacturer && <span className="block text-[0.65rem] text-muted">{c.manufacturer}</span>}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-soft">
                      {c.price_on_request ? '別途見積' : formatYen(c.price)}
                    </span>
                    {mode === 'replace' ? (
                      <Check className="size-4 shrink-0 text-[#315745]" aria-hidden="true" />
                    ) : (
                      <Plus className="size-4 shrink-0 text-brown" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {grouped.length === 0 && <p className="py-8 text-center text-sm text-muted">該当する商品がありません</p>}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        <p className="text-xs text-muted" data-testid="catalog-picker-added">
          {mode === 'replace'
            ? '選択した商品を現在の行に反映します。'
            : added > 0
              ? `${added} 行を追加しました`
              : ''}
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </dialog>
  );
}
