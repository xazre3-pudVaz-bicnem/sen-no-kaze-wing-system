'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MapPin, X } from 'lucide-react';
import { BLOCKS, BLOCK_PREFECTURES, PREFECTURES, type RegionFilterValue } from '@/lib/domain/address';
import { Select } from '@/components/ui';

/**
 * ブロック → 都道府県 → 市町村 の 3 段階の抽出（先方要望 2026-08-28）。
 * 選ぶとその場で URL パラメータに反映され、一覧が絞り込まれる。
 * 市町村の候補は「いま表示できるデータに実在する市町村」だけを出す。
 */
export function RegionFilter({ value, cities, total, matched }: { value: RegionFilterValue; cities: string[]; total: number; matched: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const apply = (patch: Partial<RegionFilterValue>) => {
    const next = { ...value, ...patch };
    // 上位を変えたら下位はリセットする
    if ('block' in patch) {
      next.pref = null;
      next.city = null;
    }
    if ('pref' in patch) next.city = null;
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries({ block: next.block, pref: next.pref, city: next.city })) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    router.push(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false });
  };

  const prefOptions = value.block ? BLOCK_PREFECTURES[value.block as keyof typeof BLOCK_PREFECTURES] ?? PREFECTURES : PREFECTURES;
  const active = Boolean(value.block || value.pref || value.city);

  return (
    <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm" data-testid="region-filter">
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted">
        <MapPin className="size-3.5" aria-hidden="true" />
        地域で抽出
      </span>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        ブロック
        <Select value={value.block ?? ''} onChange={(e) => apply({ block: e.target.value || null })} aria-label="ブロックで抽出" className="min-w-[8rem] py-1 text-sm text-ink" data-testid="filter-block">
          <option value="">すべて</option>
          {BLOCKS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        都道府県
        <Select value={value.pref ?? ''} onChange={(e) => apply({ pref: e.target.value || null })} aria-label="都道府県で抽出" className="min-w-[8rem] py-1 text-sm text-ink" data-testid="filter-pref">
          <option value="">すべて</option>
          {prefOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        市町村
        <Select value={value.city ?? ''} onChange={(e) => apply({ city: e.target.value || null })} aria-label="市町村で抽出" className="min-w-[9rem] py-1 text-sm text-ink" data-testid="filter-city">
          <option value="">すべて</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </label>
      <span className="ml-auto text-xs text-muted" data-testid="filter-count">
        {active ? (
          <>
            <strong className="font-semibold text-ink">{matched}</strong> 件／全 {total} 件
            <button type="button" onClick={() => apply({ block: null, pref: null, city: null })} className="ml-2 inline-flex items-center gap-0.5 text-brown underline underline-offset-2 hover:text-ink" data-testid="filter-clear">
              <X className="size-3" aria-hidden="true" />
              解除
            </button>
          </>
        ) : (
          <>全 {total} 件</>
        )}
      </span>
    </div>
  );
}
