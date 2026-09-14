'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Input } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

export interface BaseMasterRevisionLine {
  id: string;
  line_key: string;
  section: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  amount: number;
  remark: string | null;
  sort_order: number;
}

interface Row {
  key: string;
  lineKey: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  remark: string;
}

interface Section {
  key: string;
  name: string;
  rows: Row[];
}

let seq = 0;
const makeKey = () => `bm-${Date.now()}-${++seq}`;

function makeSections(lines: BaseMasterRevisionLine[]): Section[] {
  const out: Section[] = [];
  for (const line of [...lines].sort((a, b) => a.sort_order - b.sort_order)) {
    const row: Row = {
      key: makeKey(),
      lineKey: line.line_key,
      name: line.name,
      quantity: line.quantity,
      unit: line.unit ?? '',
      unitPrice: line.unit_price,
      remark: line.remark ?? '',
    };
    const last = out[out.length - 1];
    if (last?.name === line.section) last.rows.push(row);
    else out.push({ key: makeKey(), name: line.section, rows: [row] });
  }
  return out;
}

export function BaseMasterLinesEditor({
  lines,
  expenseMethod,
  expenseRatePercent,
  fixedExpense,
  onDirty,
}: {
  lines: BaseMasterRevisionLine[];
  expenseMethod: 'rate' | 'fixed' | 'none';
  expenseRatePercent: number;
  fixedExpense: number;
  onDirty: () => void;
}) {
  const [sections, setSections] = useState<Section[]>(() => makeSections(lines));

  const payload = useMemo(
    () =>
      sections.flatMap((section) =>
        section.rows.map((row) => ({
          line_key: row.lineKey || null,
          section: section.name,
          name: row.name,
          quantity: row.quantity,
          unit: row.unit || null,
          unit_price: row.unitPrice,
          remark: row.remark || null,
        }))
      ),
    [sections]
  );

  const lineTotal = useMemo(
    () => sections.reduce(
      (sum, section) =>
        sum + section.rows.reduce((rowSum, row) => rowSum + Math.round(row.unitPrice * row.quantity), 0),
      0
    ),
    [sections]
  );
  const expense =
    expenseMethod === 'rate'
      ? Math.floor(lineTotal * expenseRatePercent / 100)
      : expenseMethod === 'fixed'
        ? fixedExpense
        : 0;

  const changeSection = (sectionKey: string, name: string) => {
    onDirty();
    setSections((current) => current.map((section) => section.key === sectionKey ? { ...section, name } : section));
  };

  const changeRow = (sectionKey: string, rowKey: string, patch: Partial<Row>) => {
    onDirty();
    setSections((current) => current.map((section) =>
      section.key === sectionKey
        ? { ...section, rows: section.rows.map((row) => row.key === rowKey ? { ...row, ...patch } : row) }
        : section
    ));
  };

  const addRow = (sectionKey: string, afterKey?: string) => {
    onDirty();
    setSections((current) => current.map((section) => {
      if (section.key !== sectionKey) return section;
      const rows = [...section.rows];
      const index = afterKey ? rows.findIndex((row) => row.key === afterKey) : rows.length - 1;
      rows.splice(index + 1, 0, {
        key: makeKey(),
        lineKey: '',
        name: '',
        quantity: 1,
        unit: rows[index]?.unit || '式',
        unitPrice: 0,
        remark: '',
      });
      return { ...section, rows };
    }));
  };

  const removeRow = (sectionKey: string, rowKey: string) => {
    onDirty();
    setSections((current) =>
      current
        .map((section) => section.key === sectionKey
          ? { ...section, rows: section.rows.filter((row) => row.key !== rowKey) }
          : section)
        .filter((section) => section.rows.length > 0)
    );
  };

  const addSection = () => {
    onDirty();
    setSections((current) => [
      ...current,
      {
        key: makeKey(),
        name: `${current.length + 1}．新しい工事区分`,
        rows: [{ key: makeKey(), lineKey: '', name: '', quantity: 1, unit: '式', unitPrice: 0, remark: '' }],
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <input type="hidden" name="lines_json" value={JSON.stringify(payload)} />

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[58rem] text-sm">
          <thead className="bg-sand/60 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2">品名</th>
              <th className="w-20 px-2 py-2 text-right">数量</th>
              <th className="w-24 px-2 py-2">単位</th>
              <th className="w-28 px-2 py-2 text-right">単価</th>
              <th className="w-28 px-3 py-2 text-right">金額</th>
              <th className="w-40 px-3 py-2">備考</th>
              <th className="w-16"></th>
            </tr>
          </thead>

          {sections.map((section) => (
            <tbody key={section.key} className="divide-y divide-line/60">
              <tr className="bg-sand/40">
                <td colSpan={6} className="px-3 py-1.5">
                  <Input
                    value={section.name}
                    onChange={(event) => changeSection(section.key, event.target.value)}
                    className="max-w-md bg-white text-xs font-semibold"
                    aria-label="工事区分名"
                  />
                </td>
                <td className="px-2">
                  <button
                    type="button"
                    aria-label="工事区分を削除"
                    className="rounded p-1 text-muted hover:text-danger"
                    onClick={() => {
                      onDirty();
                      setSections((current) => current.filter((item) => item.key !== section.key));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>

              {section.rows.map((row) => (
                <tr key={row.key} className="bg-white">
                  <td className="px-3 py-1.5">
                    <Input value={row.name} onChange={(event) => changeRow(section.key, row.key, { name: event.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="text-right" type="number" min={0.01} step={0.01} value={row.quantity}
                      onChange={(event) => changeRow(section.key, row.key, { quantity: Number(event.target.value) })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={row.unit} onChange={(event) => changeRow(section.key, row.key, { unit: event.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input className="text-right" type="number" min={0} step={1} value={row.unitPrice}
                      onChange={(event) => changeRow(section.key, row.key, { unitPrice: Number(event.target.value) })} />
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatYen(Math.round(row.unitPrice * row.quantity))}</td>
                  <td className="px-3 py-1.5">
                    <Input className="text-xs" value={row.remark}
                      onChange={(event) => changeRow(section.key, row.key, { remark: event.target.value })} />
                  </td>
                  <td className="px-2 whitespace-nowrap">
                    <button type="button" aria-label="下に行を追加" className="rounded p-1 text-muted hover:text-forest" onClick={() => addRow(section.key, row.key)}>
                      <Plus className="size-4" />
                    </button>
                    <button type="button" aria-label="行を削除" className="rounded p-1 text-muted hover:text-danger" onClick={() => removeRow(section.key, row.key)}>
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}

          <tfoot>
            <tr className="border-t border-line">
              <td colSpan={4} className="px-3 pt-3 pb-1 text-right text-muted">明細合計</td>
              <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(lineTotal)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr>
              <td colSpan={4} className="px-3 py-1 text-right text-muted">諸費用</td>
              <td className="px-3 py-1 text-right tabular-nums">{formatYen(expense)}</td>
              <td colSpan={2}></td>
            </tr>
            <tr className="bg-ivory font-semibold">
              <td colSpan={4} className="px-3 py-2 text-right">本体価格計</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatYen(lineTotal + expense)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {sections.length === 0 && <Alert tone="warn">公開するには本体明細を1行以上登録してください。</Alert>}

      <Button type="button" variant="secondary" size="sm" onClick={addSection}>
        <Plus className="size-4" />
        工事区分を追加
      </Button>
    </div>
  );
}
