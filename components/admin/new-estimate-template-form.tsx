'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { Input, Select } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import {
  EstimateTemplateWorkbench,
  type EstimateTemplateWorkbenchLine,
  type EstimateTemplateWorkbenchProduct,
  type EstimateTemplateWorkbenchSection,
} from '@/components/admin/estimate-template-workbench';

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

const SAMPLE_EDIT_LINES: EstimateTemplateWorkbenchLine[] = [
  {
    id: 'sample-interior-exterior-wall',
    section: 'interior_exterior',
    groupLabel: '外壁',
    name: '外壁仕様：角スパンガルバリウム鋼板',
    quantity: 4,
    unit: '面',
    saleUnitPrice: 0,
    remark: '標準仕様・画面確認用',
    source: 'product',
    customerSelection: '標準・変更可',
  },
  {
    id: 'sample-interior-finish',
    section: 'interior_exterior',
    groupLabel: '内装',
    name: '室内造作工事（床・壁・天井）',
    quantity: 1,
    unit: '式',
    saleUnitPrice: 312500,
    remark: '画面確認用',
    source: 'free',
    customerSelection: '—',
  },
  {
    id: 'sample-option-unit-bath',
    section: 'option',
    groupLabel: 'ユニットバス',
    name: 'ユニットバス 1216（浴槽付）',
    quantity: 1,
    unit: '式',
    saleUnitPrice: 570000,
    remark: '画面確認用',
    source: 'product',
    customerSelection: '標準・変更可',
  },
  {
    id: 'sample-option-water-heater',
    section: 'option',
    groupLabel: '給湯器',
    name: 'ガス給湯器 16号',
    quantity: 1,
    unit: '台',
    saleUnitPrice: 270000,
    remark: '画面確認用',
    source: 'product',
    customerSelection: '標準・変更可',
  },
  {
    id: 'sample-option-aircon',
    section: 'option',
    groupLabel: 'エアコン',
    name: 'エアコン',
    quantity: 1,
    unit: '台',
    saleUnitPrice: 375000,
    remark: '画面確認用',
    source: 'product',
    customerSelection: '任意オプション',
  },
  {
    id: 'sample-sitework-shipping',
    section: 'sitework',
    groupLabel: '別途工事',
    name: '運送費',
    quantity: 1,
    unit: '式',
    saleUnitPrice: 0,
    remark: '別途見積',
    source: 'free',
    customerSelection: '—',
  },
];

type TemplateModel = {
  id: string;
  name: string;
  specs: Array<{ code: string; name: string }>;
};

export interface EstimateBaseMasterChoice {
  id: string;
  revisionId: string;
  revisionVersion: number;
  modelId: string;
  ownerName: string;
  name: string;
  fireSpec: 'non_fire' | 'fire';
  lineSubtotal: number;
  expenseAmount: number;
  total: number;
  lines: Array<{
    id: string;
    section: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    amount: number;
    remark: string;
  }>;
}

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
        className="h-10 min-h-10 w-full pr-10"
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
    <div className="flex w-full max-w-[390px] items-center gap-3 text-xs" aria-label="新規標準見積の作成手順">
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={
            current === 'setup'
              ? 'flex size-6 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white'
              : 'flex size-6 items-center justify-center rounded-full border border-line bg-white text-[11px] font-semibold text-ink'
          }
        >
          1
        </span>
        <span className="whitespace-nowrap font-semibold text-ink">初期設定</span>
      </div>
      <div className="h-px min-w-8 flex-1 bg-line" />
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={
            current === 'edit'
              ? 'flex size-6 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white'
              : 'flex size-6 items-center justify-center rounded-full border border-line bg-white text-[11px] font-semibold text-muted'
          }
        >
          2
        </span>
        <span className={current === 'edit' ? 'whitespace-nowrap font-semibold text-ink' : 'whitespace-nowrap font-semibold text-muted'}>
          明細編集
        </span>
      </div>
    </div>
  );
}

function fireLabel(code: EstimateBaseMasterChoice['fireSpec']) {
  return code === 'fire' ? '防火' : '非防火';
}

export function NewEstimateTemplateForm({
  role,
  models,
  baseMasters,
  baseMasterSourceReady,
  sampleBaseMaster,
  products,
}: {
  role: 'admin' | 'master_dealer' | 'dealer' | 'customer';
  models: TemplateModel[];
  baseMasters: EstimateBaseMasterChoice[];
  baseMasterSourceReady: boolean;
  sampleBaseMaster: EstimateBaseMasterChoice | null;
  products: EstimateTemplateWorkbenchProduct[];
}) {
  const [selectedBaseMasterId, setSelectedBaseMasterId] = useState('');
  const [pickerBaseMasterId, setPickerBaseMasterId] = useState('');
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [spec, setSpec] = useState('');
  const [region, setRegion] = useState<(typeof REGION_OPTIONS)[number]['value']>('all');
  const [customName, setCustomName] = useState<string | null>(null);
  const [step, setStep] = useState<'setup' | 'edit'>('setup');

  const selectedBaseMaster = useMemo(
    () =>
      baseMasters.find((baseMaster) => baseMaster.id === selectedBaseMasterId) ??
      (sampleBaseMaster?.id === selectedBaseMasterId ? sampleBaseMaster : null),
    [baseMasters, sampleBaseMaster, selectedBaseMasterId]
  );
  const samplePreview = Boolean(sampleBaseMaster && selectedBaseMasterId === sampleBaseMaster.id);
  const pickerBaseMaster = useMemo(
    () =>
      baseMasters.find((baseMaster) => baseMaster.id === pickerBaseMasterId) ??
      selectedBaseMaster ??
      baseMasters[0] ??
      null,
    [baseMasters, pickerBaseMasterId, selectedBaseMaster]
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedBaseMaster?.modelId) ?? null,
    [models, selectedBaseMaster]
  );
  const availableSpecs = selectedModel?.specs ?? [];
  const selectedSpec = availableSpecs.find((item) => item.code === spec) ?? availableSpecs[0] ?? null;
  const modelName = selectedModel?.name ?? '';
  const specLabel = selectedSpec?.name ?? '';
  const selectedFireLabel = selectedBaseMaster ? fireLabel(selectedBaseMaster.fireSpec) : '';
  const regionLabel = REGION_OPTIONS.find((item) => item.value === region)?.label ?? '';
  const generatedName = useMemo(
    () => [modelName, specLabel, selectedFireLabel].filter(Boolean).join(' '),
    [modelName, specLabel, selectedFireLabel]
  );
  const name = customName ?? generatedName;
  const canContinue = Boolean(selectedBaseMaster && selectedSpec?.code);

  const modelNameFor = (baseMaster: EstimateBaseMasterChoice) =>
    models.find((model) => model.id === baseMaster.modelId)?.name ?? '—';

  const openBasePicker = () => {
    setPickerBaseMasterId(selectedBaseMaster?.id ?? baseMasters[0]?.id ?? '');
    setBasePickerOpen(true);
  };

  const chooseBaseMaster = (baseMaster: EstimateBaseMasterChoice) => {
    const model = models.find((item) => item.id === baseMaster.modelId) ?? null;
    setSelectedBaseMasterId(baseMaster.id);
    setPickerBaseMasterId(baseMaster.id);
    setSpec(model?.specs[0]?.code ?? '');
    setCustomName(null);
    setBasePickerOpen(false);
  };

  const openSampleEditor = () => {
    if (!sampleBaseMaster) return;
    const model = models.find((item) => item.id === sampleBaseMaster.modelId) ?? null;
    const sampleSpec = model?.specs.find((item) => item.code === 'hotel') ?? model?.specs[0] ?? null;
    setSelectedBaseMasterId(sampleBaseMaster.id);
    setPickerBaseMasterId('');
    setSpec(sampleSpec?.code ?? '');
    setRegion('all');
    setCustomName('Wing ホテル仕様（画面確認用）');
    setBasePickerOpen(false);
    setStep('edit');
  };

  const handleSpecChange = (value: string) => {
    setSpec(value);
    setCustomName(null);
  };

  if (step === 'edit') {
    return (
      <div className="space-y-4">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <StepIndicator current="edit" />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setStep('setup')}>
              初期設定へ戻る
            </button>
          </div>

          <div className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{name || '名称未設定'}</h2>
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                {samplePreview ? '画面確認用' : '新規標準見積'}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              基準本体：{selectedBaseMaster ? selectedBaseMaster.name + (samplePreview ? '' : ' v' + selectedBaseMaster.revisionVersion) : '—'}
              <span className="mx-2">｜</span>
              防火：{selectedFireLabel || '—'}
              <span className="mx-2">｜</span>
              地域：{regionLabel || '—'}
            </p>
          </div>
        </section>

        {!samplePreview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-xs leading-relaxed text-ink-soft">
            <strong className="font-semibold text-ink">現在は画面確認用です。</strong>
            {' 編集内容は保存されません。保存・公開機能は準備中です。'}
          </div>
        )}

        <EstimateTemplateWorkbench
          templateId="new-standard-estimate-preview"
          role={role}
          baseLines={selectedBaseMaster?.lines ?? []}
          baseTotal={selectedBaseMaster?.total ?? 0}
          initialLines={samplePreview ? SAMPLE_EDIT_LINES : []}
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
    <>
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <StepIndicator current="setup" />
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <h2 className="font-semibold">初期設定</h2>
            <p className="mt-0.5 text-xs text-muted">
              先に基準本体を選びます。商品モデルと防火仕様は、選んだ本体から自動設定されます。
            </p>
          </div>

          <section className="overflow-hidden rounded-xl border border-line">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-sand/20 px-4 py-2.5">
              <div>
                <h3 className="text-sm font-semibold">基準本体</h3>
                <p className="mt-0.5 text-[11px] text-muted">公開中の本体Revisionから、明細を確認して選択します。</p>
              </div>
              {selectedBaseMaster && (
                <button type="button" className="btn-secondary btn-sm" onClick={openBasePicker}>
                  変更する
                </button>
              )}
            </div>

            <div className="px-4 py-3">
              {selectedBaseMaster ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <div className="min-w-[15rem] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{selectedBaseMaster.name}</strong>
                      <span className="rounded-full border border-line bg-sand/30 px-2 py-0.5 text-[10px] font-semibold">
                        v{selectedBaseMaster.revisionVersion}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {modelNameFor(selectedBaseMaster)} ／ {fireLabel(selectedBaseMaster.fireSpec)} ／ {selectedBaseMaster.ownerName}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted">本体価格計</p>
                    <p className="text-base font-semibold">{formatYen(selectedBaseMaster.total)}</p>
                  </div>
                  <button type="button" className="text-xs font-semibold underline underline-offset-4" onClick={openBasePicker}>
                    明細を見る
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">基準本体が未選択です</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      本体名だけでなく、公開Revisionの明細・数量・単価・金額を確認して選べます。
                    </p>
                  </div>
                  <button type="button" className="btn-primary btn-sm" onClick={openBasePicker}>
                    基準本体を選ぶ
                  </button>
                </div>
              )}
            </div>
          </section>

          {!baseMasterSourceReady && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-ink-soft">
              <span>本体マスターの正式な読込環境が未接続です。正式データは選べませんが、画面確認用サンプルで明細編集を確認できます。</span>
              {sampleBaseMaster && (
                <button type="button" className="btn-secondary btn-sm" onClick={openSampleEditor}>
                  画面確認用サンプルでExcel明細編集を見る
                </button>
              )}
            </div>
          )}

          {baseMasterSourceReady && baseMasters.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sand/20 px-3 py-2 text-[11px] text-muted">
              <span>公開中の基準本体がありません。本体マスターで公開版を用意すると正式データを選択できます。</span>
              {sampleBaseMaster && (
                <button type="button" className="btn-secondary btn-sm" onClick={openSampleEditor}>
                  画面確認用サンプルでExcel明細編集を見る
                </button>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-line bg-sand/15 px-3 py-2.5">
              <p className="text-[10px] text-muted">商品モデル</p>
              <p className="mt-1 text-sm font-semibold">{modelName || '基準本体から自動設定'}</p>
            </div>

            <label className="block">
              <span className="label">仕様</span>
              <SelectWithArrow
                value={selectedSpec?.code ?? ''}
                onChange={handleSpecChange}
                disabled={!selectedBaseMaster || availableSpecs.length === 0}
              >
                {!selectedBaseMaster ? (
                  <option value="">先に基準本体を選択</option>
                ) : availableSpecs.length > 0 ? (
                  availableSpecs.map((item) => (
                    <option key={item.code} value={item.code}>{item.name}</option>
                  ))
                ) : (
                  <option value="">仕様が登録されていません</option>
                )}
              </SelectWithArrow>
              <span className="mt-1 block text-[10px] text-muted">
                現在の本体マスターでは仕様は別項目のため、ここで選択します。
              </span>
            </label>

            <div className="rounded-lg border border-line bg-sand/15 px-3 py-2.5">
              <p className="text-[10px] text-muted">防火仕様</p>
              <p className="mt-1 text-sm font-semibold">{selectedFireLabel || '基準本体から自動設定'}</p>
            </div>

            <label className="block">
              <span className="label">適用地域</span>
              <SelectWithArrow value={region} onChange={(value) => setRegion(value as typeof region)}>
                {REGION_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </SelectWithArrow>
              <span className="mt-1 block text-[10px] text-muted">
                将来は設置予定地から自動判定する想定です。
              </span>
            </label>
          </div>

          <label className="block max-w-[620px]">
            <span className="label">標準見積名</span>
            <Input
              className="mt-1 h-10 w-full"
              value={name}
              placeholder="基準本体を選ぶと自動入力します"
              onChange={(event) => setCustomName(event.target.value)}
            />
            <span className="mt-1 block text-[10px] text-muted">
              商品モデル・仕様・防火仕様から自動入力します。必要な場合だけ変更してください。
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-muted">
              次の画面では、選択した本体明細を基準にExcel形式の明細編集を確認できます。
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

      {basePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="基準本体を選択">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">基準本体を選択</h2>
                <p className="mt-1 text-xs text-muted">公開中の本体Revisionを、明細と金額を確認して選択します。</p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setBasePickerOpen(false)}>閉じる</button>
            </div>

            {baseMasters.length > 0 ? (
              <div className="grid min-h-0 flex-1 lg:grid-cols-[19rem_1fr]">
                <aside className="max-h-[72vh] overflow-y-auto border-b border-line bg-sand/10 p-3 lg:border-b-0 lg:border-r">
                  <div className="space-y-2">
                    {baseMasters.map((baseMaster) => {
                      const active = pickerBaseMaster?.id === baseMaster.id;
                      return (
                        <button
                          key={baseMaster.id}
                          type="button"
                          className={
                            active
                              ? 'w-full rounded-lg border border-forest bg-forest/5 p-3 text-left'
                              : 'w-full rounded-lg border border-line bg-white p-3 text-left hover:border-forest/40'
                          }
                          onClick={() => setPickerBaseMasterId(baseMaster.id)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <strong className="text-sm">{baseMaster.name}</strong>
                            <span className="shrink-0 text-[10px] text-muted">v{baseMaster.revisionVersion}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted">
                            {modelNameFor(baseMaster)} ／ {fireLabel(baseMaster.fireSpec)}
                          </p>
                          <p className="mt-1 text-[11px] text-muted">{baseMaster.ownerName}</p>
                          <p className="mt-2 text-sm font-semibold">{formatYen(baseMaster.total)}</p>
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                  {pickerBaseMaster && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">{pickerBaseMaster.name}</h3>
                            <span className="rounded-full border border-line bg-sand/30 px-2 py-0.5 text-[10px] font-semibold">
                              公開版 v{pickerBaseMaster.revisionVersion}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {modelNameFor(pickerBaseMaster)} ／ {fireLabel(pickerBaseMaster.fireSpec)} ／ {pickerBaseMaster.ownerName}
                          </p>
                        </div>
                        <button type="button" className="btn-primary btn-sm" onClick={() => chooseBaseMaster(pickerBaseMaster)}>
                          この本体を選択
                        </button>
                      </div>

                      <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line text-xs sm:grid-cols-3">
                        <div className="bg-white px-3 py-2">
                          <p className="text-[10px] text-muted">明細合計</p>
                          <p className="mt-0.5 font-semibold">{formatYen(pickerBaseMaster.lineSubtotal)}</p>
                        </div>
                        <div className="bg-white px-3 py-2">
                          <p className="text-[10px] text-muted">諸費用</p>
                          <p className="mt-0.5 font-semibold">{formatYen(pickerBaseMaster.expenseAmount)}</p>
                        </div>
                        <div className="bg-white px-3 py-2">
                          <p className="text-[10px] text-muted">本体価格計</p>
                          <p className="mt-0.5 font-semibold">{formatYen(pickerBaseMaster.total)}</p>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full min-w-[46rem] text-xs">
                          <thead className="bg-sand/40 text-left text-[10px] text-muted">
                            <tr>
                              <th className="px-3 py-2 font-semibold">工事区分</th>
                              <th className="px-3 py-2 font-semibold">品名</th>
                              <th className="px-3 py-2 text-right font-semibold">数量</th>
                              <th className="px-3 py-2 font-semibold">単位</th>
                              <th className="px-3 py-2 text-right font-semibold">単価</th>
                              <th className="px-3 py-2 text-right font-semibold">金額</th>
                              <th className="px-3 py-2 font-semibold">備考</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {pickerBaseMaster.lines.map((line) => (
                              <tr key={line.id}>
                                <td className="px-3 py-2 text-muted">{line.section}</td>
                                <td className="px-3 py-2 font-medium">{line.name}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                                <td className="px-3 py-2">{line.unit}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatYen(line.unitPrice)}</td>
                                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatYen(line.amount)}</td>
                                <td className="px-3 py-2 text-muted">{line.remark}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {pickerBaseMaster.lines.length === 0 && (
                          <p className="px-4 py-8 text-center text-sm text-muted">この公開版には明細がありません。</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="px-6 py-12 text-center">
                <p className="font-semibold">選択できる公開中の本体がありません。</p>
                <p className="mt-2 text-sm text-muted">
                  {baseMasterSourceReady
                    ? '本体マスターで公開版を作成すると、この画面から選択できます。'
                    : '本体マスターの正式な読込環境が接続されると、この画面から選択できます。'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
