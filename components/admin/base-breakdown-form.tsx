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
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  remark: string;
}

interface Section {
  key: string;
  name: string;
  rows: Row[];
}

let seq = 0;
const newKey = () => `k${++seq}-${Date.now()}`;

/**
 * 本体内訳マスター（分類表見積書）の編集表。
 * 先方修正案（2026-08-28）に合わせて、エクセルと同じく
 *   工事区分の見出し行 → 明細行 → 区分ごとの小計
 * の形で編集する。区分の追加・行の追加が自由にでき、数量は小数第1位まで。
 * ここを直すと、以降に作られる見積の本体明細と本体一式の金額が変わる（発行済みは変わらない）。
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
  const [sections, setSections] = useState<Section[]>(() => {
    const out: Section[] = [];
    for (const b of items) {
      const last = out[out.length - 1];
      const row: Row = { key: newKey(), name: b.name, quantity: b.quantity, unit: b.unit ?? '', unit_price: b.unit_price, remark: b.remark ?? '' };
      if (last && last.name === b.section) last.rows.push(row);
      else out.push({ key: newKey(), name: b.section, rows: [row] });
    }
    return out;
  });

  const amountOf = (r: Row) => Math.round(r.unit_price * Math.max(0.01, r.quantity || 0));
  const sectionTotal = (sec: Section) => sec.rows.reduce((s, r) => s + amountOf(r), 0);
  const linesTotal = sections.reduce((s, sec) => s + sectionTotal(sec), 0);
  const expense = Math.floor(linesTotal * expenseRate);

  const updateSection = (key: string, name: string) => setSections((cur) => cur.map((s) => (s.key === key ? { ...s, name } : s)));
  const updateRow = (secKey: string, rowKey: string, patch: Partial<Row>) =>
    setSections((cur) =>
      cur.map((s) => (s.key === secKey ? { ...s, rows: s.rows.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)) } : s))
    );
  const addRow = (secKey: string, afterKey?: string) =>
    setSections((cur) =>
      cur.map((s) => {
        if (s.key !== secKey) return s;
        const i = afterKey ? s.rows.findIndex((r) => r.key === afterKey) : s.rows.length - 1;
        const base = i >= 0 ? s.rows[i] : undefined;
        const rows = [...s.rows];
        rows.splice(i + 1, 0, { key: newKey(), name: '', quantity: 1, unit: base?.unit ?? '式', unit_price: 0, remark: '' });
        return { ...s, rows };
      })
    );
  const removeRow = (secKey: string, rowKey: string) =>
    setSections((cur) => cur.map((s) => (s.key === secKey ? { ...s, rows: s.rows.filter((r) => r.key !== rowKey) } : s)).filter((s) => s.rows.length > 0));
  const addSection = () =>
    setSections((cur) => [
      ...cur,
      {
        key: newKey(),
        name: `${cur.length + 1}．新しい工事区分`,
        rows: [{ key: newKey(), name: '', quantity: 1, unit: '式', unit_price: 0, remark: '' }],
      },
    ]);
  const removeSection = (secKey: string) => setSections((cur) => cur.filter((s) => s.key !== secKey));

  // フォーム送信用の通し番号（表示順のまま。レンダー中の再代入を避けて事前計算する）
  const offsets = sections.map((_, i) => sections.slice(0, i).reduce((a, sec) => a + sec.rows.length, 0));

  return (
    <form action={action} className="card space-y-5 p-6" noValidate data-testid="base-breakdown-form">
      <input type="hidden" name="base_model_id" value={modelId} />
      <input type="hidden" name="spec_code" value={specCode} />
      <Status state={state} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">品名</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">数量</th>
              <th className="w-24 px-2 py-2 font-semibold whitespace-nowrap">単位</th>
              <th className="w-28 px-2 py-2 text-right font-semibold whitespace-nowrap">単価（売価）</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">金額</th>
              <th className="w-40 px-3 py-2 font-semibold">備考</th>
              <th className="w-16 px-2 py-2"></th>
            </tr>
          </thead>
          {sections.map((sec, si) => (
            <tbody key={sec.key} className="divide-y divide-line/60" data-testid={`breakdown-section-${si}`}>
              {/* 工事区分の見出し行（エクセルの「１．金物関係費用」に相当。名前を直接編集できる） */}
              <tr className="bg-sand/40">
                <td colSpan={6} className="px-3 py-1.5">
                  <Input
                    value={sec.name}
                    onChange={(e) => updateSection(sec.key, e.target.value)}
                    aria-label={`${si + 1} 番目の工事区分名`}
                    className="max-w-md bg-white text-xs font-semibold"
                    required
                  />
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => removeSection(sec.key)}
                    className="rounded p-1 text-muted hover:bg-white hover:text-warn"
                    aria-label={`工事区分「${sec.name}」を削除`}
                    title="この区分を削除（中の行ごと消えます）"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              {sec.rows.map((r, ri) => {
                const i = offsets[si] + ri;
                return (
                  <tr key={r.key} className="bg-white" data-testid={`breakdown-row-${i}`}>
                    <td className="px-3 py-1.5">
                      <input type="hidden" name={`items.${i}.section`} value={sec.name} />
                      <Input name={`items.${i}.name`} value={r.name} onChange={(e) => updateRow(sec.key, r.key, { name: e.target.value })} aria-label={`${i + 1} 行目の品名`} required />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input name={`items.${i}.quantity`} type="number" min={0.1} step={0.1} value={r.quantity} onChange={(e) => updateRow(sec.key, r.key, { quantity: Number(e.target.value) })} aria-label={`${i + 1} 行目の数量`} className="text-right" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input name={`items.${i}.unit`} value={r.unit} onChange={(e) => updateRow(sec.key, r.key, { unit: e.target.value })} aria-label={`${i + 1} 行目の単位`} className="min-w-[4.5rem]" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input name={`items.${i}.unit_price`} type="number" min={0} value={r.unit_price} onChange={(e) => updateRow(sec.key, r.key, { unit_price: Number(e.target.value) })} aria-label={`${i + 1} 行目の単価`} className="text-right" />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatYen(amountOf(r))}</td>
                    <td className="px-3 py-1.5">
                      <Input name={`items.${i}.remark`} value={r.remark} onChange={(e) => updateRow(sec.key, r.key, { remark: e.target.value })} aria-label={`${i + 1} 行目の備考`} className="text-xs" />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button type="button" onClick={() => addRow(sec.key, r.key)} className="rounded p-1 text-muted hover:bg-sand hover:text-forest" aria-label={`${i + 1} 行目の下に行を追加`} title="下に行を追加">
                        <Plus className="size-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => removeRow(sec.key, r.key)} className="rounded p-1 text-muted hover:bg-sand hover:text-warn" aria-label={`${i + 1} 行目を削除`}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* 区分ごとの小計（エクセルの右端の小計に相当） */}
              <tr className="bg-ivory/70 text-xs">
                <td colSpan={4} className="px-3 py-1.5 text-right font-semibold text-ink-soft">
                  {sec.name}　計
                </td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums" data-testid={`breakdown-section-total-${si}`}>
                  {formatYen(sectionTotal(sec))}
                </td>
                <td colSpan={2} className="px-3 py-1.5">
                  <button type="button" onClick={() => addRow(sec.key)} className="text-xs text-brown underline underline-offset-2 hover:text-ink">
                    ＋ この区分に行を追加
                  </button>
                </td>
              </tr>
            </tbody>
          ))}
          {sections.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                  内訳がありません。「工事区分を追加」から登録してください。
                </td>
              </tr>
            </tbody>
          )}
          <tfoot>
            <tr className="border-t border-line text-sm">
              <td colSpan={4} className="px-3 pt-3 pb-1 text-right text-muted">明細合計</td>
              <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(linesTotal)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr className="text-sm text-ink-soft">
              <td colSpan={4} className="px-3 py-1 text-right text-muted">本体諸費用（{Math.round(expenseRate * 100)}%・自動加算）</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(expense)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr className="bg-ivory font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right">【本体価格計】</td>
              <td className="px-3 py-2 text-right tabular-nums" data-testid="breakdown-total">{formatYen(linesTotal + expense)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={addSection} data-testid="breakdown-add-section">
          <Plus className="size-4" aria-hidden="true" />
          工事区分を追加
        </Button>
        <p className="text-xs text-muted">
          保存すると、これから作られる見積の本体明細・本体一式の金額に反映されます。発行済みの見積書は変わりません。
        </p>
      </div>
      <SubmitButton pending={pending} label="この内訳で保存する" />
    </form>
  );
}
