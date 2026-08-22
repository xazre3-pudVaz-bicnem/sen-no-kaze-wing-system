'use client';

import { ImageOff, Info } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import { previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_KEYS, VIEW_LABELS, type ProductOption, type ViewKey } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';

interface Props {
  previews: Record<ViewKey, PreviewResolution>;
  view: ViewKey;
  onViewChange: (v: ViewKey) => void;
  options: ProductOption[];
  modelName: string;
}

export function PreviewStage({ previews, view, onViewChange, options, modelName }: Props) {
  const labels = previewKeyLabels(options);
  const current = previews[view];
  const label = (k: string) => labels.get(k) ?? k;

  return (
    <section aria-label="完成イメージ" className="card overflow-hidden">
      <div className="relative aspect-[16/11] bg-sand" data-testid="preview-stage" data-preview-kind={current.kind} data-preview-src={current.layers[0]?.url ?? ''}>
        {current.layers.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <ImageOff className="size-8" aria-hidden="true" />
            <p className="text-sm">この組み合わせの{VIEW_LABELS[view]}画像は準備中です</p>
          </div>
        ) : (
          current.layers.map((l, i) => (
            <SmartImage
              key={l.url}
              src={l.url}
              alt={i === 0 ? `${modelName} ${VIEW_LABELS[view]}イメージ：${l.alt}` : ''}
              fill
              priority={i === 0 && view === 'exterior'}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className={cn('object-contain', view !== 'floorplan' && 'object-cover')}
              style={{ zIndex: l.z_index }}
            />
          ))
        )}
        <span className="absolute top-3 left-3 z-10 rounded-full bg-ink/70 px-3 py-1 text-xs text-white">
          {current.approximate ? '画像は完成イメージです（参考）' : '完成イメージ'}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
        <div role="tablist" aria-label="表示切替" className="flex gap-1">
          {VIEW_KEYS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => onViewChange(v)}
              className={cn('min-h-10 rounded-full px-3.5 text-sm font-medium transition-colors', view === v ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand')}
              data-testid={`view-${v}`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {(current.approximate || current.note) && (
        <div className="border-t border-line bg-sand/50 px-4 py-3 text-xs text-ink-soft" data-testid="preview-note">
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
