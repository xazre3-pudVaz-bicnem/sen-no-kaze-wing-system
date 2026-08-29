'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Info } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import { previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_LABELS, type ProductOption, type ViewKey } from '@/lib/domain/types';

/** 完成イメージのタブ（先方指示：外観・室内・その他。平面図は上の図面欄にあるため出さない） */
const TABS: { key: ViewKey; label: string }[] = [
  { key: 'exterior', label: '外観' },
  { key: 'interior', label: '室内' },
  { key: 'water', label: 'その他' },
];
const TAB_LABEL = new Map(TABS.map((t) => [t.key, t.label]));
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Props {
  previews: Record<ViewKey, PreviewResolution>;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  options: ProductOption[];
  modelName: string;
}

interface Frame {
  key: string;
  view: ViewKey;
  layers: PreviewResolution['layers'];
}

/**
 * 完成イメージ。画像の切り替えは前の画像を残したままクロスフェードする
 * （解決ロジックは lib/domain/preview.ts のまま）。
 */
export function PreviewStage({ previews, view, onViewChange, options, modelName }: Props) {
  const labels = previewKeyLabels(options);
  const current = previews[view];
  const label = (k: string) => labels.get(k) ?? k;
  const frameKey = `${view}:${current.layers.map((l) => l.url).join('|')}`;

  // 直前のフレームを下に残し、新しいフレームを上でフェードインさせる（props 変化に応じた派生 state）
  const [track, setTrack] = useState<{ key: string; frame: Frame; prev: Frame | null }>({
    key: frameKey,
    frame: { key: frameKey, view, layers: current.layers },
    prev: null,
  });
  if (track.key !== frameKey) {
    setTrack({ key: frameKey, frame: { key: frameKey, view, layers: current.layers }, prev: track.frame });
  }
  const frames = track.prev ? [track.prev, track.frame] : [track.frame];

  return (
    <section aria-label="完成イメージ" className="overflow-hidden bg-white lg:rounded-none">
      <div className="relative aspect-[3/2] bg-sand" data-testid="preview-stage" data-preview-kind={current.kind} data-preview-src={current.layers[0]?.url ?? ''}>
        {current.layers.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <ImageOff className="size-8" aria-hidden="true" />
            <p className="text-sm">この組み合わせの{TAB_LABEL.get(view) ?? VIEW_LABELS[view]}画像は準備中です</p>
          </div>
        )}
        {frames.map((f, fi) => {
          const isCurrent = fi === frames.length - 1;
          return (
            <div key={f.key} className="absolute inset-0" aria-hidden={!isCurrent}>
              {f.layers.map((l, i) => (
                <SmartImage
                  key={l.url}
                  src={l.url}
                  alt={isCurrent && i === 0 ? `${modelName} ${VIEW_LABELS[f.view]}イメージ：${l.alt}` : ''}
                  fill
                  priority={isCurrent && i === 0}
                  sizes="(min-width: 1024px) 62vw, 100vw"
                  className={cn(f.view === 'floorplan' ? 'object-contain' : 'object-cover', isCurrent && track.prev ? 'animate-[fadeIn_.7s_ease-out_both]' : '')}
                  style={{ zIndex: l.z_index }}
                />
              ))}
            </div>
          );
        })}
        <span className="absolute top-4 left-4 z-10 rounded-full bg-ink/70 px-3 py-1 text-xs text-white">
          {current.approximate ? '画像は完成イメージです（参考）' : '完成イメージ'}
        </span>
        {/* 横スクロール（先方指示：ボタン選択とスクロールの両方で切り替えられるように） */}
        <button
          type="button"
          onClick={() => {
            const i = TABS.findIndex((t) => t.key === view);
            onViewChange(TABS[(i - 1 + TABS.length) % TABS.length].key);
          }}
          aria-label="前の完成イメージへ"
          data-testid="preview-prev"
          className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-ink shadow-soft transition hover:bg-white"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            const i = TABS.findIndex((t) => t.key === view);
            onViewChange(TABS[(i + 1) % TABS.length].key);
          }}
          aria-label="次の完成イメージへ"
          data-testid="preview-next"
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-ink shadow-soft transition hover:bg-white"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <div role="tablist" aria-label="表示切替" className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={view === t.key}
              onClick={() => onViewChange(t.key)}
              className={cn('min-h-10 rounded-full px-4 text-sm font-medium transition-colors', view === t.key ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand')}
              data-testid={`view-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {(current.approximate || current.note) && (
        <div className="border-t border-line bg-ivory px-4 py-3 text-xs text-ink-soft" data-testid="preview-note">
          <p className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
            <span>
              {current.kind === 'none' && '選択中の仕様に対応する画像がまだ登録されていません。'}
              {current.kind === 'nearest' && '選択中の仕様に完全一致する画像がないため、最も近い画像を表示しています。'}
              {current.missing_keys.length > 0 && (
                <>
                  <span className="font-semibold">画像に未反映：</span>
                  {current.missing_keys.map(label).join('・')}。
                </>
              )}
              {current.extra_keys.length > 0 && (
                <>
                  <span className="font-semibold">画像のみに写っている設備：</span>
                  {current.extra_keys.map(label).join('・')}。
                </>
              )}
              {current.note && <span className="text-muted">（{current.note}）</span>}
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
