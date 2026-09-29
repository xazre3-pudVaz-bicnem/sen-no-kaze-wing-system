'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { ChevronDown, Plus, Search, Trash2, X } from 'lucide-react';
import { createManualQuoteWorkbenchAction } from '@/lib/actions/admin';
import { FINISH_LEVELS, FINISH_LEVEL_INFO, type FinishLevel, type QuoteItemKind } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from '@/components/admin/forms';

const initialState = { ok: false } as const;

const KIND_LABELS: Record<Exclude<QuoteItemKind, 'discount'>, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  interior_exterior: '内外装工事',
  interior_exterior_expense: '内外装工事経費',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途工事',
  free: 'フリー商品',
};

type EditableKind = keyof typeof KIND_LABELS;

type WorkbenchRow = {
  key: string;
  line_key: string;
  kind: EditableKind;
  option_id: null;
  name: string;
  description: null;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  image_url: null;
};

export interface ManualQuoteWorkbenchModel {
  id: string;
  name: string;
  presets: { code: string; name: string; description: string }[];
}

export interface EstimatePickerRow {
  id: string;
  quote_no: string;
  customer_name: string;
  customer_company: string | null;
  base_model_name: string;
  revision: number;
  total: number;
  status_label: string;
  updated_at: string;
}

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

export function ManualQuoteWorkbench({
  models,
  estimates,
}: {
  models: ManualQuoteWorkbenchModel[];
  estimates: EstimatePickerRow[];
}) {
  const [state, action, pending] = useActionState(createManualQuoteWorkbenchAction, initialState);
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const model = models.find((row) => row.id === modelId) ?? models[0];
  const [rows, setRows] = useState<WorkbenchRow[]>([]);
  const [adjustment, setAdjustment] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const errors = state.fieldErrors ?? {};

  const filteredEstimates = useMemo(() => {
    const query = pickerQuery.trim().toLocaleLowerCase('ja');
    if (!query) return estimates;
    return estimates.filter((estimate) =>
      [
        estimate.quote_no,
        estimate.customer_name,
        estimate.customer_company,
        estimate.base_model_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ja')
        .includes(query)
    );
  }, [estimates, pickerQuery]);

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
  const subtotal = Math.max(0, subtotalRaw + adjustment);
  const tax = Math.floor(subtotal * 0.1);
  const total = subtotal + tax;

  const updateRow = (key: string, patch: Partial<WorkbenchRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-3" data-testid="manual-quote-workbench">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold text-muted">見積書</span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-sand"
            data-testid="estimate-picker-open"
          >
            新しい見積書
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <span className="text-xs text-muted">案件情報と明細を同じ画面で入力します</span>
      </div>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-3 py-[8vh]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPickerOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="見積書一覧"
            className="max-h-[78vh] w-full max-w-3xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
            data-testid="estimate-picker-dialog"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">見積書一覧</h2>
                <p className="mt-0.5 text-xs text-muted">開く見積書を選択してください。</p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-md p-2 text-muted hover:bg-sand hover:text-ink"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-line p-3">
              <label className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2">
                <Search className="h-4 w-4 text-muted" aria-hidden="true" />
                <input
                  value={pickerQuery}
                  onChange={(event) => setPickerQuery(event.target.value)}
                  placeholder="顧客名・見積番号・商品モデルで検索"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {filteredEstimates.map((estimate) => (
                <Link
                  key={estimate.id}
                  href={`/admin/quotes?case=${estimate.id}&tab=estimate#case-workspace`}
                  className="grid gap-1 border-b border-line px-4 py-3 hover:bg-[#f7faf8] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                  data-testid="estimate-picker-row"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {estimate.customer_name}
                      {estimate.customer_company ? ` ／ ${estimate.customer_company}` : ''}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {estimate.quote_no} ／ Revision {estimate.revision}
                    </p>
                  </div>
                  <div className="min-w-0 text-xs">
                    <p className="truncate font-semibold">{estimate.base_model_name}</p>
                    <p className="mt-0.5 text-muted">{estimate.status_label}</p>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {formatYen(estimate.total)}
                  </div>
                </Link>
              ))}
              {filteredEstimates.length === 0 && (
                <p className="px-4 py-10 text-center text-sm text-muted">該当する見積書がありません。</p>
              )}
            </div>
          </section>
        </div>
      )}

      <form action={action} className="space-y-3" noValidate>
        <input type="hidden" name="items_json" value={itemsJson} />
        <input type="hidden" name="base_master_revision_id" value="" />

        <Status state={state} />

        <section className="rounded-lg border border-line bg-white shadow-sm" data-testid="case-info-panel">
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">案件情報</h2>
            <p className="mt-0.5 text-[0.68rem] text-muted">
              見積書を作りながら、この案件の基本情報も登録できます。
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <Field label="案件名（任意）" htmlFor="quote-case-name" errors={errors.case_name}>
                <Input id="quote-case-name" name="case_name" placeholder="例：山田様 穴水宿泊棟" />
              </Field>
            </div>
            <Field label="お客様名" htmlFor="quote-customer-name" required errors={errors.customer_name}>
              <Input id="quote-customer-name" name="customer_name" required placeholder="例：山田 太郎" />
            </Field>
            <Field label="会社名（任意）" htmlFor="quote-company" errors={errors.customer_company}>
              <Input id="quote-company" name="customer_company" />
            </Field>
            <div className="md:col-span-2">
              <Field label="設置予定地（任意）" htmlFor="quote-site" errors={errors.site_address}>
                <Input id="quote-site" name="site_address" placeholder="例：石川県鳳珠郡穴水町○○" />
              </Field>
            </div>
            <Field label="商品モデル" htmlFor="quote-model" required errors={errors.base_model_id}>
              <Select
                id="quote-model"
                name="base_model_id"
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              >
                {models.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="仕様" htmlFor="quote-spec" required errors={errors.spec_code}>
              <Select id="quote-spec" name="spec_code" key={modelId} defaultValue={model?.presets[0]?.code}>
                {(model?.presets ?? []).map((preset) => (
                  <option key={preset.code} value={preset.code}>{preset.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="注文範囲" htmlFor="quote-finish" required errors={errors.finish_level}>
              <Select id="quote-finish" name="finish_level" defaultValue="full">
                {FINISH_LEVELS.map((level: FinishLevel) => (
                  <option key={level} value={level}>
                    {FINISH_LEVEL_INFO[level].name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-3">
              <Field label="メモ（任意）" htmlFor="quote-memo" errors={errors.memo}>
                <Textarea id="quote-memo" name="memo" rows={2} placeholder="現地条件・お客様のご要望など" />
              </Field>
            </div>
          </div>
        </section>

        <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-1 shadow-sm" aria-label="見積作業タブ">
          <button type="button" className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">見積書</button>
          <button type="button" disabled className="rounded-md px-4 py-2 text-sm font-semibold text-muted disabled:cursor-not-allowed">
            プランボード
          </button>
          <button type="button" disabled className="rounded-md px-4 py-2 text-sm font-semibold text-muted disabled:cursor-not-allowed">
            図面
          </button>
          <span className="ml-auto hidden pr-2 text-[0.68rem] text-muted sm:inline">プランボード・図面は下書き保存後に利用できます</span>
        </div>

        <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm" data-testid="new-estimate-excel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div>
              <h2 className="text-sm font-semibold">見積明細</h2>
              <p className="mt-0.5 text-[0.68rem] text-muted">Excelのように明細を追加・修正してから下書き保存します。</p>
            </div>
            <Button type="button" variant="secondary" onClick={() => setRows((current) => [...current, createRow()])}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              明細行を追加
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[72rem] border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
                  <th className="w-40 border-b border-r border-slate-300 px-2 py-2 text-left">区分</th>
                  <th className="min-w-[15rem] border-b border-r border-slate-300 px-2 py-2 text-left">品名</th>
                  <th className="w-24 border-b border-r border-slate-300 px-2 py-2 text-right">数量</th>
                  <th className="w-20 border-b border-r border-slate-300 px-2 py-2 text-left">単位</th>
                  <th className="w-32 border-b border-r border-slate-300 px-2 py-2 text-right">単価</th>
                  <th className="w-32 border-b border-r border-slate-300 px-2 py-2 text-right">金額</th>
                  <th className="min-w-[12rem] border-b border-r border-slate-300 px-2 py-2 text-left">備考</th>
                  <th className="w-12 border-b border-slate-300 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.key} className="border-b border-slate-200">
                    <td className="border-r border-slate-200 px-2 py-1 text-center text-muted">{index + 1}</td>
                    <td className="border-r border-slate-200 p-1">
                      <Select
                        value={row.kind}
                        onChange={(event) => updateRow(row.key, { kind: event.target.value as EditableKind })}
                        className="h-8 text-xs"
                      >
                        {Object.entries(KIND_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="border-r border-slate-200 p-1">
                      <Input
                        value={row.name}
                        onChange={(event) => updateRow(row.key, { name: event.target.value })}
                        className="h-8 text-xs"
                        placeholder="品名"
                      />
                    </td>
                    <td className="border-r border-slate-200 p-1">
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.quantity}
                        onChange={(event) => updateRow(row.key, { quantity: Number(event.target.value) || 0 })}
                        className="h-8 text-right text-xs"
                      />
                    </td>
                    <td className="border-r border-slate-200 p-1">
                      <Input
                        value={row.unit}
                        onChange={(event) => updateRow(row.key, { unit: event.target.value })}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="border-r border-slate-200 p-1">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={row.unit_price}
                        onChange={(event) => updateRow(row.key, { unit_price: Number(event.target.value) || 0 })}
                        className="h-8 text-right text-xs"
                      />
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1 text-right font-semibold tabular-nums">
                      {formatYen(roundLikePostgres(row.unit_price * row.quantity))}
                    </td>
                    <td className="border-r border-slate-200 p-1">
                      <Input
                        value={row.remark}
                        onChange={(event) => updateRow(row.key, { remark: event.target.value })}
                        className="h-8 text-xs"
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                        className="rounded p-1.5 text-muted hover:bg-red-50 hover:text-red-700"
                        aria-label={`${index + 1}行目を削除`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted">
                      明細はまだありません。「明細行を追加」から入力できます。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 border-t border-line bg-slate-50 p-4 md:grid-cols-[1fr_22rem]">
            <div className="text-xs text-muted">
              初回の下書き保存では、案件情報とこの明細を同時に保存します。正式なRevisionはまだ発行しません。
            </div>
            <div className="space-y-2 rounded-lg bg-white p-3 text-sm shadow-sm">
              <div className="flex justify-between gap-3"><span>明細合計</span><strong>{formatYen(subtotalRaw)}</strong></div>
              <label className="flex items-center justify-between gap-3">
                <span>調整額</span>
                <Input
                  type="number"
                  name="adjustment"
                  step="1"
                  value={adjustment}
                  onChange={(event) => setAdjustment(Number(event.target.value) || 0)}
                  className="h-8 w-32 text-right"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">調整理由</span>
                <Input
                  name="adjustment_reason"
                  value={adjustmentReason}
                  onChange={(event) => setAdjustmentReason(event.target.value)}
                  placeholder={adjustment === 0 ? '調整なし' : '必須'}
                  className="mt-1 h-8"
                />
              </label>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2"><span>税抜</span><strong>{formatYen(subtotal)}</strong></div>
              <div className="flex justify-between gap-3"><span>消費税</span><strong>{formatYen(tax)}</strong></div>
              <div className="flex justify-between gap-3 border-t-2 border-slate-500 pt-2 text-base"><span>税込合計</span><strong>{formatYen(total)}</strong></div>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 shadow-sm">
          <div>
            <p className="text-sm font-semibold">まず下書き保存</p>
            <p className="mt-1 text-xs text-muted">案件と見積Draftを同時に作成します。正式保存は次の画面で行います。</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled>正式保存</Button>
            <SubmitButton pending={pending} label="下書き保存して続ける" />
          </div>
        </div>
      </form>
    </div>
  );
}
