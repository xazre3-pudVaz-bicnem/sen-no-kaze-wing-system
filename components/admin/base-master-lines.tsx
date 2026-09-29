'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
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
  const [selectedCell, setSelectedCell] = useState('セルを選択すると内容を表示します');
  const lineIdentity = lines.map((line) => `${line.id}:${line.line_key}`).join('|');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSections(makeSections(lines));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(new Set());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedCell('セルを選択すると内容を表示します');
    // 保存後にDB採番されたline_keyをクライアント状態へ取り込む。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIdentity, resetVersion]);

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

  const rowNumbers = useMemo(() => {
    const result = new Map<string, number>();
    let current = 0;
    for (const section of sections) {
      for (const row of section.rows) {
        current += 1;
        result.set(row.key, current);
      }
    }
    return result;
  }, [sections]);

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
        name: '新しい明細',
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
        rows: [{ key: makeKey(), lineKey: '', name: '新しい明細', quantity: 1, unit: '式', unitPrice: 0, remark: '' }],
      },
    ]);
  };

  const removeSection = (section: Section) => {
    if (!window.confirm(`「${section.name}」と、その中の${section.rows.length}明細を削除しますか？`)) return;
    onDirty();
    setSections((current) => current.filter((item) => item.key !== section.key));
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  const handleCellKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-base-master-cell="1"]'));
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
      const column = current.dataset.col;
      const row = Number(current.dataset.row ?? -1);
      const sameColumn = inputs.filter((input) => input.dataset.col === column);
      const next = event.shiftKey
        ? [...sameColumn].reverse().find((input) => Number(input.dataset.row) < row)
        : sameColumn.find((input) => Number(input.dataset.row) > row);
      next?.focus();
      next?.select();
    }
  };

  const cellProps = (column: string, row: number) => ({
    'data-base-master-cell': '1',
    'data-col': column,
    'data-row': row,
    onKeyDown: handleCellKey,
  });

  const inputClass =
    'h-7 w-full border-0 bg-transparent px-1.5 text-[13px] leading-none outline-none focus:ring-2 focus:ring-emerald-700/30';

  return (
    <div className="space-y-3">
      <input type="hidden" name="lines_json" value={JSON.stringify(payload)} />

      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white">
        <div className="flex border-b border-slate-200 text-xs">
          <div className="w-16 shrink-0 border-r border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-500">内容</div>
          <div className="min-h-7 flex-1 truncate px-3 py-1.5">{selectedCell}</div>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[70rem] w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-12 border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">#</th>
                <th className="sticky top-0 z-10 w-10 border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
                <th className="sticky top-0 z-10 min-w-[20rem] border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">単位</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">単価</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">金額</th>
                <th className="sticky top-0 z-10 min-w-48 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-10 w-16 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const isCollapsed = collapsed.has(section.key);
                const sectionTotal = section.rows.reduce(
                  (sum, row) => sum + Math.round(row.unitPrice * row.quantity),
                  0
                );

                return [
                  <tr key={section.key + '-head'} className="border-b border-slate-300 bg-emerald-900 text-white">
                    <th className="bg-slate-100"></th>
                    <td className="px-1 text-center">
                      <button
                        type="button"
                        aria-label={isCollapsed ? section.name + 'を展開' : section.name + 'を折り畳む'}
                        className="size-6 rounded border border-white/60 bg-white text-slate-800"
                        onClick={() => toggleSection(section.key)}
                      >
                        {isCollapsed ? '+' : '−'}
                      </button>
                    </td>
                    <td colSpan={4} className="px-2 py-0.5">
                      <input
                        value={section.name}
                        onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                        onChange={(event) => changeSection(section.key, event.target.value)}
                        className="h-7 w-full max-w-xl border-0 bg-transparent px-1 text-[13px] font-semibold text-white outline-none"
                        aria-label="工事区分名"
                      />
                    </td>
                    <td colSpan={2} className="px-3 text-right text-xs">
                      小計 {formatYen(sectionTotal)}
                    </td>
                    <td className="relative px-1 text-center">
                      <details className="group relative inline-block">
                        <summary
                          className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden"
                          aria-label={section.name + 'の操作'}
                          title="工事区分の操作"
                        >
                          ⋯
                        </summary>
                        <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal text-slate-700 shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                            onClick={(event) => {
                              event.currentTarget.closest('details')?.removeAttribute('open');
                              addRow(section.key);
                            }}
                          >
                            明細を追加
                          </button>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50"
                            onClick={(event) => {
                              event.currentTarget.closest('details')?.removeAttribute('open');
                              removeSection(section);
                            }}
                          >
                            工事区分を削除
                          </button>
                        </div>
                      </details>
                    </td>
                  </tr>,
                  ...(!isCollapsed ? section.rows.map((row) => {
                    const rowIndex = rowNumbers.get(row.key) ?? 0;
                    const amount = Math.round(row.unitPrice * row.quantity);
                    return (
                      <tr key={row.key} className="border-b border-slate-200 bg-white">
                        <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                        <td className="border-r border-slate-200"></td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('name', rowIndex)}
                            value={row.name}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => changeRow(section.key, row.key, { name: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('quantity', rowIndex)}
                            type="number"
                            min={0.01}
                            step={0.01}
                            value={row.quantity}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => changeRow(section.key, row.key, { quantity: Number(event.target.value) })}
                            className={inputClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('unit', rowIndex)}
                            value={row.unit}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => changeRow(section.key, row.key, { unit: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('unitPrice', rowIndex)}
                            type="number"
                            min={0}
                            step={1}
                            value={row.unitPrice}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => changeRow(section.key, row.key, { unitPrice: Number(event.target.value) })}
                            className={inputClass + ' text-right'}
                          />
                        </td>
                        <td className="whitespace-nowrap border-r border-slate-200 bg-slate-50 px-2 text-right text-xs tabular-nums">
                          {formatYen(amount)}
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('remark', rowIndex)}
                            value={row.remark}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => changeRow(section.key, row.key, { remark: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="relative px-0.5 text-center">
                          <details className="group relative inline-block">
                            <summary
                              className="flex size-6 cursor-pointer list-none items-center justify-center rounded text-sm font-bold text-slate-600 hover:bg-slate-100 [&::-webkit-details-marker]:hidden"
                              aria-label={row.name + 'の操作'}
                              title="行の操作"
                            >
                              ⋯
                            </summary>
                            <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left text-[11px] font-normal shadow-lg">
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left hover:bg-slate-50"
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open');
                                  addRow(section.key, row.key);
                                }}
                              >
                                下に行を追加
                              </button>
                              <button
                                type="button"
                                className="block w-full px-3 py-2 text-left text-red-700 hover:bg-red-50"
                                onClick={(event) => {
                                  event.currentTarget.closest('details')?.removeAttribute('open');
                                  removeRow(section.key, row.key);
                                }}
                              >
                                行を削除
                              </button>
                            </div>
                          </details>
                        </td>
                      </tr>
                    );
                  }) : []),
                ];
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-emerald-800 bg-emerald-50 font-semibold">
                <td colSpan={6} className="px-3 py-1.5 text-right">明細合計</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs tabular-nums">{formatYen(lineTotal)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr className="bg-white">
                <td colSpan={6} className="px-3 py-1.5 text-right text-slate-500">諸費用</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs tabular-nums">{formatYen(expense)}</td>
                <td colSpan={2}></td>
              </tr>
              <tr className="border-t border-slate-300 bg-slate-100 font-semibold">
                <td colSpan={6} className="px-3 py-2 text-right">本体価格計</td>
                <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{formatYen(lineTotal + expense)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
          <p className="text-[11px] text-slate-500">
            黄色＝入力 ／ グレー＝自動計算 ／ Tab＝右 ／ Shift+Tab＝左 ／ Enter＝下 ／ Shift+Enter＝上
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={addSection}>
            <Plus className="size-4" />
            工事区分を追加
          </Button>
        </div>
      </div>

      {sections.length === 0 && <Alert tone="warn">公開するには本体明細を1行以上登録してください。</Alert>}
    </div>
  );
}


export function BaseMasterReadOnlyLines({
  lines,
  lineSubtotal,
  expenseAmount,
  total,
}: {
  lines: BaseMasterRevisionLine[];
  lineSubtotal: number;
  expenseAmount: number;
  total: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const sections = useMemo(() => makeSections(lines), [lines]);
  const rowNumbers = useMemo(() => {
    const result = new Map<string, number>();
    let current = 0;
    for (const section of sections) {
      for (const row of section.rows) {
        current += 1;
        result.set(row.key, current);
      }
    }
    return result;
  }, [sections]);

  const toggleSection = (sectionKey: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  return (
    <div className="max-h-[68vh] overflow-auto">
      <table className="min-w-[66rem] w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 w-12 border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">#</th>
            <th className="sticky top-0 z-10 w-10 border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
            <th className="sticky top-0 z-10 min-w-[20rem] border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">品名</th>
            <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">数量</th>
            <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">単位</th>
            <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">単価</th>
            <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">金額</th>
            <th className="sticky top-0 z-10 min-w-48 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">備考</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => {
            const isCollapsed = collapsed.has(section.key);
            const sectionTotal = section.rows.reduce(
              (sum, row) => sum + Math.round(row.unitPrice * row.quantity),
              0
            );

            return [
              <tr key={section.key + '-head'} className="border-b border-slate-300 bg-emerald-900 text-white">
                <th className="bg-slate-100"></th>
                <td className="px-1 text-center">
                  <button
                    type="button"
                    aria-label={isCollapsed ? section.name + 'を展開' : section.name + 'を折り畳む'}
                    className="size-6 rounded border border-white/60 bg-white text-slate-800"
                    onClick={() => toggleSection(section.key)}
                  >
                    {isCollapsed ? '+' : '−'}
                  </button>
                </td>
                <td colSpan={4} className="px-3 py-1 text-[13px] font-semibold">{section.name}</td>
                <td colSpan={2} className="px-3 text-right text-xs">小計 {formatYen(sectionTotal)}</td>
              </tr>,
              ...(!isCollapsed ? section.rows.map((row) => {
                const rowIndex = rowNumbers.get(row.key) ?? 0;
                const amount = Math.round(row.unitPrice * row.quantity);
                return (
                  <tr key={row.key} className="border-b border-slate-200 bg-white">
                    <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                    <td className="border-r border-slate-200"></td>
                    <td className="h-7 border-r border-slate-200 px-2 text-[13px]">{row.name}</td>
                    <td className="h-7 border-r border-slate-200 px-2 text-right text-[13px] tabular-nums">{row.quantity}</td>
                    <td className="h-7 border-r border-slate-200 px-2 text-[13px]">{row.unit}</td>
                    <td className="h-7 border-r border-slate-200 px-2 text-right text-[13px] tabular-nums">{formatYen(row.unitPrice)}</td>
                    <td className="h-7 border-r border-slate-200 bg-slate-50 px-2 text-right text-[13px] tabular-nums">{formatYen(amount)}</td>
                    <td className="h-7 px-2 text-[13px] text-slate-600">{row.remark}</td>
                  </tr>
                );
              }) : []),
            ];
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-emerald-800 bg-emerald-50 font-semibold">
            <td colSpan={6} className="px-3 py-1.5 text-right">明細合計</td>
            <td className="px-2 py-1.5 text-right text-xs tabular-nums">{formatYen(lineSubtotal)}</td>
            <td></td>
          </tr>
          <tr>
            <td colSpan={6} className="px-3 py-1.5 text-right text-slate-500">諸費用</td>
            <td className="px-2 py-1.5 text-right text-xs tabular-nums">{formatYen(expenseAmount)}</td>
            <td></td>
          </tr>
          <tr className="border-t border-slate-300 bg-slate-100 font-semibold">
            <td colSpan={6} className="px-3 py-2 text-right">本体価格計</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatYen(total)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
