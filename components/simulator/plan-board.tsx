'use client';

import { useState } from 'react';
import { ImageOff, MousePointerClick } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import type { OptionCategory, PreviewHotspot, PreviewImageRule } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Elevation {
  url: string;
  label: string;
  alt: string;
}

interface Props {
  /** 表示中の平面図（resolvePreview の結果） */
  plan: PreviewResolution;
  /** 平面図として採用されたルール（ホットスポットの紐付け元） */
  planRule: PreviewImageRule | null;
  hotspots: PreviewHotspot[];
  categories: OptionCategory[];
  elevations: Elevation[];
  perspective: { url: string; alt: string } | null;
  readOnly: boolean;
  onPickCategory: (categoryId: string) => void;
}

/**
 * 先方モックアップの左半分：平面図（クリック可）＋立面図4面。
 * 平面図の設備をクリックすると、そのカテゴリーの商品選択ポップアップが開く（変更方法②）。
 */
export function PlanBoard({ plan, planRule, hotspots, categories, elevations, perspective, readOnly, onPickCategory }: Props) {
  const [showHints, setShowHints] = useState(true);
  const planImage = plan.layers[0];
  const spots = planRule ? hotspots.filter((h) => h.rule_id === planRule.id) : [];
  const catCode = (id: string) => categories.find((c) => c.id === id)?.code ?? id;

  return (
    <div className="space-y-4">
      {/* 平面図 */}
      <figure className="card overflow-hidden" data-testid="plan-board">
        <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold">平面図</span>
          {spots.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHints((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
              aria-pressed={showHints}
            >
              <MousePointerClick className="size-3.5" aria-hidden="true" />
              {showHints ? 'クリック領域を隠す' : 'クリック領域を表示'}
            </button>
          )}
        </figcaption>
        <div className="relative aspect-[4/3] bg-white" data-testid="plan-image" data-plan-src={planImage?.url ?? ''}>
          {planImage ? (
            <SmartImage src={planImage.url} alt={planImage.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-contain p-2" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
              <ImageOff className="size-7" aria-hidden="true" />
              <p className="text-sm">この構成の平面図は準備中です</p>
            </div>
          )}
          {planImage &&
            spots.map((h) => (
              <button
                key={h.id}
                type="button"
                disabled={readOnly}
                onClick={() => onPickCategory(h.category_id)}
                title={`${h.label}を変更する`}
                aria-label={`${h.label}を変更する`}
                data-testid={`hotspot-${catCode(h.category_id)}`}
                className={cn(
                  'absolute rounded transition-colors',
                  showHints ? 'border-2 border-brown/70 bg-brown/10 hover:bg-brown/25' : 'border border-transparent hover:border-brown/60 hover:bg-brown/10',
                  readOnly && 'cursor-not-allowed'
                )}
                style={{ left: `${h.x}%`, top: `${h.y}%`, width: `${h.w}%`, height: `${h.h}%` }}
              >
                {showHints && (
                  <span className="pointer-events-none absolute -top-2 left-0 rounded bg-brown px-1.5 py-0.5 text-[0.6rem] whitespace-nowrap text-white">
                    {h.label}
                  </span>
                )}
              </button>
            ))}
        </div>
        {plan.approximate && (
          <p className="border-t border-line bg-ivory px-4 py-2 text-xs text-ink-soft">
            選択中の仕様に完全一致する平面図がないため、最も近い図面を表示しています。
          </p>
        )}
      </figure>

      {/* 立面図（4面） */}
      {elevations.length > 0 && (
        <figure className="card overflow-hidden">
          <figcaption className="border-b border-line px-4 py-2.5 text-sm font-semibold">
            立面図（4面）
            <span className="ml-2 text-xs font-normal text-muted">クリックすると外壁を選べます</span>
          </figcaption>
          <ul className="grid grid-cols-2 gap-3 bg-white p-3">
            {elevations.map((e) => {
              const wallCat = categories.find((c) => c.code === 'exterior-wall');
              return (
                <li key={e.url}>
                  <button
                    type="button"
                    disabled={readOnly || !wallCat}
                    onClick={() => wallCat && onPickCategory(wallCat.id)}
                    className="group block w-full text-left"
                    data-testid={`elevation-${e.label}`}
                  >
                    <span className="relative block aspect-[2/1] overflow-hidden rounded border border-line bg-white transition-colors group-hover:border-brown">
                      <SmartImage src={e.url} alt={e.alt} fill sizes="(min-width: 1024px) 22vw, 45vw" className="object-contain p-1.5" />
                    </span>
                    <span className="mt-1 block text-[0.7rem] text-muted">{e.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </figure>
      )}

      {/* 外観パース（モックアップ右上） */}
      {perspective && (
        <figure className="card overflow-hidden">
          <figcaption className="border-b border-line px-4 py-2.5 text-sm font-semibold">外観パース</figcaption>
          <div className="relative aspect-[16/9] bg-sand">
            <SmartImage src={perspective.url} alt={perspective.alt} fill sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
          </div>
        </figure>
      )}

      {spots.length === 0 && planImage && (
        <p className="text-xs text-muted">
          この図面にはクリック領域が未設定です。右の「標準設備及び仕上げ表」または下の御見積書からも変更できます。
        </p>
      )}
    </div>
  );
}
