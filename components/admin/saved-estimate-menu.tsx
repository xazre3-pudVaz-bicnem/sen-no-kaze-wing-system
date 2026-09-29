'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type SavedEstimateTemplate = {
  id: string;
  name: string;
  base_model_id: string;
  spec_code: string;
  total: number;
  updated_at: string;
};

type EstimateModel = {
  id: string;
  name: string;
};

type SavedEstimateSample = {
  id: string;
  name: string;
  model: string;
  spec: string;
  sourceSheet: string;
  sourceTotal: number;
};

const SPEC_LABELS: Record<string, string> = {
  base: '本体のみ',
  hotel: 'ホテル',
  'hotel-single': 'ホテル・単身者',
  residence: '住宅・単身者',
  'water-kit': '水回りキット',
  office: '事務所・店舗',
};

function estimateHref(id: string) {
  const params = new URLSearchParams({ estimate: id });
  return `/admin/estimate-templates?${params.toString()}`;
}

function sampleEstimateHref(id: string) {
  const params = new URLSearchParams({ sample: id });
  return `/admin/estimate-templates?${params.toString()}`;
}

function formatWholeYen(value: number) {
  return formatYen(Math.round(value));
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizedModelName(value: string) {
  return value.trim().toLowerCase();
}

export function SavedEstimateMenu({
  templates,
  models,
  samples,
  selectedId,
  selectedSampleId,
}: {
  templates: SavedEstimateTemplate[];
  models: EstimateModel[];
  samples: SavedEstimateSample[];
  selectedId?: string | null;
  selectedSampleId?: string | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [selectedModelId, setSelectedModelId] = useState('');
  const totalCount = templates.length + samples.length;

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  const filteredTemplates = useMemo(
    () => selectedModelId
      ? templates.filter((template) => template.base_model_id === selectedModelId)
      : templates,
    [selectedModelId, templates]
  );

  const filteredSamples = useMemo(() => {
    if (!selectedModel) return samples;
    const modelName = normalizedModelName(selectedModel.name);
    return samples.filter((sample) => normalizedModelName(sample.model) === modelName);
  }, [samples, selectedModel]);

  const visibleCount = filteredTemplates.length + filteredSamples.length;

  useEffect(() => {
    const close = () => {
      if (detailsRef.current) detailsRef.current.open = false;
    };

    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <details ref={detailsRef} className="relative">
      <summary className="btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        見積書一覧（{totalCount}件）
      </summary>
      <div className="absolute right-0 z-50 mt-2 max-h-[28rem] w-[min(92vw,42rem)] overflow-y-auto rounded-xl border border-line bg-white p-2 shadow-xl">
        <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
          <div>
            <p className="text-sm font-semibold">見積書一覧</p>
            <p className="mt-0.5 text-[11px] text-muted">商品モデルで絞り込み、作成済み見積書と画面確認用サンプルを確認します。</p>
          </div>
          <span className="shrink-0 text-[11px] text-muted">
            {selectedModel ? `${visibleCount} / ${totalCount}件` : `${totalCount}件`}
          </span>
        </div>

        <div className="border-y border-line px-2 py-2" aria-label="商品モデルで絞り込み">
          <p className="mb-1 text-[10px] font-semibold tracking-wide text-muted">商品モデル</p>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-x-visible">
            <button
              type="button"
              aria-pressed={selectedModelId === ''}
              className={
                selectedModelId === ''
                  ? 'shrink-0 rounded-full bg-forest px-3 py-1 text-[11px] font-semibold text-white'
                  : 'shrink-0 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-sand/40'
              }
              onClick={() => setSelectedModelId('')}
            >
              すべて
            </button>
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                aria-pressed={selectedModelId === model.id}
                className={
                  selectedModelId === model.id
                    ? 'shrink-0 rounded-full bg-forest px-3 py-1 text-[11px] font-semibold text-white'
                    : 'shrink-0 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-sand/40'
                }
                onClick={() => setSelectedModelId(model.id)}
              >
                {model.name}
              </button>
            ))}
          </div>
        </div>

        <div className="my-2 rounded-lg border border-line bg-sand/25 px-3 py-2">
          <p className="text-[10px] font-semibold tracking-wide text-muted">シミュレーター標準</p>
          <p className="mt-0.5 text-[11px] text-muted">
            標準指定された正式見積書をシミュレーターの選択肢に表示します。現在は指定機能の接続準備中です。
          </p>
        </div>

        <div className="border-t border-line pt-2">
          <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted">作成済み見積書</p>
          {filteredTemplates.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted">
              {selectedModel ? `${selectedModel.name}の正式保存済み見積書はまだありません。` : '正式保存済みの見積書はまだありません。'}
            </p>
          )}
          {filteredTemplates.length > 0 && (
            <div className="divide-y divide-line">
              {filteredTemplates.map((template) => {
                const active = template.id === selectedId;
                const templateModel = models.find((item) => item.id === template.base_model_id);
                return (
                  <Link
                    key={template.id}
                    href={estimateHref(template.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'grid gap-1 rounded-lg bg-forest/5 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                        : 'grid gap-1 rounded-lg px-3 py-2.5 text-sm hover:bg-sand/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                    }
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{template.name}</span>
                        {active && <Badge tone="neutral">表示中</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {templateModel?.name ?? '—'} ／ {SPEC_LABELS[template.spec_code] ?? template.spec_code}
                        <span className="ml-2">更新 {formatUpdatedAt(template.updated_at)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 sm:justify-end">
                      <strong className="tabular-nums">{formatYen(template.total)}</strong>
                      <span className="text-xs font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-2 border-t border-line pt-2">
          <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted">画面確認用サンプル</p>
          {filteredSamples.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted">
              {selectedModel ? `${selectedModel.name}の画面確認用サンプルはありません。` : '画面確認用サンプルはありません。'}
            </p>
          )}
          {filteredSamples.length > 0 && (
            <div className="divide-y divide-line">
              {filteredSamples.map((sample) => {
                const active = sample.id === selectedSampleId;
                return (
                  <Link
                    key={sample.id}
                    href={sampleEstimateHref(sample.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'grid gap-1 rounded-lg bg-sky-50 px-3 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                        : 'grid gap-1 rounded-lg px-3 py-2.5 text-sm hover:bg-sand/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'
                    }
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{sample.name}</span>
                        <Badge tone="neutral">サンプル</Badge>
                        {active && <Badge tone="neutral">表示中</Badge>}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {sample.model} ／ {sample.spec}
                        <span className="ml-2">Excel: {sample.sourceSheet}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 sm:justify-end">
                      <strong className="tabular-nums">{formatWholeYen(sample.sourceTotal)}</strong>
                      <span className="text-xs font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
