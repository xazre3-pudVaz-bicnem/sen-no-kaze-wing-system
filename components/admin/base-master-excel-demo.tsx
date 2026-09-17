'use client';

import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type DemoRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  cost: number;
  sale: number;
  remark: string;
};

type DemoSection = {
  id: string;
  label: string;
  rows: DemoRow[];
};

const INITIAL_SECTIONS: DemoSection[] = [
  {
    id: 'hardware',
    label: '1．金物関係費用',
    rows: [
      { id: 'h1', name: '単管パイプ2.5m', quantity: 12, unit: '本', cost: 1349, sale: 2158, remark: '' },
      { id: 'h2', name: 'ジャッキベース', quantity: 12, unit: '本', cost: 2500, sale: 4000, remark: '' },
      { id: 'h3', name: '大型丁番', quantity: 12, unit: '枚', cost: 4150, sale: 6640, remark: '' },
    ],
  },
  {
    id: 'precut',
    label: '2．プレカット',
    rows: [
      { id: 'p1', name: '204材 L=6f', quantity: 46, unit: '本', cost: 952, sale: 1523, remark: '床天井根太' },
      { id: 'p2', name: '本体組立費', quantity: 5, unit: '人', cost: 25000, sale: 40000, remark: '' },
      { id: 'p3', name: 'その他プレカット明細', quantity: 1, unit: '式', cost: 551208, sale: 881942, remark: '操作確認用の集約行' },
    ],
  },
  {
    id: 'panels',
    label: '3．構造用面材等',
    rows: [
      { id: 'm1', name: '構造用面材', quantity: 1, unit: '式', cost: 510000, sale: 816000, remark: '' },
    ],
  },
  {
    id: 'insulation',
    label: '4．断熱材',
    rows: [
      { id: 'i1', name: '断熱材一式', quantity: 1, unit: '式', cost: 680000, sale: 1088000, remark: '' },
    ],
  },
];

const cloneSections = (sections: DemoSection[]) =>
  sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => ({ ...row })),
  }));

let seq = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;

export function BaseMasterExcelDemo() {
  const [sections, setSections] = useState<DemoSection[]>(() => cloneSections(INITIAL_SECTIONS));
  const [savedSections, setSavedSections] = useState<DemoSection[]>(() => cloneSections(INITIAL_SECTIONS));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dirty, setDirty] = useState(false);
  const [selectedCell, setSelectedCell] = useState('選択したセルの内容を表示');
  const [expenseRate, setExpenseRate] = useState(15);
  const [savedExpenseRate, setSavedExpenseRate] = useState(15);

  const totals = useMemo(() => {
    const cost = sections.reduce(
      (sum, section) => sum + section.rows.reduce((rowSum, row) => rowSum + Math.round(row.quantity * row.cost), 0),
      0
    );
    const sale = sections.reduce(
      (sum, section) => sum + section.rows.reduce((rowSum, row) => rowSum + Math.round(row.quantity * row.sale), 0),
      0
    );
    const saleExpense = Math.floor(sale * expenseRate / 100);
    const saleTotal = sale + saleExpense;
    const profit = saleTotal - cost;
    return {
      cost,
      sale,
      saleExpense,
      saleTotal,
      profit,
      margin: saleTotal > 0 ? profit / saleTotal * 100 : 0,
    };
  }, [sections, expenseRate]);

  const rowNumbers = useMemo(() => {
    const result = new Map<string, number>();
    let current = 0;
    for (const section of sections) {
      for (const row of section.rows) {
        current += 1;
        result.set(row.id, current);
      }
    }
    return result;
  }, [sections]);

  const markDirty = () => setDirty(true);

  const saveLocal = () => {
    setSavedSections(cloneSections(sections));
    setSavedExpenseRate(expenseRate);
    setDirty(false);
  };

  const resetToSaved = () => {
    if (dirty && !window.confirm('未保存の変更を破棄して、画面内の保存時点へ戻しますか？')) return;
    setSections(cloneSections(savedSections));
    setExpenseRate(savedExpenseRate);
    setCollapsed(new Set());
    setDirty(false);
  };

  const updateSection = (sectionId: string, label: string) => {
    markDirty();
    setSections((current) => current.map((section) => section.id === sectionId ? { ...section, label } : section));
  };

  const updateRow = (sectionId: string, rowId: string, patch: Partial<DemoRow>) => {
    markDirty();
    setSections((current) => current.map((section) =>
      section.id === sectionId
        ? { ...section, rows: section.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) }
        : section
    ));
  };

  const addRow = (sectionId: string, afterId?: string) => {
    markDirty();
    setSections((current) => current.map((section) => {
      if (section.id !== sectionId) return section;
      const rows = [...section.rows];
      const index = afterId ? rows.findIndex((row) => row.id === afterId) : rows.length - 1;
      rows.splice(index + 1, 0, {
        id: makeId('row'),
        name: '新しい明細',
        quantity: 1,
        unit: rows[index]?.unit || '式',
        cost: 0,
        sale: 0,
        remark: '',
      });
      return { ...section, rows };
    }));
  };

  const removeRow = (sectionId: string, rowId: string) => {
    markDirty();
    setSections((current) => current
      .map((section) => section.id === sectionId
        ? { ...section, rows: section.rows.filter((row) => row.id !== rowId) }
        : section)
      .filter((section) => section.rows.length > 0));
  };

  const addSection = () => {
    markDirty();
    setSections((current) => [
      ...current,
      {
        id: makeId('section'),
        label: `${current.length + 1}．新しい工事区分`,
        rows: [{ id: makeId('row'), name: '新しい明細', quantity: 1, unit: '式', cost: 0, sale: 0, remark: '' }],
      },
    ]);
  };

  const removeSection = (section: DemoSection) => {
    if (!window.confirm(`「${section.label}」と、その中の${section.rows.length}明細を削除しますか？`)) return;
    markDirty();
    setSections((current) => current.filter((item) => item.id !== section.id));
  };

  const toggleSection = (sectionId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const handleCellKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-base-demo-cell="1"]'));
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
      const row = Number(current.dataset.row ?? -1);
      const sameColumn = inputs.filter((input) => input.dataset.col === col);
      const next = event.shiftKey
        ? [...sameColumn].reverse().find((input) => Number(input.dataset.row) < row)
        : sameColumn.find((input) => Number(input.dataset.row) > row);
      next?.focus();
      next?.select();
    }
  };

  const cellProps = (column: string, row: number) => ({
    'data-base-demo-cell': '1',
    'data-col': column,
    'data-row': row,
    onKeyDown: handleCellKey,
  });

  const inputClass =
    'h-7 w-full border-0 bg-transparent px-1.5 text-[13px] leading-none outline-none focus:ring-2 focus:ring-emerald-700/30';

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">本体マスター ― Excel操作確認版</h2>
              <span className={dirty
                ? 'rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900'
                : 'rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800'}
              >
                {dirty ? '未保存の変更あり' : '保存時点と同じ'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              表示値は操作確認用です。入力・保存時点に戻す・折り畳みなどは画面内だけで動き、DBには保存しません。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={resetToSaved}>保存時点に戻す</Button>
            <Button type="button" size="sm" onClick={saveLocal}>画面内でDraft保存</Button>
          </div>
        </div>

        <div className="flex flex-wrap divide-x divide-slate-200 border-b border-slate-200 text-sm">
          <label className="flex min-w-[20rem] flex-1 items-center gap-2 px-4 py-2">
            <span className="whitespace-nowrap text-xs text-slate-500">本体名</span>
            <input
              defaultValue="Wing ホテル仕様"
              className="h-8 min-w-48 flex-1 rounded border border-slate-300 bg-white px-2 text-sm"
              onChange={markDirty}
            />
          </label>
          <label className="flex items-center gap-2 px-4 py-2">
            <span className="whitespace-nowrap text-xs text-slate-500">モデル</span>
            <select className="h-8 rounded border border-slate-300 bg-white px-2 text-sm" onChange={markDirty} defaultValue="Wing">
              <option>Wing</option>
              <option>BOX</option>
              <option>Flat</option>
            </select>
          </label>
          <label className="flex items-center gap-2 px-4 py-2">
            <span className="whitespace-nowrap text-xs text-slate-500">防火仕様</span>
            <select className="h-8 rounded border border-slate-300 bg-white px-2 text-sm" onChange={markDirty} defaultValue="非防火">
              <option>非防火</option>
              <option>防火</option>
            </select>
          </label>
          <div className="flex items-center gap-2 px-4 py-2">
            <span className="whitespace-nowrap text-xs text-slate-500">所有</span>
            <span className="rounded border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs">本部</span>
          </div>
          <label className="flex items-center gap-2 px-4 py-2">
            <span className="whitespace-nowrap text-xs text-slate-500">売価諸費用</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={expenseRate}
              onChange={(event) => {
                setExpenseRate(Math.max(0, Number(event.target.value) || 0));
                markDirty();
              }}
              className="h-8 w-24 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm"
            />
            <span>%</span>
          </label>
        </div>

        <div className="flex border-b border-slate-200 text-xs">
          <div className="w-16 border-r border-slate-200 bg-slate-100 px-2 py-1.5 font-semibold text-slate-500">内容</div>
          <div className="min-h-7 flex-1 px-3 py-1.5">{selectedCell}</div>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          <table className="min-w-[88rem] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 w-12 border-r border-slate-300 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">#</th>
                <th className="sticky top-0 z-10 w-10 border-r border-slate-300 bg-slate-100 px-1 py-1"></th>
                <th className="sticky top-0 z-10 min-w-[20rem] border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">品名</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">数量</th>
                <th className="sticky top-0 z-10 w-20 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">単位</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">原価</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">原価金額</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">売価</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">売価金額</th>
                <th className="sticky top-0 z-10 w-28 border-r border-slate-300 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600">粗利</th>
                <th className="sticky top-0 z-10 min-w-48 border-r border-slate-300 bg-slate-100 px-2 py-1 text-left text-xs font-semibold text-slate-600">備考</th>
                <th className="sticky top-0 z-10 w-20 bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const isCollapsed = collapsed.has(section.id);
                const sectionCost = section.rows.reduce((sum, row) => sum + Math.round(row.quantity * row.cost), 0);
                const sectionSale = section.rows.reduce((sum, row) => sum + Math.round(row.quantity * row.sale), 0);
                const sectionProfit = sectionSale - sectionCost;

                return [
                  <tr key={section.id + '-head'} className="border-b border-slate-300 bg-emerald-900 text-white">
                    <th className="bg-slate-100"></th>
                    <td className="px-1 text-center">
                      <button
                        type="button"
                        aria-label={isCollapsed ? section.label + 'を展開' : section.label + 'を折り畳む'}
                        className="size-6 rounded border border-white/60 bg-white text-slate-800"
                        onClick={() => toggleSection(section.id)}
                      >
                        {isCollapsed ? '+' : '−'}
                      </button>
                    </td>
                    <td colSpan={5} className="px-2 py-0.5">
                      <input
                        value={section.label}
                        onChange={(event) => updateSection(section.id, event.target.value)}
                        className="h-7 w-full max-w-lg border-0 bg-transparent px-1 text-[13px] font-semibold text-white outline-none"
                      />
                    </td>
                    <td colSpan={4} className="px-3 text-right text-xs">
                      原価 {formatYen(sectionCost)} ／ 売価 {formatYen(sectionSale)} ／ 粗利 {formatYen(sectionProfit)}
                    </td>
                    <td className="px-2 text-center">
                      <button type="button" title="工事区分を削除" onClick={() => removeSection(section)}>
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>,
                  ...(!isCollapsed ? section.rows.map((row) => {
                    const rowIndex = rowNumbers.get(row.id) ?? 0;
                    const costAmount = Math.round(row.quantity * row.cost);
                    const saleAmount = Math.round(row.quantity * row.sale);
                    const profit = saleAmount - costAmount;
                    return (
                      <tr key={row.id} className="border-b border-slate-200 bg-white">
                        <th className="bg-slate-100 px-2 text-center text-xs font-normal text-slate-500">{rowIndex}</th>
                        <td className="border-r border-slate-200"></td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('name', rowIndex)}
                            value={row.name}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { name: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('quantity', rowIndex)}
                            type="number"
                            min={0}
                            step={0.01}
                            value={row.quantity}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { quantity: Math.max(0, Number(event.target.value) || 0) })}
                            className={inputClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('unit', rowIndex)}
                            value={row.unit}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { unit: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('cost', rowIndex)}
                            type="number"
                            min={0}
                            step={1}
                            value={row.cost}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { cost: Math.max(0, Number(event.target.value) || 0) })}
                            className={inputClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{formatYen(costAmount)}</td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('sale', rowIndex)}
                            type="number"
                            min={0}
                            step={1}
                            value={row.sale}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { sale: Math.max(0, Number(event.target.value) || 0) })}
                            className={inputClass + ' text-right'}
                          />
                        </td>
                        <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{formatYen(saleAmount)}</td>
                        <td className="border-r border-slate-200 bg-slate-50 px-3 text-right tabular-nums">{formatYen(profit)}</td>
                        <td className="border-r border-slate-200 bg-amber-50 px-0.5">
                          <input
                            {...cellProps('remark', rowIndex)}
                            value={row.remark}
                            onFocus={(event) => setSelectedCell(event.currentTarget.value)}
                            onChange={(event) => updateRow(section.id, row.id, { remark: event.target.value })}
                            className={inputClass}
                          />
                        </td>
                        <td className="whitespace-nowrap px-1 text-center">
                          <button type="button" aria-label="下に明細を追加" title="下に明細を追加" className="rounded p-1 text-slate-500 hover:text-emerald-800" onClick={() => addRow(section.id, row.id)}>
                            <Plus className="size-4" />
                          </button>
                          <button type="button" aria-label="行を削除" title="明細を削除" className="rounded p-1 text-slate-500 hover:text-red-700" onClick={() => removeRow(section.id, row.id)}>
                            <Trash2 className="size-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  }) : []),
                  <tr key={section.id + '-total'} className="border-y-2 border-emerald-800 bg-emerald-50 font-semibold">
                    <th className="bg-slate-100"></th>
                    <td></td>
                    <td className="px-3 py-1">{section.label} 計</td>
                    <td></td><td></td>
                    <td className="px-3 text-right tabular-nums">{formatYen(sectionCost)}</td>
                    <td></td>
                    <td className="px-3 text-right tabular-nums">{formatYen(sectionSale)}</td>
                    <td></td>
                    <td className="px-3 text-right tabular-nums">{formatYen(sectionProfit)}</td>
                    <td></td>
                    <td className="px-2 text-right">
                      <button type="button" className="text-[11px] text-emerald-800 underline" onClick={() => addRow(section.id)}>＋明細</button>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <Button type="button" variant="secondary" size="sm" onClick={addSection}>
            <Plus className="size-4" />
            工事区分を追加
          </Button>
          <p className="text-[11px] text-slate-500">
            黄色＝入力 ／ グレー＝自動計算 ／ Tab＝右 ／ Shift+Tab＝左 ／ Enter＝下 ／ Shift+Enter＝上
          </p>
        </div>
      </section>

      <section className="ml-auto max-w-xl rounded-xl border border-slate-300 bg-white p-5 text-sm shadow-sm">
        <div className="flex justify-between gap-4 py-1"><span>原価明細合計</span><strong>{formatYen(totals.cost)}</strong></div>
        <div className="flex justify-between gap-4 py-1"><span>売価明細合計</span><strong>{formatYen(totals.sale)}</strong></div>
        <div className="flex justify-between gap-4 py-1"><span>売価諸費用 {expenseRate.toFixed(1)}%</span><strong>{formatYen(totals.saleExpense)}</strong></div>
        <div className="mt-2 flex justify-between gap-4 border-t-2 border-slate-700 pt-3 text-base">
          <span>本体売価計</span><strong>{formatYen(totals.saleTotal)}</strong>
        </div>
        <div className="mt-2 flex justify-between gap-4 rounded bg-emerald-50 px-3 py-2">
          <span>標準粗利</span><strong>{formatYen(totals.profit)}</strong>
        </div>
        <div className="flex justify-between gap-4 py-1"><span>粗利率</span><strong>{totals.margin.toFixed(1)}%</strong></div>
      </section>

      <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Draftの操作</h2>
            <p className="mt-1 text-xs text-slate-500">UI確認版のため、公開・破棄は実行しません。</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled>このDraftを公開</Button>
            <Button type="button" variant="ghost" disabled>Draftを破棄</Button>
          </div>
        </div>
      </section>
    </div>
  );
}
