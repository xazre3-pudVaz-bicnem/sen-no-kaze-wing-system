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

export interface InitialEstimateTarget {
  modelId: string;
  specCode: string;
  fireSpec: 'non_fire' | 'fire';
}

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

function fireLabel(code: EstimateBaseMasterChoice['fireSpec']) {
  return code === 'fire' ? '防火' : '非防火';
}

export function NewEstimateTemplateForm({
  role,
  models,
  baseMasters,
  baseMasterSourceReady,
  sampleBaseMaster,
  initialTarget,
  products,
}: {
  role: 'admin' | 'master_dealer' | 'dealer' | 'customer';
  models: TemplateModel[];
  baseMasters: EstimateBaseMasterChoice[];
  baseMasterSourceReady: boolean;
  sampleBaseMaster: EstimateBaseMasterChoice | null;
  initialTarget?: InitialEstimateTarget | null;
  products: EstimateTemplateWorkbenchProduct[];
}) {
  const availableBaseMasters = initialTarget
    ? baseMasters.filter(
        (baseMaster) =>
          baseMaster.modelId === initialTarget.modelId &&
          baseMaster.fireSpec === initialTarget.fireSpec
      )
    : baseMasters;
  const initialBaseMaster = availableBaseMasters.length === 1 ? availableBaseMasters[0] : null;

  const [selectedBaseMasterId, setSelectedBaseMasterId] = useState(initialBaseMaster?.id ?? '');
  const [pickerBaseMasterId, setPickerBaseMasterId] = useState(initialBaseMaster?.id ?? '');
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [spec, setSpec] = useState(initialTarget?.specCode ?? '');
  const [region, setRegion] = useState<(typeof REGION_OPTIONS)[number]['value']>('all');
  const [customName, setCustomName] = useState<string | null>(null);

  const selectedBaseMaster = useMemo(
    () =>
      baseMasters.find((baseMaster) => baseMaster.id === selectedBaseMasterId) ??
      (sampleBaseMaster?.id === selectedBaseMasterId ? sampleBaseMaster : null),
    [baseMasters, sampleBaseMaster, selectedBaseMasterId]
  );
  const samplePreview = Boolean(sampleBaseMaster && selectedBaseMasterId === sampleBaseMaster.id);
  const pickerBaseMaster = useMemo(
    () =>
      availableBaseMasters.find((baseMaster) => baseMaster.id === pickerBaseMasterId) ??
      selectedBaseMaster ??
      availableBaseMasters[0] ??
      null,
    [availableBaseMasters, pickerBaseMasterId, selectedBaseMaster]
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
  const targetModel = initialTarget
    ? models.find((model) => model.id === initialTarget.modelId) ?? null
    : null;
  const targetSpec = targetModel?.specs.find((item) => item.code === initialTarget?.specCode) ?? null;
  const generatedName = useMemo(
    () => [modelName, specLabel, selectedFireLabel].filter(Boolean).join(' '),
    [modelName, specLabel, selectedFireLabel]
  );
  const name = customName ?? generatedName;

  const modelNameFor = (baseMaster: EstimateBaseMasterChoice) =>
    models.find((model) => model.id === baseMaster.modelId)?.name ?? '—';

  const openBasePicker = () => {
    setPickerBaseMasterId(selectedBaseMaster?.id ?? availableBaseMasters[0]?.id ?? '');
    setBasePickerOpen(true);
  };

  const chooseBaseMaster = (baseMaster: EstimateBaseMasterChoice) => {
    if (
      selectedBaseMaster &&
      selectedBaseMaster.id !== baseMaster.id &&
      !window.confirm('本体を変更すると、現在表示中の本体明細は選択した本体の内容に置き換わります。変更しますか？')
    ) {
      return;
    }

    const model = models.find((item) => item.id === baseMaster.modelId) ?? null;
    const preferredSpec =
      initialTarget && initialTarget.modelId === baseMaster.modelId
        ? model?.specs.find((item) => item.code === initialTarget.specCode) ?? null
        : null;
    setSelectedBaseMasterId(baseMaster.id);
    setPickerBaseMasterId(baseMaster.id);
    setSpec(preferredSpec?.code ?? model?.specs[0]?.code ?? '');
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
  };

  const handleSpecChange = (value: string) => {
    setSpec(value);
    setCustomName(null);
  };

  return (
    <>
      <div className="space-y-4">
        <section className="card overflow-hidden" data-testid="new-estimate-conditions">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold">{name || '新しい見積書'}</h2>
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {samplePreview ? '画面確認用' : '新規見積書'}
                </span>
                {initialTarget && targetModel && targetSpec && (
                  <span className="rounded-full border border-forest/20 bg-forest/5 px-2 py-0.5 text-[11px] font-semibold text-forest">
                    作成対象：{targetModel.name === 'フラット' ? 'Flat' : targetModel.name} ／ {targetSpec.name} ／ {fireLabel(initialTarget.fireSpec)}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                本体・仕様・適用地域をここで設定し、そのまま下の明細を編集できます。
              </p>
            </div>
            <Link href="/admin/estimate-templates" className="btn-secondary btn-sm">見積書作成・管理へ戻る</Link>
          </div>

          <div className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="block">
                <span className="label">使用する本体</span>
                {selectedBaseMaster ? (
                  <button
                    type="button"
                    className="mt-1 flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 text-left text-sm hover:border-forest/40"
                    onClick={openBasePicker}
                  >
                    <span className="min-w-0 truncate font-semibold">{selectedBaseMaster.name}</span>
                    <span className="shrink-0 text-[10px] text-muted">公開版 v{selectedBaseMaster.revisionVersion}</span>
                  </button>
                ) : (
                  <button type="button" className="btn-primary mt-1 h-10 w-full justify-center" onClick={openBasePicker}>
                    本体を選ぶ
                  </button>
                )}
                <span className="mt-1 block text-[10px] text-muted">
                  {selectedBaseMaster
                    ? '本体管理元：' + selectedBaseMaster.ownerName
                    : '本体が未選択です。'}
                </span>
              </div>

              <div className="block">
                <span className="label">商品モデル</span>
                <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-sand/15 px-3 text-sm font-semibold">
                  {modelName || '本体を選ぶと自動設定'}
                </div>
              </div>

              <label className="block">
                <span className="label">仕様</span>
                <SelectWithArrow
                  value={selectedSpec?.code ?? ''}
                  onChange={handleSpecChange}
                  disabled={!selectedBaseMaster || availableSpecs.length === 0}
                >
                  {!selectedBaseMaster ? (
                    <option value="">先に本体を選択</option>
                  ) : availableSpecs.length > 0 ? (
                    availableSpecs.map((item) => (
                      <option key={item.code} value={item.code}>{item.name}</option>
                    ))
                  ) : (
                    <option value="">仕様が登録されていません</option>
                  )}
                </SelectWithArrow>
              </label>

              <div className="block">
                <span className="label">防火仕様</span>
                <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-sand/15 px-3 text-sm font-semibold">
                  {selectedFireLabel || '本体を選ぶと自動設定'}
                </div>
              </div>

              <label className="block">
                <span className="label">適用地域</span>
                <SelectWithArrow value={region} onChange={(value) => setRegion(value as typeof region)}>
                  {REGION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </SelectWithArrow>
              </label>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[18rem] flex-1">
                <span className="label">見積書名</span>
                <Input
                  className="mt-1 h-10 w-full"
                  value={name}
                  placeholder="本体を選ぶと自動入力します"
                  onChange={(event) => setCustomName(event.target.value)}
                />
              </label>
              {selectedBaseMaster && (
                <button type="button" className="btn-secondary btn-sm h-10" onClick={openBasePicker}>
                  本体を変更・明細確認
                </button>
              )}
            </div>

            {!baseMasterSourceReady && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-ink-soft">
                <span>本体マスターの正式データが未接続のため、画面確認用サンプルで明細編集を確認できます。</span>
                {sampleBaseMaster && (
                  <button type="button" className="btn-secondary btn-sm" onClick={openSampleEditor}>
                    サンプルを表示
                  </button>
                )}
              </div>
            )}

            {baseMasterSourceReady && baseMasters.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sand/20 px-3 py-2 text-[11px] text-muted">
                <span>公開中の本体マスターがありません。公開版を用意すると、この画面から選択できます。</span>
                {sampleBaseMaster && (
                  <button type="button" className="btn-secondary btn-sm" onClick={openSampleEditor}>
                    サンプルを表示
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {!samplePreview && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-xs leading-relaxed text-ink-soft">
            <strong className="font-semibold text-ink">現在は画面確認用です。</strong>
            {' 編集内容は保存されません。保存・公開機能は準備中です。'}
          </div>
        )}

        {!selectedBaseMaster && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-sand/20 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">本体が未選択です</p>
              <p className="mt-0.5 text-xs text-muted">本体を選ぶと、この見積書の本体明細を読み込みます。</p>
            </div>
            <button type="button" className="btn-primary btn-sm" onClick={openBasePicker}>本体を選ぶ</button>
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

      {basePickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="使用する本体を選択">
          <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">使用する本体を選択</h2>
                <p className="mt-1 text-xs text-muted">公開中の本体マスターから、明細と金額を確認して選びます。</p>
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setBasePickerOpen(false)}>閉じる</button>
            </div>

            {availableBaseMasters.length > 0 ? (
              <div className="grid min-h-0 flex-1 lg:grid-cols-[19rem_1fr]">
                <aside className="max-h-[72vh] overflow-y-auto border-b border-line bg-sand/10 p-3 lg:border-b-0 lg:border-r">
                  <div className="space-y-2">
                    {availableBaseMasters.map((baseMaster) => {
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
                            <span className="shrink-0 text-[10px] text-muted">公開版 v{baseMaster.revisionVersion}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-muted">
                            {modelNameFor(baseMaster)} ／ {fireLabel(baseMaster.fireSpec)}
                          </p>
                          <p className="mt-1 text-[11px] text-muted">本体管理元：{baseMaster.ownerName}</p>
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
                            {modelNameFor(pickerBaseMaster)} ／ {fireLabel(pickerBaseMaster.fireSpec)} ／ 本体管理元：{pickerBaseMaster.ownerName}
                          </p>
                        </div>
                        <button type="button" className="btn-primary btn-sm" onClick={() => chooseBaseMaster(pickerBaseMaster)}>
                          この本体を使う
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
                  {initialTarget && baseMasterSourceReady
                    ? '作成対象の商品モデル・防火仕様に一致する公開中の本体がありません。'
                    : baseMasterSourceReady
                      ? '本体マスターで公開版を作成すると、この画面から選択できます。'
                      : '本体マスターの正式データが接続されると、この画面から選択できます。'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
