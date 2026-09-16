'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Button } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

export interface BaseMasterRevisionLine {
  id: string;
  revision_id: string;
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
const makeKey = () => 'bm-' + Date.now() + '-' + ++seq;

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
  resetVersion = 0,
}: {
  lines: BaseMasterRevisionLine[];
  expenseMethod: 'rate' | 'fixed' | 'none';
  expenseRatePercent: number;
  fixedExpense: number;
  onDirty: () => void;
  resetVersion?: number;
}) {
  const [sections, setSections] = useState<Section[]>(() => makeSections(lines));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedCell, setSelectedCell] = useState('選択したセルの内容を表示');
  const lineIdentity = lines.map((line) => line.id + ':' + line.line_key).join('|');

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setSections(makeSections(lines));
    setCollapsed(new Set());
    setSelectedCell('選択したセルの内容を表示');
    // 保存後にDB採番されたline_keyをクライアント状態へ取り込む。
  }, [lineIdentity, resetVersion, lines]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const rowNumbers = useMemo(() => {
    const result = new Map<string, number>();
    let index = 0;
    for (const section of sections) {
      for (const row of section.rows) {
        index += 1;
        result.set(row.key, index);
      }
    }
    return result;
  }, [sections]);

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

  const cellKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('[data-base-master-cell="1"]')
    );
    const current = event.currentTarget;

    if (event.key === 'Tab') {
      event.preventDefault();
      const index = inputs.indexOf(current);
      const next = event.shiftKey ? inputs[index - 1] : inputs[index + 1];
      next?.focus();
      next?.select();
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const col = current.dataset.col;
      const rowIndex = Number(current.dataset.row ?? -1);
      const candidates = inputs.filter((input) => input.dataset.col === col);
      const next = event.shiftKey
        ? [...candidates].reverse().find((input) => Number(input.dataset.row) < rowIndex)
        : candidates.find((input) => Number(input.dataset.row) > rowIndex);
      next?.focus();
      next?.select();
    }
  };

  const cellProps = (col: string, row: number) => ({
    'data-base-master-cell': '1',
    'data-col': col,
    'data-row': row,
    onKeyDown: cellKey,
  });

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

  const removeSection = (section: Section) => {
    const label = section.name || 'この工事区分';
    if (!window.confirm('「' + label + '」と、その中の' + section.rows.length + '明細を削除します。よろしいですか？')) {
      return;
    }
    onDirty();
    setSections((current) => current.filter((item) => item.key !== section.key));
  };

  const addSection = () => {
    onDirty();
    setSections((current) => [
      ...current,
      {
        key: makeKey(),
        name: (current.length + 1) + '．新しい工事区分',
        rows: [{ key: makeKey(), lineKey: '', name: '', quantity: 1, unit: '式', unitPrice: 0, remark: '' }],
      },
    ]);
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const editableCellClass =
    'h-7 w-full border-0 bg-transparent px-1.5 text-[13px] leading-none outline-none focus:ring-2 focus:ring-emerald-700/30';

  return (
    <div className="space-y-3">
      <input type="hidden" name="lines_json" value={JSON.stringify(payload)} />

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex border-b border-slate-200 text-xs">
          <div className="w-16 border-r border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-500">内容</div>
          <div className="min-h-7 flex-1 px-3 py-1.5">{selectedCell}</div>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[66rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-12 border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">#</th>
                <th className="sticky top-0 z-10 w-10 border-r border-slate-300 bg-slate-100 px-1 py-1 text-center text-xs font-semibold text-slate-600"></th>
                <th className="sticky top-0 z-10 min-w-[20rem] border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-10 w-24 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">単位</th>
                <th className="sticky top-0 z-10 w-32 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">単価</th>
                <th className="sticky top-0 z-10 w-32 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">金額</th>
                <th className="sticky top-0 z-10 min-w-48 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-10 w-20 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">操作</th>
              </tr>
            </thead>

            <tbody>
              {sections.map((section) => {
                const isCollapsed = collapsed.has(section.key);
                const sectionTotal = section.rows.reduce(
                  (sum, row) => sum + Math.round(row.unitPrice * row.quantity),
                  0
                );

                if (isCollapsed) {
                  return (
                    <tr key={section.key} className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold">
                      <th className="bg-slate-100"></th>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          aria-label={section.name + 'を展開'}
                          className="size-6 rounded border border-slate-400 bg-white"
                          onClick={() => toggleSection(section.key)}
                        >
                          +
                        </button>
                      </td>
                      <td className="px-3 py-1">{section.name} 計</td>
                      <td className="text-right">1</td>
                      <td className="text-center">式</td>
                      <td></td>
                      <td className="px-3 text-right tabular-nums">{formatYen(sectionTotal)}</td>
                      <td></td>
                      <td className="px-2 text-right">
                        <button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => addRow(section.key)}>
                          ＋明細
                        </button>
                      </td>
                    </tr>
                  );
                }

                return [
                  <tr key={section.key + '-head'} className="border-b border-slate-300 bg-emerald-900 text-white">
                    <th className="bg-slate-100"></th>
                    <td></td>
                    <td colSpan={6} className="px-2 py-0.5">
                      <input
                        value={section.name}
                        aria-label="工事区分名"
                        onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                        onChange={(event) => {
                          setSelectedCell(event.target.value);
                          changeSection(section.key, event.target.value);
                        }}
                        className="h-7 w-full max-w-lg border-0 bg-transparent px-1 text-[13px] font-semibold text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-white/30"
                      />
                    </td>
                    <td className="px-2 text-center">
                      <button
                        type="button"
                        title="工事区分を削除"
                        aria-label={section.name + 'を削除'}
                        className="rounded p-1 text-white/80 hover:text-white"
                        onClick={() => removeSection(section)}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>,
                  ...section.rows.map((row) => {
                    const rowIndex = rowNumbers.get(row.key) ?? 0;
                    const amount = Math.round(row.unitPrice * row.quantity);
                    return (
                      <tr key={row.key} className="border-b border-slate-200 bg-white">
                        <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                        <td className="border-r border-slate-200 bg-white"></td>
                        <td className="border-r border-slate-200 bg-white px-0.5">
                          <input
                            {...cellProps('N', rowIndex)}
                            value={row.name}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => {
                              setSelectedCell(event.target.value);
                              changeRow(section.key, row.key, { name: event.target.value });
                            }}
                            className={editableCellClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-white px-0.5">
                          <input
                            {...cellProps('Q', rowIndex)}
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={row.quantity}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setSelectedCell(event.target.value);
                              changeRow(section.key, row.key, { quantity: Number.isFinite(value) ? value : 0 });
                            }}
                            className={editableCellClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-white px-0.5">
                          <input
                            {...cellProps('U', rowIndex)}
                            value={row.unit}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => {
                              setSelectedCell(event.target.value);
                              changeRow(section.key, row.key, { unit: event.target.value });
                            }}
                            className={editableCellClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('P', rowIndex)}
                            type="number"
                            min={0}
                            step={1}
                            value={row.unitPrice}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setSelectedCell(event.target.value);
                              changeRow(section.key, row.key, { unitPrice: Number.isFinite(value) ? value : 0 });
                            }}
                            className={editableCellClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{formatYen(amount)}</td>
                        <td className="border-r border-slate-200 bg-white px-0.5">
                          <input
                            {...cellProps('R', rowIndex)}
                            value={row.remark}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => {
                              setSelectedCell(event.target.value);
                              changeRow(section.key, row.key, { remark: event.target.value });
                            }}
                            className={editableCellClass}
                          />
                        </td>
                        <td className="whitespace-nowrap px-1 text-center">
                          <button
                            type="button"
                            aria-label="下に行を追加"
                            title="下に明細を追加"
                            className="rounded p-1 text-slate-500 hover:text-emerald-800"
                            onClick={() => addRow(section.key, row.key)}
                          >
                            <Plus className="size-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="行を削除"
                            title="明細を削除"
                            className="rounded p-1 text-slate-500 hover:text-red-700"
                            onClick={() => removeRow(section.key, row.key)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                  <tr key={section.key + '-total'} className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold">
                    <th className="bg-slate-100"></th>
                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        aria-label={section.name + 'を折り畳む'}
                        className="size-6 rounded border border-slate-400 bg-white"
                        onClick={() => toggleSection(section.key)}
                      >
                        −
                      </button>
                    </td>
                    <td className="px-3 py-1">{section.name} 計</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td className="px-3 text-right tabular-nums">{formatYen(sectionTotal)}</td>
                    <td></td>
                    <td className="px-2 text-right">
                      <button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => addRow(section.key)}>
                        ＋明細
                      </button>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>

            <tfoot className="bg-slate-50 text-sm">
              <tr className="border-t-2 border-slate-600">
                <td colSpan={6} className="px-3 py-2 text-right text-slate-600">明細合計</td>
                <td className="px-3 text-right font-semibold tabular-nums">{formatYen(lineTotal)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr>
                <td colSpan={6} className="px-3 py-2 text-right text-slate-600">
                  諸費用{expenseMethod === 'rate' ? ' ' + expenseRatePercent.toFixed(2) + '%' : expenseMethod === 'fixed' ? '（固定）' : '（なし）'}
                </td>
                <td className="px-3 text-right font-semibold tabular-nums">{formatYen(expense)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr className="border-t-2 border-slate-700 bg-emerald-50">
                <td colSpan={6} className="px-3 py-2 text-right font-semibold">本体価格計</td>
                <td className="px-3 text-right text-base font-bold tabular-nums">{formatYen(lineTotal + expense)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {sections.length === 0 && <Alert tone="warn">公開するには本体明細を1行以上登録してください。</Alert>}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={addSection}>
          <Plus className="size-4" />
          工事区分を追加
        </Button>
        <p className="text-[11px] text-slate-500">黄色＝単価入力 ／ Tab＝右 ／ Shift+Tab＝左 ／ Enter＝下 ／ Shift+Enter＝上</p>
      </div>
    </div>
  );
}
