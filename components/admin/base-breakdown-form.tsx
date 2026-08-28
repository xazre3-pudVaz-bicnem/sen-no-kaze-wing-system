'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { saveBaseBreakdownAction } from '@/lib/actions/admin';
import { formatYen } from '@/lib/domain/pricing';
import type { BaseBreakdownItem } from '@/lib/domain/types';
import { Button, Input } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

interface Row {
  key: string;
  section: string;
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  remark: string;
}

/**
 * 本体内訳マスター（分類表見積書）の編集表。
 * 先方要望「見積書（本体の明細）を俺が書き換えられるようにすれば、本体の見積も全部出来上がる」。
 * ここを直すと、以降に作られる見積の本体明細と本体一式の金額が変わる。
 * 発行済みの見積はスナップショットのため変わらない。
 */
export function BaseBreakdownForm({
  modelId,
  specCode,
  items,
  expenseRate,
}: {
  modelId: string;
  specCode: string;
  items: BaseBreakdownItem[];
  expenseRate: number;
}) {
  const [state, action, pending] = useActionState(saveBaseBreakdownAction, initial);
  const [rows, setRows] = useState<Row[]>(() =>
    items.map((b, i) => ({
      key: `${b.id}-${i}`,
      section: b.section,
      name: b.name,
      quantity: b.quantity,
      unit: b.unit ?? '',
      unit_price: b.unit_price,
      remark: b.remark ?? '',
    }))
  );
  const update = (key: string, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = (afterKey?: string) =>
    setRows((cur) => {
      const i = afterKey ? cur.findIndex((r) => r.key === afterKey) : cur.length - 1;
      const base = i >= 0 ? cur[i] : undefined;
      const row: Row = {
        key: `new-${Date.now()}-${cur.length}`,
        section: base?.section ?? '',
        name: '',
        quantity: 1,
        unit: base?.unit ?? '式',
        unit_price: 0,
        remark: '',
      };
      const next = [...cur];
      next.splice(i + 1, 0, row);
      return next;
    });

  const amountOf = (r: Row) => Math.round(r.unit_price * Math.max(0.01, r.quantity || 0));
  const linesTotal = rows.reduce((s, r) => s + amountOf(r), 0);
  const expense = Math.floor(linesTotal * expenseRate);

  return (
    <form action={action} className="card space-y-5 p-6" noValidate data-testid="base-breakdown-form">
      <input type="hidden" name="base_model_id" value={modelId} />
      <input type="hidden" name="spec_code" value={specCode} />
      <Status state={state} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="w-44 px-3 py-2 font-semibold">工事区分</th>
              <th className="px-3 py-2 font-semibold">品名</th>
              <th className="w-20 px-3 py-2 text-right font-semibold">数量</th>
              <th className="w-16 px-3 py-2 font-semibold">単位</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">単価（売価）</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-36 px-3 py-2 font-semibold">備考</th>
              <th className="w-16 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`breakdown-row-${i}`}>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.section`} value={r.section} onChange={(e) => update(r.key, { section: e.target.value })} aria-label={`${i + 1} 行目の工事区分`} className="text-xs" required />
                </td>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.name`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} aria-label={`${i + 1} 行目の品名`} required />
                </td>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.quantity`} type="number" min={0.01} step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: Number(e.target.value) })} aria-label={`${i + 1} 行目の数量`} className="text-right" />
                </td>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.unit`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} aria-label={`${i + 1} 行目の単位`} />
                </td>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.unit_price`} type="number" min={0} value={r.unit_price} onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })} aria-label={`${i + 1} 行目の単価`} className="text-right" />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatYen(amountOf(r))}</td>
                <td className="px-3 py-1.5">
                  <Input name={`items.${i}.remark`} value={r.remark} onChange={(e) => update(r.key, { remark: e.target.value })} aria-label={`${i + 1} 行目の備考`} className="text-xs" />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <button type="button" onClick={() => addRow(r.key)} className="rounded p-1 text-muted hover:bg-sand hover:text-forest" aria-label={`${i + 1} 行目の下に行を追加`} title="下に行を追加">
                    <Plus className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} className="rounded p-1 text-muted hover:bg-sand hover:text-warn" aria-label={`${i + 1} 行目を削除`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted">
                  内訳がありません。「行を追加」から登録してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => addRow()} data-testid="breakdown-add-row">
          <Plus className="size-4" aria-hidden="true" />
          行を追加
        </Button>
        <dl className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <div className="flex gap-2"><dt className="text-muted">明細合計</dt><dd className="tabular-nums">{formatYen(linesTotal)}</dd></div>
          <div className="flex gap-2"><dt className="text-muted">諸費用（{Math.round(expenseRate * 100)}%）</dt><dd className="tabular-nums">{formatYen(expense)}</dd></div>
          <div className="flex gap-2 font-semibold"><dt>本体価格計</dt><dd className="tabular-nums" data-testid="breakdown-total">{formatYen(linesTotal + expense)}</dd></div>
        </dl>
      </div>

      <p className="text-xs text-muted">
        保存すると、これから作られる見積の本体明細・本体一式の金額に反映されます。発行済みの見積書は変わりません。
      </p>
      <SubmitButton pending={pending} label="この内訳で保存する" />
    </form>
  );
}
