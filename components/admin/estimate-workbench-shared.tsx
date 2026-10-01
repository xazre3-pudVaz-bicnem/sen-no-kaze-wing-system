'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

export type EstimateRateValues = {
  salesExpenseRate: number;
  expenseRate: number;
  markupRate: number;
};

export function EstimateRateControls({
  values,
  editable,
  onChange,
  note,
  valueNote,
  grossProfitLabel = '—',
  grossProfitRateLabel = '—',
  leadingContent,
  trailingActions,
}: {
  values: EstimateRateValues;
  editable: boolean;
  onChange?: (next: EstimateRateValues) => void;
  note?: string;
  valueNote?: string;
  grossProfitLabel?: string;
  grossProfitRateLabel?: string;
  leadingContent?: ReactNode;
  trailingActions?: ReactNode;
}) {
  const update = (key: keyof EstimateRateValues, value: number) => {
    if (!editable || !onChange) return;
    onChange({ ...values, [key]: Math.max(0, value) });
  };

  const rateField = (
    label: string,
    ariaLabel: string,
    key: keyof EstimateRateValues
  ) => (
    <label className="flex items-center gap-1">
      <span className="text-slate-600">{label}</span>
      <Input
        type="number"
        min={0}
        step={1}
        value={values[key]}
        disabled={!editable}
        onChange={(event) => update(key, Number(event.target.value))}
        className="h-6 min-h-6 w-14 px-1 text-right text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
        aria-label={ariaLabel}
      />
      <span>%</span>
      {valueNote ? <span className="text-[9px] text-slate-400">{valueNote}</span> : null}
    </label>
  );

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-200 bg-amber-50/35 px-3 py-1.5 text-[11px]"
      data-testid="shared-estimate-rate-controls"
    >
      {leadingContent}
      <span className="font-semibold text-slate-700">計算条件</span>
      {rateField('販売費', '販売費率', 'salesExpenseRate')}
      {rateField('経費', '経費率', 'expenseRate')}
      {rateField('掛率', '掛率', 'markupRate')}
      <span className="border-l border-slate-300 pl-2 text-slate-600">
        粗利 <strong className="ml-1 text-slate-500">{grossProfitLabel}</strong>
      </span>
      <span className="text-slate-600">
        粗利率 <strong className="ml-1 text-slate-500">{grossProfitRateLabel}</strong>
      </span>
      {note ? <span className="text-[10px] text-slate-500">{note}</span> : null}
      {trailingActions ? <div className="ml-auto flex flex-wrap items-center gap-1.5">{trailingActions}</div> : null}
    </div>
  );
}

export function EstimateMoneyStrip({
  subtotalRaw,
  adjustment,
  tax,
  total,
  onAdjustment,
  subtotalLabel = '税別',
  adjustmentLabel = '調整',
  totalLabel = '税込',
}: {
  subtotalRaw: number;
  adjustment: number;
  tax: number;
  total: number;
  onAdjustment?: (value: number) => void;
  subtotalLabel?: string;
  adjustmentLabel?: string;
  totalLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center divide-x divide-slate-200 border-b border-slate-200 text-[11px]"
      data-testid="shared-estimate-money-strip"
    >
      <span className="px-3 py-1">
        {subtotalLabel} <strong className="ml-1 text-sm text-slate-900">{formatYen(subtotalRaw)}</strong>
      </span>
      <label className="flex items-center gap-1 px-3 py-0.5">
        <span className="whitespace-nowrap text-slate-600">{adjustmentLabel}</span>
        <Input
          type="number"
          step={1}
          value={adjustment}
          readOnly={!onAdjustment}
          onChange={(event) => onAdjustment?.(Number(event.target.value) || 0)}
          className="h-6 min-h-6 w-20 px-1 text-right text-xs read-only:bg-slate-100 read-only:text-slate-600"
          aria-label="値引き等調整額"
        />
      </label>
      <span className="px-3 py-1">
        消費税 <strong className="ml-1 text-sm text-slate-900">{formatYen(tax)}</strong>
      </span>
      <span className="px-3 py-1">
        {totalLabel} <strong className="ml-1 text-base text-slate-900">{formatYen(total)}</strong>
      </span>
    </div>
  );
}
