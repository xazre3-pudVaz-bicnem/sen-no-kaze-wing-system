'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { createManualQuoteWorkbenchAction } from '@/lib/actions/admin';
import type { QuoteItemKind } from '@/lib/domain/types';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from '@/components/admin/forms';
import {
  QuoteAuthoringGrid,
  QuoteAuthoringTabs,
  QuoteEditorTopbar,
  QuoteFinancialSummary,
  QuoteInternalRateStrip,
  isValidQuoteQuantity,
  quoteQuantityRule,
  type QuoteAuthoringRow,
  type QuoteAuthoringSection,
  type QuoteCatalogProduct,
  type QuotePickerRow,
} from '@/components/admin/quote-authoring-ui';

const initialState = { ok: false } as const;

type EditableKind = Exclude<QuoteItemKind, 'discount'>;

type WorkbenchRow = {
  key: string;
  line_key: string;
  kind: EditableKind;
  option_id: string | null;
  name: string;
  description: string | null;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  image_url: string | null;
};

export interface ManualQuoteWorkbenchModel {
  id: string;
  name: string;
  presets: { code: string; name: string; description: string }[];
}

export type EstimatePickerRow = QuotePickerRow;

function createRow(kind: EditableKind = 'installation'): WorkbenchRow {
  return {
    key: crypto.randomUUID(),
    line_key: crypto.randomUUID(),
    kind,
    option_id: null,
    name: '',
    description: null,
    unit: '式',
    remark: '',
    unit_price: 0,
    quantity: 1,
    image_url: null,
  };
}

function roundLikePostgres(value: number) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function CompactField({
  label,
  htmlFor,
  required,
  errors,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  errors?: string[];
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-semibold leading-none text-slate-600">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {errors?.length ? (
        <p className="mt-0.5 text-xs text-danger" role="alert">
          {errors[0]}
        </p>
      ) : null}
    </div>
  );
}

function kindForSection(section: QuoteAuthoringSection): EditableKind {
  if (section === 'base') return 'base';
  if (section === 'interior_exterior') return 'interior_exterior';
  if (section === 'option') return 'option';
  return 'installation';
}

export function ManualQuoteWorkbench({
  models,
  estimates,
  products,
  returnTo,
  canEditBase,
}: {
  models: ManualQuoteWorkbenchModel[];
  estimates: EstimatePickerRow[];
  products: QuoteCatalogProduct[];
  returnTo: '/admin/quotes' | '/admin/quote-management';
  canEditBase: boolean;
}) {
  const [state, action, pending] = useActionState(createManualQuoteWorkbenchAction, initialState);
  const [modelId, setModelId] = useState('');
  const [specCode, setSpecCode] = useState('');
  const model = models.find((row) => row.id === modelId);
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [adjustment, setAdjustment] = useState(0);
  const [caseName, setCaseName] = useState('');
  const [customerLastName, setCustomerLastName] = useState('');
  const [customerFirstName, setCustomerFirstName] = useState('');
  const customerName = customerLastName.trim() && customerFirstName.trim()
    ? `${customerLastName.trim()} ${customerFirstName.trim()}`
    : '';
  const [companyName, setCompanyName] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [activeTab, setActiveTab] = useState<'estimate' | 'planboard' | 'drawings'>('estimate');
  const [dirty, setDirty] = useState(false);
  const allowLeaveRef = useRef(false);
  const errors = state.fieldErrors ?? {};

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty || allowLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!pending && !state.ok) allowLeaveRef.current = false;
  }, [pending, state.ok]);

  const markDirty = () => setDirty(true);
  const confirmLeave = () =>
    !dirty ||
    window.confirm('保存していない内容があります。保存せずに別の画面へ移動しますか？');

  const itemsJson = JSON.stringify(
    rows.map(({ key: _key, ...row }) => ({
      ...row,
      remark: row.remark || null,
    }))
  );

  const subtotalRaw = rows.reduce(
    (sum, row) => sum + roundLikePostgres(row.unit_price * row.quantity),
    0
  );
  const taxExclContractAmount = Math.max(0, subtotalRaw + adjustment);
  const tax = Math.floor(taxExclContractAmount * 0.1);
  const total = taxExclContractAmount + tax;

  const authoringRows: QuoteAuthoringRow[] = rows.map((row) => ({
    key: row.key,
    kind: row.kind,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unit_price,
    amount: roundLikePostgres(row.unit_price * row.quantity),
    remark: row.remark || null,
    optionId: row.option_id,
    locked: !canEditBase && (row.kind === 'base' || row.kind === 'base_expense'),
  }));

  const updateAuthoringRow = (
    key: string,
    patch: Partial<Pick<QuoteAuthoringRow, 'name' | 'quantity' | 'unit' | 'unitPrice' | 'remark'>>
  ) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;

        let nextUnit = row.unit ;
        let nextQuantity = row.quantity;

        if (patch.unit !== undefined) {
          nextUnit = patch.unit ?? '';
          if (quoteQuantityRule(nextUnit) === 'fixed-one') nextQuantity = 1;
          else if (!isValidQuoteQuantity(nextQuantity, nextUnit)) return row;
        }
        if (patch.quantity !== undefined) {
          if (!isValidQuoteQuantity(patch.quantity, nextUnit)) return row;
          nextQuantity = patch.quantity;
        }

        return {
          ...row,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.quantity !== undefined || patch.unit !== undefined ? { quantity: nextQuantity } : {}),
          ...(patch.unit !== undefined ? { unit: nextUnit } : {}),
          ...(patch.unitPrice !== undefined ? { unit_price: patch.unitPrice } : {}),
          ...(patch.remark !== undefined ? { remark: patch.remark ?? '' } : {}),
        };
      })
    );
    markDirty();
  };

  const addAuthoringRow = (section: QuoteAuthoringSection) => {
    if (section === 'base' && !canEditBase) return;
    setRows((current) => [...current, createRow(kindForSection(section))]);
    markDirty();
  };

  const selectCatalogProduct = (
    section: QuoteAuthoringSection,
    targetKey: string | null,
    product: QuoteCatalogProduct
  ) => {
    if (section === 'base' && !canEditBase) return;
    const productRemark = product.priceOnRequest
      ? '別途見積'
      : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ ');
    const productPatch = {
      option_id: product.id,
      name: product.name,
      unit_price: product.priceOnRequest ? 0 : product.price,
      remark: productRemark,
      image_url: product.imageUrl,
    };

    setRows((current) => {
      const duplicate = current.some((row) => row.option_id === product.id && row.key !== targetKey);
      if (duplicate) return current;
      if (targetKey) {
        return current.map((row) => (row.key === targetKey ? { ...row, ...productPatch } : row));
      }
      return [
        ...current,
        {
          ...createRow(kindForSection(section)),
          ...productPatch,
        },
      ];
    });
    markDirty();
  };

  const removeAuthoringRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    markDirty();
  };

  return (
    <div className="space-y-2" data-testid="manual-quote-workbench">
      <Link
        href={returnTo}
        className="inline-flex text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
        onClick={(event) => {
          if (!confirmLeave()) event.preventDefault();
        }}
      >
        ← {returnTo === '/admin/quote-management' ? '見積書管理' : '案件管理'}へ戻る
      </Link>

      <QuoteEditorTopbar mode="new" estimates={estimates} confirmLeave={confirmLeave} />

      <div className="rounded-lg border border-[#d8e4de] bg-[#f5faf7] px-3 py-2 text-xs leading-5 text-ink-soft" data-testid="manual-quote-role-note">
        この画面では、対面・電話・紹介などの新規案件と最初の見積下書きを登録します。
        現場工事金額は、案件登録後に現地確認を行い、案件管理から入力します。正式見積の発行も案件管理から行います。
      </div>

      <form
        action={action}
        className="space-y-2"
        noValidate
        onChangeCapture={markDirty}
        onSubmit={() => {
          allowLeaveRef.current = true;
        }}
      >
        <input type="hidden" name="items_json" value={itemsJson} />
        <input type="hidden" name="base_master_revision_id" value="" />
        <input type="hidden" name="adjustment" value={adjustment} />
        <input type="hidden" name="finish_level" value="full" />
        <input type="hidden" name="customer_name" value={customerName} />

        <Status state={state} />

        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" data-testid="manual-quote-editor-shell">
          <section className="border-b border-slate-200 bg-white" data-testid="case-info-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-1.5">
              <h2 className="text-sm font-semibold">案件情報</h2>
              <div className="flex flex-wrap items-center gap-2 text-[0.65rem] text-muted">
                <span>電話・メール・お客様住所の入力機能は現在準備中です</span>
                <span>* 必須</span>
              </div>
            </div>

            <div className="grid gap-x-2 gap-y-1 p-2.5 sm:grid-cols-2 lg:grid-cols-12">
              <div className="sm:col-span-2 lg:col-span-12">
                <CompactField label="案件名" htmlFor="quote-case-name" errors={errors.case_name}>
                  <Input
                    id="quote-case-name"
                    name="case_name"
                    value={caseName}
                    onChange={(event) => setCaseName(event.target.value)}
                    placeholder="例：山田様 穴水宿泊棟"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="lg:col-span-3">
                <CompactField label="お客様名（姓）" htmlFor="quote-customer-last-name" required errors={errors.customer_name}>
                  <Input
                    id="quote-customer-last-name"
                    required
                    value={customerLastName}
                    onChange={(event) => setCustomerLastName(event.target.value)}
                    placeholder="例：山田"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="lg:col-span-3">
                <CompactField label="お客様名（名）" htmlFor="quote-customer-first-name" required>
                  <Input
                    id="quote-customer-first-name"
                    required
                    value={customerFirstName}
                    onChange={(event) => setCustomerFirstName(event.target.value)}
                    placeholder="例：太郎"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <CompactField label="会社名" htmlFor="quote-company" errors={errors.customer_company}>
                  <Input
                    id="quote-company"
                    name="customer_company"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>

              <div className="lg:col-span-3">
                <CompactField label="電話番号" htmlFor="quote-phone">
                  <Input
                    id="quote-phone"
                    value=""
                    readOnly
                    disabled
                    placeholder="現在準備中"
                    title="電話番号の入力機能は現在準備中です"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="lg:col-span-5">
                <CompactField label="メールアドレス" htmlFor="quote-email">
                  <Input
                    id="quote-email"
                    value=""
                    readOnly
                    disabled
                    placeholder="現在準備中"
                    title="メールアドレスの入力機能は現在準備中です"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="sm:col-span-2 lg:col-span-8">
                <CompactField label="お客様住所" htmlFor="quote-customer-address">
                  <Input
                    id="quote-customer-address"
                    value=""
                    readOnly
                    disabled
                    placeholder="現在準備中"
                    title="お客様住所の入力機能は現在準備中です"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>

              <div className="sm:col-span-2 lg:col-span-8">
                <CompactField label="設置予定地" htmlFor="quote-site" errors={errors.site_address}>
                  <Input
                    id="quote-site"
                    name="site_address"
                    value={siteAddress}
                    onChange={(event) => setSiteAddress(event.target.value)}
                    placeholder="例：石川県鳳珠郡穴水町○○"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="lg:col-span-3 lg:col-start-1">
                <CompactField label="商品モデル" htmlFor="quote-model" required errors={errors.base_model_id}>
                  <Select
                    id="quote-model"
                    name="base_model_id"
                    value={modelId}
                    required
                    onChange={(event) => {
                      setModelId(event.target.value);
                      setSpecCode('');
                    }}
                    className="h-7 min-h-7 text-sm"
                  >
                    <option value="">選択してください</option>
                    {models.map((row) => (
                      <option key={row.id} value={row.id}>{row.name}</option>
                    ))}
                  </Select>
                </CompactField>
              </div>
              <div className="lg:col-span-3">
                <CompactField label="仕様" htmlFor="quote-spec" required errors={errors.spec_code}>
                  <Select
                    id="quote-spec"
                    name="spec_code"
                    key={modelId}
                    value={specCode}
                    onChange={(event) => setSpecCode(event.target.value)}
                    required
                    disabled={!modelId}
                    className="h-7 min-h-7 text-sm"
                  >
                    <option value="">{modelId ? '選択してください' : '商品モデルを先に選択'}</option>
                    {(model?.presets ?? []).map((preset) => (
                      <option key={preset.code} value={preset.code}>{preset.name}</option>
                    ))}
                  </Select>
                </CompactField>
              </div>
              <div className="lg:col-span-3">
                <CompactField label="防火仕様" htmlFor="quote-fire-spec">
                  <Input
                    id="quote-fire-spec"
                    value="現在準備中"
                    readOnly
                    disabled
                    title="防火仕様の選択機能は現在準備中です"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>
              <div className="lg:col-span-3">
                <CompactField label="適用地域" htmlFor="quote-region">
                  <Input
                    id="quote-region"
                    value="未設定"
                    readOnly
                    disabled
                    title="適用地域の設定機能は現在準備中です"
                    className="h-7 min-h-7 px-2 text-sm"
                  />
                </CompactField>
              </div>

              <div className="sm:col-span-2 lg:col-span-12 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[10px] leading-4 text-slate-600" data-testid="new-quote-base-master-pending">
                商品モデル・仕様・防火仕様を選ぶと、登録済みの本体内容が自動で反映されます。この機能は現在準備中です。
              </div>

              <div className="sm:col-span-2 lg:col-span-12">
                <CompactField label="メモ" htmlFor="quote-memo" errors={errors.memo}>
                  <Textarea
                    id="quote-memo"
                    name="memo"
                    rows={1}
                    placeholder="現地条件・お客様のご要望など"
                    className="min-h-7 resize-y py-1 text-sm"
                  />
                </CompactField>
              </div>
            </div>
          </section>

          <QuoteAuthoringTabs active={activeTab} onChange={setActiveTab} />
          {activeTab === 'estimate' ? (
            <>
              <QuoteInternalRateStrip showPlannedDefaults />
              <QuoteAuthoringGrid
                rows={authoringRows}
                products={products}
                baseModelId={modelId}
                specCode={specCode}
                onUpdate={updateAuthoringRow}
                onRemove={removeAuthoringRow}
                onAddFree={addAuthoringRow}
                onSelectProduct={selectCatalogProduct}
              />
            </>
          ) : activeTab === 'planboard' ? (
            <section className="p-4" data-testid="new-quote-planboard-state">
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <h3 className="text-sm font-semibold text-slate-700">プランボード</h3>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {modelId && specCode
                    ? '商品モデル・仕様は選択済みです。案件登録後、案件管理のプランボードで確認できるようにします。'
                    : '商品モデル・仕様を選択すると、プランボード表示の準備ができます。'}
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  案件登録前は、確定した案件プランとして表示しません。
                </p>
              </div>
            </section>
          ) : (
            <section className="p-4" data-testid="new-quote-drawings-state">
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
                <h3 className="text-sm font-semibold text-slate-700">図面</h3>
                <p className="mt-2 text-xs leading-5 text-muted">
                  案件登録前のため、表示できる案件図面はまだありません。
                </p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                  案件図面の管理機能は現在準備中です。案件登録後の案件管理から確認できるようにします。
                </p>
              </div>
            </section>
          )}
        </div>

        <QuoteFinancialSummary
          subtotalRaw={subtotalRaw}
          adjustment={adjustment}
          tax={tax}
          total={total}
          onAdjustment={(value) => {
            setAdjustment(value);
            markDirty();
          }}
          adjustmentLabel="値引き等調整額"
          showAdjustmentReason={false}
          showTaxExclContractAmount
          totalLabel="見積金額（税込）"
        />

        <div className="rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
          <p className="mb-2 text-right text-[10px] leading-4 text-muted">
            登録すると案件一覧に追加されます。
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SubmitButton pending={pending} label="案件として登録" />
          </div>
        </div>
      </form>
    </div>
  );
}