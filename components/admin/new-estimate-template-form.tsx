'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Input, Select } from '@/components/ui';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchProduct,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';

const FIRE_OPTIONS = [
  { value: 'non_fire', label: '非防火' },
  { value: 'fire', label: '防火' },
] as const;

const REGION_OPTIONS = [
  { value: 'all', label: '全国' },
  { value: 'hokuriku', label: '北陸ブロック' },
  { value: 'custom', label: '指定地域' },
] as const;

const PREVIEW_SECTIONS: EstimateTemplateWorkbenchSection[] = [
  { code: 'interior_exterior', label: '内外装工事', expenseLabel: null, expenseAmount: 0 },
  { code: 'option', label: 'オプション', expenseLabel: null, expenseAmount: 0 },
  { code: 'sitework', label: '別途', expenseLabel: null, expenseAmount: 0 },
];

type TemplateModel = {
  id: string;
  name: string;
  specs: Array<{ code: string; name: string }>;
};

const EMPTY_MODEL: TemplateModel = { id: '', name: '', specs: [] };

function SelectWithArrow({
  value,
  onChange,
  children,
  disabled,
  className = '',
}: {
  value: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={'relative mt-1 ' + className}>
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full pr-10"
      >
        {children}
      </Select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted"
      >
        ▼
      </span>
    </div>
  );
}

export function NewEstimateTemplateForm({
  role,
  models,
  products,
}: {
  role: 'admin' | 'master_dealer' | 'dealer' | 'customer';
  models: TemplateModel[];
  products: EstimateTemplateWorkbenchProduct[];
}) {
  const firstModel = models[0] ?? EMPTY_MODEL;
  const firstSpec = firstModel.specs[0] ?? { code: '', name: '' };
  const [modelId, setModelId] = useState(firstModel.id);
  const [spec, setSpec] = useState(firstSpec.code);
  const [fire, setFire] = useState<(typeof FIRE_OPTIONS)[number]['value']>('non_fire');
  const [region, setRegion] = useState<(typeof REGION_OPTIONS)[number]['value']>('all');
  const [customName, setCustomName] = useState<string | null>(null);
  const [step, setStep] = useState<'setup' | 'edit'>('setup');

  const selectedModel = useMemo(
    () => models.find((model) => model.id === modelId) ?? firstModel,
    [firstModel, modelId, models]
  );
  const availableSpecs = selectedModel.specs;
  const selectedSpec = availableSpecs.find((item) => item.code === spec) ?? availableSpecs[0] ?? null;
  const modelName = selectedModel.name;
  const specLabel = selectedSpec?.name ?? '';
  const fireLabel = FIRE_OPTIONS.find((item) => item.value === fire)?.label ?? '';
  const regionLabel = REGION_OPTIONS.find((item) => item.value === region)?.label ?? '';
  const generatedName = useMemo(
    () => [modelName, specLabel, fireLabel].filter(Boolean).join(' '),
    [modelName, specLabel, fireLabel]
  );
  const name = customName ?? generatedName;
  const canContinue = Boolean(modelId && selectedSpec?.code);

  const handleModelChange = (nextModelId: string) => {
    const nextModel = models.find((model) => model.id === nextModelId);
    setModelId(nextModelId);
    setSpec(nextModel?.specs[0]?.code ?? '');
    setCustomName(null);
  };

  const handleSpecChange = (value: string) => {
    setSpec(value);
    setCustomName(null);
  };

  const handleFireChange = (value: string) => {
    setFire(value as typeof fire);
    setCustomName(null);
  };

  if (step === 'edit') {
    return (
      <div className="space-y-4">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <p className="text-xs font-semibold text-muted">新規標準見積・画面内下書き</p>
              <h2 className="mt-1 text-lg font-semibold">{name || '名称未設定'}</h2>
              <p className="mt-1 text-xs text-muted">
                {modelName || '—'} ／ {specLabel || '—'} ／ {fireLabel || '—'} ／ {regionLabel || '—'}
              </p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setStep('setup')}>
              初期設定へ戻る
            </button>
          </div>

          <div className="grid gap-3 bg-sand/20 px-5 py-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-muted">商品モデル</span>
              <strong className="ml-2 text-ink">{modelName || '—'}</strong>
            </div>
            <div>
              <span className="text-muted">仕様</span>
              <strong className="ml-2 text-ink">{specLabel || '—'}</strong>
            </div>
            <div>
              <span className="text-muted">防火仕様</span>
              <strong className="ml-2 text-ink">{fireLabel || '—'}</strong>
            </div>
            <div>
              <span className="text-muted">利用地域</span>
              <strong className="ml-2 text-ink">{regionLabel || '—'}</strong>
            </div>
          </div>
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">画面内の作成確認です。</strong>
          この段階ではDBに標準見積・下書き・Revisionを作成しません。
          参照本体、正式原価、掛率、保存、公開は正式なDraft / RPC接続後に有効化します。
        </div>

        <EstimateTemplateWorkbench
          templateId="new-standard-estimate-preview"
          role={role}
          baseLines={[]}
          baseTotal={0}
          initialLines={[]}
          sections={PREVIEW_SECTIONS}
          products={products}
          taxRate={0.1}
          adjustment={0}
          demoMode
        />
      </div>
    );
  }

  return (
    <section className="card space-y-7 p-6">
      <div className="max-w-[700px] space-y-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,320px)_minmax(0,320px)]">
          <label className="block">
            <span className="label">商品モデル</span>
            <SelectWithArrow value={modelId} onChange={handleModelChange}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </SelectWithArrow>
          </label>

          <label className="block">
            <span className="label">仕様</span>
            <SelectWithArrow value={selectedSpec?.code ?? ''} onChange={handleSpecChange} disabled={availableSpecs.length === 0}>
              {availableSpecs.length > 0 ? (
                availableSpecs.map((item) => (
                  <option key={item.code} value={item.code}>{item.name}</option>
                ))
              ) : (
                <option value="">仕様が登録されていません</option>
              )}
            </SelectWithArrow>
            <span className="mt-1 block text-xs text-muted">
              商品モデルに登録されている仕様を表示します。仕様を追加するとここにも反映されます。
            </span>
          </label>

          <label className="block">
            <span className="label">防火仕様</span>
            <SelectWithArrow value={fire} onChange={handleFireChange} className="max-w-[240px]">
              {FIRE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </SelectWithArrow>
          </label>

          <label className="block">
            <span className="label">利用地域</span>
            <SelectWithArrow value={region} onChange={(value) => setRegion(value as typeof region)}>
              {REGION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </SelectWithArrow>
          </label>
        </div>

        <label className="block max-w-[600px]">
          <span className="label">テンプレート名</span>
          <Input
            className="mt-1 w-full"
            value={name}
            onChange={(event) => setCustomName(event.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">
            商品モデル・仕様・防火仕様から自動入力します。必要な場合は変更できます。
          </span>
        </label>
      </div>

      <section className="max-w-[700px] rounded-xl border border-line bg-ivory/35 p-5">
        <div>
          <h2 className="font-semibold">基準となる本体</h2>
          <p className="mt-1 text-xs text-muted">
            この見積テンプレートは、選択した本体マスターの公開中の版を基準にします。
          </p>
        </div>
        <label className="mt-4 block max-w-[600px]">
          <span className="label">参照本体</span>
          <SelectWithArrow value="" disabled>
            <option value="">正式なDraft接続後に公開中の本体から選択</option>
          </SelectWithArrow>
          <span className="mt-1 block text-xs text-muted">
            今回はUI確認のため未接続です。正式実装では商品モデル・仕様・防火仕様に一致する公開中の本体だけを候補にします。
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-xs text-muted">
          次の画面ではExcel形式の明細編集を試せます。まだDBには保存されません。
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">キャンセル</Link>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!canContinue}
            onClick={() => setStep('edit')}
          >
            明細編集へ進む
          </button>
        </div>
      </div>
    </section>
  );
}
