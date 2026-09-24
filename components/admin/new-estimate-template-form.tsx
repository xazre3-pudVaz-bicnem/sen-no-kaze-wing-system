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

function StepIndicator({ current }: { current: 'setup' | 'edit' }) {
  return (
    <div className="flex max-w-[560px] items-center gap-2 text-xs" aria-label="新規標準見積の作成手順">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={
            current === 'setup'
              ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white'
              : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-white font-semibold text-ink'
          }
        >
          1
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-ink">初期設定</p>
          <p className="truncate text-[11px] text-muted">モデル・仕様・地域</p>
        </div>
      </div>
      <div className="h-px min-w-8 flex-1 bg-line" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={
            current === 'edit'
              ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white'
              : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-white font-semibold text-muted'
          }
        >
          2
        </span>
        <div className="min-w-0">
          <p className={current === 'edit' ? 'font-semibold text-ink' : 'font-semibold text-muted'}>明細編集</p>
          <p className="truncate text-[11px] text-muted">Excel形式</p>
        </div>
      </div>
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
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4">
            <StepIndicator current="edit" />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setStep('setup')}>
              初期設定へ戻る
            </button>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                  画面内プレビュー
                </span>
                <span className="text-xs text-muted">新規標準見積</span>
              </div>
              <h2 className="mt-2 truncate text-lg font-semibold">{name || '名称未設定'}</h2>
              <p className="mt-1 text-xs text-muted">
                {modelName || '—'} ／ {specLabel || '—'} ／ {fireLabel || '—'} ／ {regionLabel || '—'}
              </p>
            </div>
          </div>

          <div className="grid gap-px border-t border-line bg-line text-xs sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['商品モデル', modelName || '—'],
              ['仕様', specLabel || '—'],
              ['防火仕様', fireLabel || '—'],
              ['利用地域', regionLabel || '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3">
                <p className="text-[11px] text-muted">{label}</p>
                <p className="mt-1 font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          <strong className="font-semibold text-ink">この画面はUI確認用です。</strong>
          この段階ではDBに標準見積・下書き・Revisionを作成しません。参照本体、正式原価、掛率、保存、公開は正式なDraft / RPC接続後に有効化します。
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
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <StepIndicator current="setup" />
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <section className="max-w-[760px]">
          <div className="mb-4">
            <h2 className="font-semibold">初期設定</h2>
            <p className="mt-1 text-xs text-muted">
              標準見積の基準となる条件を設定します。次の画面でExcel形式の明細を編集します。
            </p>
          </div>

          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
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
              <span className="mt-1 block text-[11px] text-muted">
                商品モデルに登録されている仕様を表示します。
              </span>
            </label>

            <label className="block">
              <span className="label">防火仕様</span>
              <SelectWithArrow value={fire} onChange={handleFireChange}>
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
              <span className="mt-1 block text-[11px] text-muted">
                将来、設置予定地から設備・見積条件を切り替えるための地域条件として利用します。
              </span>
            </label>
          </div>

          <label className="mt-5 block max-w-[620px]">
            <span className="label">標準見積名</span>
            <Input
              className="mt-1 w-full"
              value={name}
              onChange={(event) => setCustomName(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-muted">
              商品モデル・仕様・防火仕様から自動入力します。必要な場合だけ変更してください。
            </span>
          </label>
        </section>

        <section className="max-w-[760px] overflow-hidden rounded-xl border border-line">
          <div className="flex flex-wrap items-start justify-between gap-3 bg-sand/20 px-4 py-3">
            <div>
              <h2 className="font-semibold">基準となる本体</h2>
              <p className="mt-1 text-xs text-muted">
                正式実装では、条件に一致する公開中の本体Revisionをここで固定します。
              </p>
            </div>
            <span className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-muted">
              正式接続待ち
            </span>
          </div>
          <div className="px-4 py-4">
            <label className="block max-w-[620px]">
              <span className="label">参照本体</span>
              <SelectWithArrow value="" disabled>
                <option value="">正式なDraft接続後に公開中の本体から選択</option>
              </SelectWithArrow>
              <span className="mt-1 block text-[11px] text-muted">
                現在はUI確認のため未接続です。DB/RPC実装時に正式な選択へ切り替えます。
              </span>
            </label>
          </div>
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
              Excel明細編集へ進む
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
