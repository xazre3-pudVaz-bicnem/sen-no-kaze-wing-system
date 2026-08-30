'use client';

import { useSyncExternalStore } from 'react';
import { ImageOff, Pencil } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { EXTERIOR_FACES } from '@/lib/domain/exterior-wall';
import type { OptionCategory, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';
import {
  getExteriorFaceDisplaysServerSnapshot,
  getExteriorFaceDisplaysSnapshot,
  subscribeExteriorFaceDisplays,
} from './exterior-face-display-store';

interface Props {
  categories: OptionCategory[];
  options: ProductOption[];
  selected: string[];
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/**
 * 「標準設備及び仕上げ表」。
 * エクセル（分類表）と同じく「ここまでが本体／下がオプション」の区分けを見せる。
 * 各項目はPC・スマホとも画像50%／文字50%で表示し、説明はカーソルで表示する。
 * 外壁は4面個別指定のため、画像を2×2、仕様を正面・右側面・背面・左側面の4行で表示する。
 */
export function EquipmentBoard({ categories, options, selected, readOnly, onPickCategory }: Props) {
  const selectedSet = new Set(selected);
  const exteriorDisplays = useSyncExternalStore(
    subscribeExteriorFaceDisplays,
    getExteriorFaceDisplaysSnapshot,
    getExteriorFaceDisplaysServerSnapshot
  );
  const shown = categories.filter((c) => c.code !== 'sitework' && options.some((o) => o.category_id === c.id));
  // 分類表の区分：本体（工場生産分に含む）とオプション
  const baseCats = shown.filter((c) => c.finish_level === 'shell');
  const optionCats = shown.filter((c) => c.finish_level !== 'shell');

  const tile = (cat: OptionCategory) => {
    const chosen = options.filter((o) => o.category_id === cat.id && selectedSet.has(o.id));
    const faceRows = EXTERIOR_FACES.map((face) => ({
      ...face,
      display: exteriorDisplays.find((row) => row.face_code === face.code) ?? null,
    }));
    const hasExteriorFaces =
      cat.code === 'exterior-wall' &&
      faceRows.every((row) => row.display && options.some((option) => option.id === row.display.option_id));
    const frontDisplay = faceRows.find((row) => row.code === 'front')?.display ?? null;
    const main = hasExteriorFaces
      ? options.find((option) => option.id === frontDisplay?.option_id) ?? null
      : chosen[0] ?? null;
    const extraCount = chosen.length - 1;

    return (
      <li key={cat.id} className="bg-white">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onPickCategory(cat.id)}
          title={hasExteriorFaces ? '正面・右側面・背面・左側面の外壁を個別に選択できます' : main?.description ?? cat.description ?? undefined}
          className="group grid h-full min-h-24 w-full grid-cols-2 items-stretch text-left transition-colors hover:bg-ivory disabled:cursor-not-allowed"
          data-testid={`equip-${cat.code}`}
        >
          <span className="block min-h-24 w-full p-1.5 sm:p-2">
            {hasExteriorFaces ? (
              <span className="grid h-full min-h-20 w-full grid-cols-2 grid-rows-2 gap-1">
                {faceRows.map((row) => (
                  <span key={row.code} className="relative block min-h-0 overflow-hidden rounded bg-sand">
                    {row.display?.image_url ? (
                      <SmartImage
                        src={row.display.image_url}
                        alt={`${row.label} ${row.display.option_name}`}
                        fill
                        sizes="(min-width: 1024px) 6.25vw, (min-width: 640px) 8.35vw, 12.5vw"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted">
                        <ImageOff className="size-3.5" aria-hidden="true" />
                      </span>
                    )}
                    <span className="absolute bottom-0 left-0 bg-ink/70 px-1 py-0.5 text-[0.48rem] leading-none text-white">
                      {row.label}
                    </span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="relative block h-full min-h-20 w-full overflow-hidden rounded bg-sand">
                {main?.image_url ? (
                  <SmartImage
                    src={main.image_url}
                    alt={main.name}
                    fill
                    sizes="(min-width: 1024px) 12.5vw, (min-width: 640px) 16.7vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full min-h-20 items-center justify-center text-muted">
                    <ImageOff className="size-5" aria-hidden="true" />
                  </span>
                )}
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-col justify-center p-2">
            <span className="flex items-center justify-between gap-1">
              <span className="truncate text-[0.65rem] font-semibold text-muted">{cat.name}</span>
              {!readOnly && <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
            </span>
            {hasExteriorFaces ? (
              <span className="mt-0.5 grid gap-0.5">
                {faceRows.map((row) => (
                  <span key={row.code} className="block line-clamp-1 text-[0.58rem] leading-tight text-ink">
                    <span className="font-semibold text-ink-soft">{row.label}：</span>
                    {row.display?.option_name ?? '選択なし'}
                    {(row.display?.variant_names.length ?? 0) > 0 && (
                      <span className="text-muted"> / {row.display?.variant_names.join('・')}</span>
                    )}
                  </span>
                ))}
                <span className="mt-0.5 block text-[0.62rem] text-ink-soft">4面個別指定</span>
              </span>
            ) : (
              <>
                <span className={cn('block text-xs leading-snug font-semibold', !main && 'text-muted')}>
                  {main ? main.name : '選択なし'}
                  {extraCount > 0 && <span className="ml-1 font-normal text-[0.65rem] text-muted">ほか {extraCount} 点</span>}
                </span>
                {main && (
                  <span className="block text-[0.7rem] text-ink-soft">
                    {main.price_on_request ? '別途見積' : main.price === 0 ? '標準' : `+${formatYen(main.price)}`}
                  </span>
                )}
              </>
            )}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section aria-labelledby="equipment-heading" className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 id="equipment-heading" className="text-sm font-semibold">
          標準設備及び仕上げ表
        </h2>
        <span className="text-[0.7rem] text-muted">項目をクリックして変更</span>
      </div>
      {baseCats.length > 0 && (
        <>
          <p className="bg-sand/50 px-4 py-1 text-[0.65rem] font-semibold text-ink-soft">本体（工場生産分に含む）</p>
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board">
            {baseCats.map(tile)}
          </ul>
        </>
      )}
      {optionCats.length > 0 && (
        <>
          <p className="border-t border-line bg-sand/50 px-4 py-1 text-[0.65rem] font-semibold text-ink-soft">オプション</p>
          <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4" data-testid="equipment-board-options">
            {optionCats.map(tile)}
          </ul>
        </>
      )}
    </section>
  );
}
