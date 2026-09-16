'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Input, Select } from '@/components/ui';

const FIRE_OPTIONS = [
  { value: 'non_fire', label: '非防火' },
  { value: 'fire', label: '防火' },
] as const;

type TemplateModel = {
  id: string;
  name: string;
  specs: Array<{ code: string; name: string }>;
};

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
  models,
}: {
  models: TemplateModel[];
}) {
  const firstModel = models[0] ?? { id: '', name: '', specs: [] };
  const firstSpec = firstModel.specs[0] ?? { code: '', name: '' };
  const [modelId, setModelId] = useState(firstModel.id);
  const [spec, setSpec] = useState(firstSpec.code);
  const [fire, setFire] = useState<(typeof FIRE_OPTIONS)[number]['value']>('non_fire');
  const [region, setRegion] = useState('all');
  const [customName, setCustomName] = useState<string | null>(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === modelId) ?? firstModel,
    [firstModel, modelId, models]
  );
  const availableSpecs = selectedModel.specs;
  const selectedSpec = availableSpecs.find((item) => item.code === spec) ?? availableSpecs[0] ?? null;
  const modelName = selectedModel.name;
  const specLabel = selectedSpec?.name ?? '';
  const fireLabel = FIRE_OPTIONS.find((item) => item.value === fire)?.label ?? '';
  const generatedName = useMemo(
    () => [modelName, specLabel, fireLabel].filter(Boolean).join(' '),
    [modelName, specLabel, fireLabel]
  );
  const name = customName ?? generatedName;

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
            <SelectWithArrow value={region} onChange={setRegion}>
              <option value="all">全国</option>
              <option value="hokuriku">北陸ブロック</option>
              <option value="custom">指定地域</option>
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
            <option value="">公開中の本体マスターから選択</option>
          </SelectWithArrow>
          <span className="mt-1 block text-xs text-muted">
            商品モデル・仕様・防火仕様に一致する公開中の本体だけを候補にします。
          </span>
        </label>
      </section>

      <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-5">
        <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">キャンセル</Link>
        <button type="button" className="btn-primary btn-sm" disabled>
          下書き版を作成
        </button>
      </div>
    </section>
  );
}
