'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Info } from 'lucide-react';
import type { PreviewResolution } from '@/lib/domain/preview';
import { previewKeyLabels } from '@/lib/domain/preview';
import { VIEW_LABELS, type ProductOption, type ViewKey } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { cn } from '@/lib/utils';
import { useSimulatorCaseImages } from './case-images-context';

type DisplayTabKey = ViewKey | 'case';

type SequenceItem =
  | { kind: 'view'; key: ViewKey }
  | { kind: 'case'; index: number };

interface DisplayTab {
  key: DisplayTabKey;
  label: string;
}

/** 完成イメージのタブ。施工事例は登録画像がある場合だけ室内とその他の間に表示する。 */
const BASE_TABS: DisplayTab[] = [
  { key: 'exterior', label: '外観' },
  { key: 'interior', label: '室内' },
  { key: 'water', label: 'その他' },
];
const TAB_LABEL = new Map(BASE_TABS.map((t) => [t.key, t.label]));

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
 * 完成イメージ。外観・室内・施工事例・その他を1本の順番として扱い、
 * PCの左右ボタンとスマホの横スワイプで同じ順番に移動する。
 */
export function PreviewStage({ previews, view, onViewChange, options, modelName }: Props) {
  const caseImages = useSimulatorCaseImages();
  const labels = previewKeyLabels(options);
  const current = previews[view];
  const label = (k: string) => labels.get(k) ?? k;
  const frameKey = `${view}:${current.layers.map((l) => l.url).join('|')}`;
  const [showCase, setShowCase] = useState(false);
  const [caseIndex, setCaseIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const tabs: DisplayTab[] = caseImages.length > 0
    ? [BASE_TABS[0], BASE_TABS[1], { key: 'case', label: '施工事例' }, BASE_TABS[2]]
    : BASE_TABS;
  const activeTab: DisplayTabKey = showCase ? 'case' : view;

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

  const selectTab = (key: DisplayTabKey) => {
    if (key === 'case') {
      setCaseIndex(0);
      setShowCase(true);
      return;
    }
    setShowCase(false);
    onViewChange(key);
  };

  const sequence: SequenceItem[] = [
    { kind: 'view', key: 'exterior' },
    { kind: 'view', key: 'interior' },
    ...caseImages.map((_, index) => ({ kind: 'case' as const, index })),
    { kind: 'view', key: 'water' },
  ];

  const activeSequenceIndex = showCase
    ? Math.min(2 + caseIndex, sequence.length - 1)
    : view === 'interior'
      ? 1
      : view === 'water'
        ? sequence.length - 1
        : 0;

  const selectSequenceItem = (item: SequenceItem) => {
    if (item.kind === 'case') {
      setCaseIndex(item.index);
      setShowCase(true);
      return;
    }
    setShowCase(false);
    onViewChange(item.key);
  };

  const moveSequence = (direction: 1 | -1) => {
    if (sequence.length === 0) return;
    const nextIndex = (activeSequenceIndex + direction + sequence.length) % sequence.length;
    selectSequenceItem(sequence[nextIndex]);
  };

  const currentCase = caseImages[caseIndex] ?? null;

  return (
    <section aria-label="完成イメージ" className="overflow-hidden bg-white lg:rounded-none">
      <div
        className="relative aspect-[3/2] touch-pan-y bg-sand"
        data-testid="preview-stage"
        data-preview-kind={showCase ? 'case' : current.kind}
        data-preview-src={showCase ? currentCase?.url ?? '' : current.layers[0]?.url ?? ''}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
        }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
          moveSequence(dx < 0 ? 1 : -1);
        }}
        onTouchCancel={() => {
          touchStart.current = null;
        }}
      >
        {showCase && currentCase ? (
          <figure className="absolute inset-0 bg-sand" aria-label={`${modelName}の施工事例画像`}>
            <SmartImage
              src={currentCase.url}
              alt={currentCase.alt || `${modelName} 施工事例 ${caseIndex + 1}`}
              fill
              priority={caseIndex === 0}
              sizes="(min-width: 1024px) 62vw, 100vw"
              className="object-cover"
            />
            {currentCase.caption && (
              <>
                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/65 to-transparent" aria-hidden="true" />
                <figcaption className="absolute right-4 bottom-4 left-4 text-sm font-medium text-white drop-shadow">
                  {currentCase.caption}
                </figcaption>
              </>
            )}
          </figure>
        ) : (
          <>
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
          </>
        )}

        <span className="absolute top-4 left-4 z-10 rounded-full bg-ink/70 px-3 py-1 text-xs text-white">
          {showCase
            ? `施工事例 ${caseIndex + 1} / ${caseImages.length}`
            : current.approximate
              ? '画像は完成イメージです（参考）'
              : '完成イメージ'}
        </span>

        <button
          type="button"
          onClick={() => moveSequence(-1)}
          aria-label="前の画像へ"
          data-testid="preview-prev"
          className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-ink shadow-soft transition hover:bg-white"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => moveSequence(1)}
          aria-label="次の画像へ"
          data-testid="preview-next"
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full bg-white/85 p-2 text-ink shadow-soft transition hover:bg-white"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="border-t border-line px-3 py-2">
        <div
          role="tablist"
          aria-label="表示切替"
          className="flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((t) => {
            const selected = t.key === activeTab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={selected}
                onClick={() => selectTab(t.key)}
                className={cn(
                  'min-h-10 shrink-0 rounded-full px-4 text-sm font-medium transition-colors',
                  selected ? 'bg-ink text-white' : 'text-ink-soft hover:bg-sand'
                )}
                data-testid={`view-${t.key}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {!showCase && (current.approximate || current.note) && (
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
