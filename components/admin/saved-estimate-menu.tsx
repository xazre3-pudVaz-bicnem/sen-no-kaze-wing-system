'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
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
  fireSpec: string;
  sourceSheet: string;
  sourceTotal: number;
};

const SIMULATOR_STANDARD_DEMO_SAMPLE_IDS = new Set(['wing-hotel', 'box-hotel-single', 'flat-office']);
const COLLAPSED_ROW_LIMIT = 6;

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
  const [selectedModelId, setSelectedModelId] = useState('');
  const [expanded, setExpanded] = useState(false);
  const totalCount = templates.length + samples.length;

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  const filteredTemplates = useMemo(
    () =>
      selectedModelId
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
  const visibleTemplates = expanded
    ? filteredTemplates
    : filteredTemplates.slice(0, COLLAPSED_ROW_LIMIT);
  const remainingSampleSlots = expanded
    ? filteredSamples.length
    : Math.max(0, COLLAPSED_ROW_LIMIT - visibleTemplates.length);
  const visibleSamples = expanded
    ? filteredSamples
    : filteredSamples.slice(0, remainingSampleSlots);
  const shownCount = visibleTemplates.length + visibleSamples.length;
  const hiddenCount = Math.max(0, visibleCount - shownCount);

  return (
    <section className="card overflow-hidden" data-testid="simulator-standard-list">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">シミュレーター標準一覧</h2>
          <p className="mt-0.5 text-[11px] text-muted">
            登録済みの標準見積と画面確認用サンプルを分けて表示します。選ぶと下の編集画面が切り替わります。
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-muted">
          {selectedModel ? `${visibleCount} / ${totalCount}件` : `${totalCount}件`}
        </span>
      </div>

      <div className="border-b border-line px-4 py-2" aria-label="商品モデルで絞り込み">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-x-visible">
          <button
            type="button"
            aria-pressed={selectedModelId === ''}
            className={
              selectedModelId === ''
                ? 'shrink-0 rounded-full bg-forest px-3 py-1 text-[11px] font-semibold text-white'
                : 'shrink-0 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-sand/40'
            }
            onClick={() => {
              setSelectedModelId('');
              setExpanded(false);
            }}
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
              onClick={() => {
                setSelectedModelId(model.id);
                setExpanded(false);
              }}
            >
              {model.name}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full">
        <div className="w-full">
          <div className="grid w-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.55fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.05fr)_minmax(0,0.55fr)] items-center gap-1.5 border-b border-line bg-sand/35 px-3 py-1.5 text-[10px] font-semibold leading-tight text-muted">
            <span className="min-w-0">商品モデル</span>
            <span className="min-w-0">仕様</span>
            <span className="min-w-0">防火仕様</span>
            <span className="min-w-0 text-right">標準金額</span>
            <span className="min-w-0">状態</span>
            <span className="min-w-0">シミュレーター使用状態</span>
            <span className="min-w-0 text-right">選択</span>
          </div>

          <div className="border-b border-line bg-slate-50 px-4 py-1 text-[10px] font-semibold tracking-wide text-muted">
            登録済み標準見積
          </div>
          {filteredTemplates.length === 0 ? (
            <p className="px-4 py-2 text-[11px] text-muted">
              {selectedModel
                ? `${selectedModel.name}の登録済み標準見積はまだありません。`
                : '登録済み標準見積はまだありません。'}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {visibleTemplates.map((template) => {
                const active = template.id === selectedId;
                const templateModel = models.find((item) => item.id === template.base_model_id);
                return (
                  <Link
                    key={template.id}
                    href={estimateHref(template.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'grid w-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.55fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.05fr)_minmax(0,0.55fr)] items-center gap-1.5 bg-forest/5 px-4 py-2 text-xs'
                        : 'grid w-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.55fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.05fr)_minmax(0,0.55fr)] items-center gap-1.5 px-4 py-2 text-xs hover:bg-sand/30'
                    }
                  >
                    <strong className="min-w-0 truncate">{templateModel?.name ?? '—'}</strong>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold">
                          {SPEC_LABELS[template.spec_code] ?? template.spec_code}
                        </span>
                        {active && <Badge tone="neutral">表示中</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {template.name} ／ 更新 {formatUpdatedAt(template.updated_at)}
                      </span>
                    </span>
                    <span className="min-w-0 text-[10px] leading-tight text-muted" title="正式な本体マスター接続後に表示します">
                      正式接続待ち
                    </span>
                    <strong className="min-w-0 truncate text-right text-[11px] tabular-nums">{formatYen(template.total)}</strong>
                    <span className="min-w-0"><Badge tone="neutral">登録済み</Badge></span>
                    <span className="min-w-0 text-[10px] leading-tight text-muted">接続準備中</span>
                    <span className="min-w-0 text-right text-[11px] font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                  </Link>
                );
              })}
            </div>
          )}

          <div className="border-y border-line bg-sky-50/70 px-4 py-1 text-[10px] font-semibold tracking-wide text-sky-800">
            画面確認用サンプル
          </div>
          {filteredSamples.length === 0 ? (
            <p className="px-4 py-2 text-[11px] text-muted">
              {selectedModel
                ? `${selectedModel.name}の画面確認用サンプルはありません。`
                : '画面確認用サンプルはありません。'}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {visibleSamples.map((sample) => {
                const active = sample.id === selectedSampleId;
                const simulatorStandard = SIMULATOR_STANDARD_DEMO_SAMPLE_IDS.has(sample.id);
                return (
                  <Link
                    key={sample.id}
                    href={sampleEstimateHref(sample.id)}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'grid w-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.55fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.05fr)_minmax(0,0.55fr)] items-center gap-1.5 bg-sky-100/70 px-4 py-2 text-xs'
                        : 'grid w-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.55fr)_minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,0.8fr)_minmax(0,1.05fr)_minmax(0,0.55fr)] items-center gap-1.5 px-4 py-2 text-xs hover:bg-sky-50/70'
                    }
                  >
                    <strong className="min-w-0 truncate">{sample.model}</strong>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-semibold">{sample.spec}</span>
                        <Badge tone="neutral">サンプル</Badge>
                        {active && <Badge tone="neutral">表示中</Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted">
                        {sample.name} ／ Excel: {sample.sourceSheet}
                      </span>
                    </span>
                    <span className="min-w-0 truncate">{sample.fireSpec || '—'}</span>
                    <strong className="min-w-0 truncate text-right text-[11px] tabular-nums">{formatWholeYen(sample.sourceTotal)}</strong>
                    <span className="min-w-0 text-[10px] leading-tight text-sky-800">画面確認用</span>
                    <span className="min-w-0 text-[10px] leading-tight text-muted">
                      {simulatorStandard ? '標準サンプル' : 'サンプル'}
                    </span>
                    <span className="min-w-0 text-right text-[11px] font-semibold text-forest">{active ? '表示中' : '開く'}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {visibleCount > COLLAPSED_ROW_LIMIT && (
        <div className="flex justify-center border-t border-line px-4 py-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '閉じる' : `一覧を広げる（残り${hiddenCount}件）`}
          </button>
        </div>
      )}
    </section>
  );
}
