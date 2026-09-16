'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Input, Select } from '@/components/ui';

const SPEC_OPTIONS = [
  { value: 'hotel', label: 'ホテル' },
  { value: 'residence', label: '住宅・単身者' },
  { value: 'office', label: '事務所・店舗' },
  { value: 'hotel-single', label: 'ホテル・単身者' },
  { value: 'water-kit', label: '水回りキット' },
] as const;

const FIRE_OPTIONS = [
  { value: 'non_fire', label: '非防火' },
  { value: 'fire', label: '防火' },
] as const;

function SelectWithArrow({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="relative mt-1">
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
  models: Array<{ id: string; name: string }>;
}) {
  const firstModel = models[0] ?? { id: '', name: '' };
  const [modelId, setModelId] = useState(firstModel.id);
  const [spec, setSpec] = useState<(typeof SPEC_OPTIONS)[number]['value']>('hotel');
  const [fire, setFire] = useState<(typeof FIRE_OPTIONS)[number]['value']>('non_fire');
  const [region, setRegion] = useState('all');
  const [customName, setCustomName] = useState<string | null>(null);

  const modelName = models.find((model) => model.id === modelId)?.name ?? '';
  const specLabel = SPEC_OPTIONS.find((item) => item.value === spec)?.label ?? '';
  const fireLabel = FIRE_OPTIONS.find((item) => item.value === fire)?.label ?? '';
  const generatedName = useMemo(
    () => [modelName, specLabel, fireLabel].filter(Boolean).join(' '),
    [modelName, specLabel, fireLabel]
  );
  const name = customName ?? generatedName;

  const updateIdentity = (updater: () => void) => {
    updater();
    setCustomName(null);
  };

  return (
    <section className="card space-y-7 p-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="label">商品モデル</span>
          <SelectWithArrow
            value={modelId}
            onChange={(value) => updateIdentity(() => setModelId(value))}
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </SelectWithArrow>
        </label>

        <label className="block">
          <span className="label">用途・仕様</span>
          <SelectWithArrow
            value={spec}
            onChange={(value) => updateIdentity(() => setSpec(value as typeof spec))}
          >
            {SPEC_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </SelectWithArrow>
        </label>

        <label className="block">
          <span className="label">防火仕様</span>
          <SelectWithArrow
            value={fire}
            onChange={(value) => updateIdentity(() => setFire(value as typeof fire))}
          >
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

        <label className="block sm:col-span-2">
          <span className="label">テンプレート名</span>
          <Input
            className="mt-1 w-full"
            value={name}
            onChange={(event) => setCustomName(event.target.value)}
          />
          <span className="mt-1 block text-xs text-muted">
            商品モデル・用途・防火仕様から自動入力します。必要な場合は変更できます。
          </span>
        </label>
      </div>

      <section className="rounded-xl border border-line bg-ivory/35 p-5">
        <div>
          <h2 className="font-semibold">基準となる本体</h2>
          <p className="mt-1 text-xs text-muted">
            この見積テンプレートは、選択した本体マスターの公開中の版を基準にします。
          </p>
        </div>
        <label className="mt-4 block">
          <span className="label">参照本体</span>
          <SelectWithArrow value="" disabled>
            <option value="">公開中の本体マスターから選択</option>
          </SelectWithArrow>
          <span className="mt-1 block text-xs text-muted">
            商品モデルと防火仕様に一致する公開中の本体だけを候補にします。
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
