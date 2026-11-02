'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { createQuoteRevisionV25Action, fetchQuoteV25UnitsAction, type QuoteV25ActionState } from '@/lib/actions/quote-v25';
import type { QuoteV25EditContext, QuoteV25RevisionLine } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { computeQuoteV25Totals, quoteV25RowAmount, type QuoteV25Row, type QuoteV25Section } from '@/lib/domain/quote-v25';
import { POR_FACE_REMARK_PREFIX, POR_REMARKS, porSelectionUnavailableReason, type QuoteLineState, type QuotePorSelectionState } from '@/lib/domain/quote-por';
import type { Quote, QuoteItem } from '@/lib/domain/types';
import { Alert, Badge, Button, Input, Select, Textarea } from '@/components/ui';
import { QuotePorReview, type QuotePorReviewPatch, type QuotePorReviewRow } from './quote-por-review';

/** 商品台帳の商品（固定した版の売価つき。原価は渡さない） */
export interface QuoteV25Product {
  id: string;
  name: string;
  categoryName: string;
  section: 'interior_exterior' | 'option' | 'sitework';
  manufacturer: string;
  modelNo: string;
  groups: { id: string; name: string; required: boolean; choices: { id: string; name: string }[] }[];
  defaultChoiceIds: string[];
  /** 標準の選択肢での売価単価（価格未確定は null） */
  defaultUnit: number | null;
}

type CatalogSection = QuoteV25Product['section'];

type Row =
  | {
      key: string;
      source: 'parent';
      itemId: string;
      section: QuoteV25Section;
      kind: QuoteItem['kind'];
      name: string;
      description: string;
      unit: string;
      parentUnitPrice: number;
      parentQuantity: number;
      parentAmount: number;
      quantity: string;
      /** 前の版で別途見積（価格未確定）の行。担当者が売価を入れられる */
      por: boolean;
      price: string;
      state: QuoteLineState | null;
      stateReason: string;
      locked: boolean;
      isDelta: boolean;
    }
  | {
      key: string;
      source: 'catalog';
      section: CatalogSection;
      productId: string;
      choiceIds: string[];
      quantity: string;
      /** サーバーで計算した売価単価。undefined は計算中、null は価格未確定 */
      unit: number | null | undefined;
    }
  | {
      key: string;
      source: 'manual';
      section: QuoteV25Section;
      name: string;
      unit: string;
      quantity: string;
      price: string;
      remark: string;
      state: QuoteLineState | null;
      stateReason: string;
    };

const SECTIONS: { code: QuoteV25Section; label: string }[] = [
  { code: 'base', label: '本体' },
  { code: 'interior_exterior', label: '内外装工事' },
  { code: 'option', label: 'オプション' },
  { code: 'sitework', label: '別途工事' },
];
const EXPENSE_KINDS = new Set(['base_expense', 'interior_exterior_expense', 'option_expense']);
const STATE_KINDS = new Set(['interior_exterior', 'option', 'installation', 'free']);
const QUANTITY = /^\d+(\.\d{1,4})?$/;
const PRICE = /^\d{1,9}$/;

function sectionOfKind(kind: QuoteItem['kind']): QuoteV25Section {
  if (kind === 'base') return 'base';
  if (kind === 'interior_exterior') return 'interior_exterior';
  if (kind === 'option') return 'option';
  return 'sitework';
}

/** 別途見積（価格未確定）の目印のある 0 円の行（DB の quote_line_por_marked と同じ目印） */
function isPorItem(item: QuoteItem): boolean {
  if (item.unit_price !== 0) return false;
  const remark = (item.remark ?? '').trim();
  return (
    (item.description ?? '').trim() === '設置場所確認後に別途お見積り' ||
    (POR_REMARKS as readonly string[]).includes(remark) ||
    remark.startsWith(POR_FACE_REMARK_PREFIX)
  );
}

let seq = 0;
const newKey = (prefix: string) => `${prefix}-${(seq += 1)}`;

/**
 * v2.5 の標準見積から作った見積の第 2 版以降の編集画面（v2.5 PR-D1）。金額はサーバー（DB）が作り、ここは試算して見せるだけ：
 * 前の版の行は前の版の単価のまま（別途見積の行だけ売価を入れられる）、商品台帳の商品は固定した版の v2.5 の売価、自由明細は担当者の売価。
 * 経費・税はサーバーが計算する（千円未満の切り捨てはしない）
 */
export function QuoteV25RevisionForm({
  quote,
  items,
  canEditBase,
  context,
  products,
  porState,
}: {
  quote: Quote;
  items: QuoteItem[];
  canEditBase: boolean;
  context: QuoteV25EditContext;
  products: QuoteV25Product[];
  porState: QuotePorSelectionState;
}) {
  const [state, action, pending] = useActionState<QuoteV25ActionState, FormData>(createQuoteRevisionV25Action, { ok: false });
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product] as const)), [products]);
  const [rows, setRows] = useState<Row[]>(() =>
    items
      .filter((item) => !EXPENSE_KINDS.has(item.kind))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        key: `parent-${item.id}`,
        source: 'parent' as const,
        itemId: item.id,
        section: sectionOfKind(item.kind),
        kind: item.kind,
        name: item.name,
        description: item.description ?? '',
        unit: item.unit ?? '式',
        parentUnitPrice: item.unit_price,
        parentQuantity: item.quantity,
        parentAmount: item.amount,
        quantity: String(item.quantity),
        por: isPorItem(item),
        price: '',
        state: null,
        stateReason: '',
        // 本体の行は総代理店・本部だけが変えられる（代理店の発行では、サーバーが前の版の本体をそのまま写す）
        locked: item.kind === 'base' && !canEditBase,
        isDelta: item.name.trim() === '選択商品の変更差額',
      }))
  );
  const [adjustment, setAdjustment] = useState(String(quote.adjustment));
  const [adjustmentReason, setAdjustmentReason] = useState(quote.adjustment_reason ?? context.standardAdjustmentReason ?? '');
  const [dealerNote, setDealerNote] = useState(quote.dealer_note ?? '');
  const [porConfirmed, setPorConfirmed] = useState(false);
  const [picker, setPicker] = useState<CatalogSection | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? ({ ...row, ...patch } as Row) : row)));
  const remove = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  // 商品台帳の行の売価：選択肢を変えたらサーバーで計算し直す（固定した版の v2.5 の売価）。
  // 計算中に選択肢を変えた行は、古い結果を使わない（行と選択肢の組で照らす）
  useEffect(() => {
    const signature = (row: Extract<Row, { source: 'catalog' }>) => `${row.key}|${[...row.choiceIds].sort().join(',')}`;
    const pending = rows.filter(
      (row): row is Extract<Row, { source: 'catalog' }> => row.source === 'catalog' && row.unit === undefined && !requested.current.has(signature(row))
    );
    if (pending.length === 0) return;
    for (const row of pending) requested.current.add(signature(row));
    fetchQuoteV25UnitsAction({
      quote_id: quote.id,
      items: pending.map((row) => ({ option_id: row.productId, choice_ids: row.choiceIds })),
    }).then((result) => {
      if (!result.ok) {
        // 失敗した組は頼み直さない（計算中のまま止め、案内を出す）
        setUnitsError(result.error);
        return;
      }
      for (const row of pending) requested.current.delete(signature(row));
      setRows((current) =>
        current.map((row) => {
          if (row.source !== 'catalog') return row;
          const index = pending.findIndex((target) => signature(target) === signature(row));
          return index < 0 ? row : { ...row, unit: result.units[index] ?? null };
        })
      );
    });
  }, [quote.id, rows]);

  const adjustmentValue = /^-?\d{1,9}$/.test(adjustment.trim()) ? Number(adjustment.trim()) : null;
  const moneyRows: QuoteV25Row[] = rows.map((row) => {
    if (row.source === 'parent') {
      const priced = row.por && !row.state && PRICE.test(row.price.trim());
      const unitPrice = row.por && !row.state ? (priced ? Number(row.price.trim()) : null) : row.parentUnitPrice;
      const unchanged = !row.state && !priced && QUANTITY.test(row.quantity) && Number(row.quantity) === row.parentQuantity;
      return { section: row.section, unitPrice, quantity: QUANTITY.test(row.quantity) ? row.quantity : '0', state: row.state, unchangedAmount: unchanged ? row.parentAmount : undefined };
    }
    if (row.source === 'catalog') {
      return { section: row.section, unitPrice: row.unit ?? null, quantity: QUANTITY.test(row.quantity) ? row.quantity : '0', state: null };
    }
    const price = PRICE.test(row.price.trim()) ? Number(row.price.trim()) : null;
    // 新しく足した 0 円の行は、状態（0円確定・対象外）を選ばない限り未確定（#529 と同じ）
    return { section: row.section, unitPrice: price === 0 ? null : price, quantity: QUANTITY.test(row.quantity) ? row.quantity : '0', state: row.state };
  });
  const totals = computeQuoteV25Totals(moneyRows, context.money, adjustmentValue ?? 0);

  const problems: string[] = [];
  if (rows.some((row) => row.source !== 'catalog' && row.quantity.trim() !== '' && !QUANTITY.test(row.quantity.trim()))) {
    problems.push('数量は 0 より大きい数（小数 4 桁まで）で入力してください');
  }
  if (rows.some((row) => row.source === 'catalog' && row.unit === undefined)) problems.push('商品の売価を計算しています');
  if (rows.some((row) => row.source === 'catalog' && row.unit === null)) {
    problems.push('価格未確定の商品があります。行を外して、自由明細で金額を入れてください');
  }
  if (rows.some((row) => row.source === 'manual' && !row.name.trim())) problems.push('自由明細の品名を入力してください');
  if (rows.some((row) => row.source !== 'catalog' && row.state === 'zero_confirmed' && !row.stateReason.trim())) {
    problems.push('「0円確定」の理由を入力してください');
  }
  if (totals.hasUnresolved) problems.push('金額が未確定の明細があります。金額を入れるか、「0円確定」「対象外」を選ぶか、行を外してください');
  if (adjustmentValue === null) problems.push('調整額は整数円で入力してください');
  else if (adjustmentValue !== quote.adjustment && adjustmentValue !== 0 && !adjustmentReason.trim()) problems.push('調整額を変えるときは理由を入力してください');
  const porUnavailable = porSelectionUnavailableReason(porState);
  if (porUnavailable) problems.push(porUnavailable);
  if (porState.selections.length > 0 && !porConfirmed) problems.push('お客様が選んだ別途見積の商品の確認にチェックを入れてください');

  const lines: QuoteV25RevisionLine[] = rows
    .filter((row) => !(row.source === 'parent' && row.locked))
    .map((row): QuoteV25RevisionLine => {
      if (row.source === 'parent') {
        return {
          source: 'parent',
          parent_item_id: row.itemId,
          quantity: Number(row.quantity) === row.parentQuantity ? null : row.quantity.trim(),
          unit_price: row.por && !row.state && PRICE.test(row.price.trim()) ? Number(row.price.trim()) : null,
          state: row.state,
          state_reason: row.state ? row.stateReason.trim() || null : null,
        };
      }
      if (row.source === 'catalog') {
        return { source: 'catalog', section: row.section, option_id: row.productId, variant_choice_ids: row.choiceIds, quantity: row.quantity.trim() };
      }
      return {
        source: 'manual',
        section: row.section,
        name: row.name.trim(),
        unit: row.unit.trim() || null,
        quantity: row.quantity.trim(),
        unit_price: PRICE.test(row.price.trim()) ? Number(row.price.trim()) : 0,
        remark: row.remark.trim() || null,
        state: row.state,
        state_reason: row.state ? row.stateReason.trim() || null : null,
      };
    });
  const payload = JSON.stringify({
    quote_id: quote.id,
    lines,
    adjustment: adjustmentValue ?? 0,
    adjustment_reason: adjustmentReason.trim() || null,
    dealer_note: dealerNote.trim() || null,
    por_keys: porState.selections.map((selection) => selection.key),
    por_confirmed: porConfirmed,
  });

  // 金額未確定の確認の欄：前の版の別途見積の行と、新しく足した 0 円の自由明細
  const porRows: QuotePorReviewRow[] = rows.flatMap((row, index): QuotePorReviewRow[] => {
    if (row.source === 'parent' && row.por) {
      return [{
        key: row.key,
        name: row.name,
        sectionLabel: SECTIONS.find((section) => section.code === row.section)?.label ?? '',
        unitPrice: PRICE.test(row.price.trim()) ? Number(row.price.trim()) : 0,
        remark: '',
        lineState: row.state,
        lineStateReason: row.stateReason,
        unresolved: moneyRows[index].unitPrice === null && !row.state,
        editable: true,
        lineStateSelectable: STATE_KINDS.has(row.kind),
      }];
    }
    return [];
  });
  const updatePor = (key: string, patch: QuotePorReviewPatch) => {
    const target = rows.find((row) => row.key === key);
    if (!target || target.source !== 'parent') return;
    update(key, {
      ...(patch.unitPrice !== undefined ? { price: String(patch.unitPrice) } : {}),
      ...(patch.lineState !== undefined ? { state: patch.lineState } : {}),
      ...(patch.lineStateReason !== undefined ? { stateReason: patch.lineStateReason } : {}),
    });
  };

  const addCatalog = (product: QuoteV25Product) => {
    setRows((current) => [
      ...current,
      { key: newKey('catalog'), source: 'catalog', section: product.section, productId: product.id, choiceIds: [...product.defaultChoiceIds], quantity: '1', unit: product.defaultUnit },
    ]);
    setPicker(null);
  };
  const addManual = (section: QuoteV25Section) =>
    setRows((current) => [
      ...current,
      { key: newKey('manual'), source: 'manual', section, name: '', unit: '式', quantity: '1', price: '', remark: '', state: null, stateReason: '' },
    ]);
  const pickerProducts = useMemo(() => {
    const query = pickerQuery.trim().toLocaleLowerCase('ja-JP');
    return products.filter(
      (product) =>
        product.section === picker &&
        (!query || [product.name, product.manufacturer, product.modelNo, product.categoryName].join(' ').toLocaleLowerCase('ja-JP').includes(query))
    );
  }, [picker, pickerQuery, products]);

  const stateSelect = (row: Extract<Row, { source: 'parent' | 'manual' }>) =>
    row.source === 'parent' && !STATE_KINDS.has(row.kind) ? null : (
      <div className="space-y-1">
        <Select value={row.state ?? ''} aria-label={`扱い：${row.name || '自由明細'}`} className="h-7 text-xs" data-testid="v25-revision-state"
          onChange={(event) => update(row.key, { state: (event.target.value || null) as QuoteLineState | null })}>
          <option value="">金額のとおり</option>
          <option value="zero_confirmed">0円確定</option>
          <option value="excluded">対象外</option>
        </Select>
        {row.state && (
          <Input value={row.stateReason} maxLength={190} className="h-7 text-xs" aria-label="理由・メモ"
            placeholder={row.state === 'zero_confirmed' ? '理由（必須）' : 'メモ（任意）'}
            onChange={(event) => update(row.key, { stateReason: event.target.value })} />
        )}
      </div>
    );

  return (
    <form action={action} className="space-y-3 px-3 py-3" data-testid="quote-v25-revision-form">
      <input type="hidden" name="payload" value={payload} />
      <Alert tone="info">
        v2.5 の標準見積（第 {context.revisionVersion} 版）で作った見積です。金額はサーバーが計算します：前の版の行は前の版の単価のまま、
        商品台帳の商品はこの版の売価、自由明細は入力した税別の売価。経費（{Number(context.money.expenseRate) * 100}%）と消費税は自動で計算し、千円未満の切り捨てはしません。
        値引きなどは調整額（理由つき）か自由明細で入れてください。
      </Alert>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {unitsError && <Alert tone="warn">{unitsError}</Alert>}

      <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full min-w-[60rem] border-collapse text-xs" data-testid="v25-revision-grid">
          <thead className="bg-slate-100 text-[0.7rem] text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">品名</th>
              <th className="w-20 px-2 py-1.5 text-right font-medium">数量</th>
              <th className="w-14 px-2 py-1.5 text-left font-medium">単位</th>
              <th className="w-28 px-2 py-1.5 text-right font-medium">単価（税別）</th>
              <th className="w-28 px-2 py-1.5 text-right font-medium">金額</th>
              <th className="w-44 px-2 py-1.5 text-left font-medium">扱い・備考</th>
              <th className="w-14 px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {SECTIONS.map((section) => {
              const sectionRows = rows.map((row, index) => ({ row, index })).filter(({ row }) => row.section === section.code);
              const expense = totals.expenses[section.code];
              const catalogSection = section.code === 'base' ? null : (section.code as CatalogSection);
              return [
                <tr key={`${section.code}-head`} className="border-y border-slate-300 bg-[#eef3ef]" data-testid={`v25-revision-section-${section.code}`}>
                  <td colSpan={7} className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">
                        {section.label}
                        <span className="ml-2 font-normal text-muted">
                          小計 {formatYen(totals.lineTotals[section.code])}
                          {context.money.expenseSections.includes(section.code) ? `・経費 ${formatYen(expense)}` : ''}
                        </span>
                      </span>
                      {(section.code !== 'base' || canEditBase) && (
                        <span className="flex gap-2">
                          {catalogSection && (
                            <button type="button" className="btn-secondary btn-sm" data-testid={`v25-revision-add-product-${section.code}`}
                              onClick={() => { setPicker(catalogSection); setPickerQuery(''); }}>
                              ＋ 商品台帳から
                            </button>
                          )}
                          <button type="button" className="btn-secondary btn-sm" data-testid={`v25-revision-add-line-${section.code}`} onClick={() => addManual(section.code)}>
                            ＋ 自由明細
                          </button>
                        </span>
                      )}
                    </div>
                  </td>
                </tr>,
                ...sectionRows.map(({ row, index }) => {
                  const amount = quoteV25RowAmount(moneyRows[index]);
                  if (row.source === 'parent') {
                    const priceEditable = row.por && !row.state;
                    return (
                      <tr key={row.key} className="border-b border-slate-200 align-top" data-testid="v25-revision-row" data-source="parent">
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-ink">{row.name}</span>
                          {row.description && <span className="block text-[0.68rem] text-muted">{row.description}</span>}
                          {row.por && !row.state && !PRICE.test(row.price.trim()) && <Badge tone="warn">未確定</Badge>}
                        </td>
                        <td className="px-1 py-1">
                          <Input value={row.quantity} inputMode="decimal" disabled={row.locked || row.isDelta} aria-label={`数量：${row.name}`}
                            className="h-7 text-right text-xs" onChange={(event) => update(row.key, { quantity: event.target.value })} />
                        </td>
                        <td className="px-2 py-1.5 text-muted">{row.unit}</td>
                        <td className="px-1 py-1 text-right tabular-nums">
                          {priceEditable ? (
                            <Input value={row.price} inputMode="numeric" placeholder="売価" aria-label={`売価：${row.name}`} className="h-7 text-right text-xs"
                              onChange={(event) => update(row.key, { price: event.target.value })} />
                          ) : (
                            <span className="block pt-0.5">{row.state ? '0' : formatYen(row.parentUnitPrice)}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(amount)}</td>
                        <td className="px-1 py-1">{row.locked ? <span className="text-[0.68rem] text-muted">本体（前の版のまま）</span> : stateSelect(row)}</td>
                        <td className="px-1 py-1 text-center">
                          {!row.locked && (
                            <button type="button" className="text-[0.7rem] text-danger underline" onClick={() => remove(row.key)}>外す</button>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  if (row.source === 'catalog') {
                    const product = productById.get(row.productId);
                    return (
                      <tr key={row.key} className="border-b border-slate-200 bg-amber-50/40 align-top" data-testid="v25-revision-row" data-source="catalog">
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-ink">{product?.name ?? '（商品が見つかりません）'}</span>
                          <span className="block text-[0.68rem] text-muted">{[product?.categoryName, product?.manufacturer, product?.modelNo].filter(Boolean).join(' ／ ')}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(product?.groups ?? []).map((group) => (
                              <Select key={group.id} aria-label={group.name} className="h-7 w-auto text-xs"
                                value={group.choices.find((choice) => row.choiceIds.includes(choice.id))?.id ?? ''}
                                onChange={(event) => {
                                  const others = row.choiceIds.filter((id) => !group.choices.some((choice) => choice.id === id));
                                  update(row.key, { choiceIds: event.target.value ? [...others, event.target.value] : others, unit: undefined });
                                }}>
                                {!group.required && <option value="">{group.name}：なし</option>}
                                {group.choices.map((choice) => <option key={choice.id} value={choice.id}>{group.name}：{choice.name}</option>)}
                              </Select>
                            ))}
                          </div>
                        </td>
                        <td className="px-1 py-1">
                          <Input value={row.quantity} inputMode="decimal" aria-label={`数量：${product?.name ?? ''}`} className="h-7 text-right text-xs"
                            onChange={(event) => update(row.key, { quantity: event.target.value })} />
                        </td>
                        <td className="px-2 py-1.5 text-muted">式</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {row.unit === undefined ? '計算中…' : row.unit === null ? <Badge tone="danger">価格未確定</Badge> : formatYen(row.unit)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(amount)}</td>
                        <td className="px-2 py-1.5 text-[0.68rem] text-muted">商品台帳（この版の売価）</td>
                        <td className="px-1 py-1 text-center">
                          <button type="button" className="text-[0.7rem] text-danger underline" onClick={() => remove(row.key)}>外す</button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={row.key} className="border-b border-slate-200 align-top" data-testid="v25-revision-row" data-source="manual">
                      <td className="px-1 py-1">
                        <Input value={row.name} placeholder="品名" maxLength={120} aria-label="自由明細の品名" className="h-7 text-xs"
                          onChange={(event) => update(row.key, { name: event.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <Input value={row.quantity} inputMode="decimal" aria-label="自由明細の数量" className="h-7 text-right text-xs"
                          onChange={(event) => update(row.key, { quantity: event.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        <Input value={row.unit} maxLength={40} aria-label="自由明細の単位" className="h-7 text-xs" onChange={(event) => update(row.key, { unit: event.target.value })} />
                      </td>
                      <td className="px-1 py-1">
                        {row.state ? (
                          <span className="block pt-0.5 text-right">0</span>
                        ) : (
                          <Input value={row.price} inputMode="numeric" placeholder="税別の売価" aria-label="自由明細の売価" className="h-7 text-right text-xs"
                            onChange={(event) => update(row.key, { price: event.target.value })} />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(amount)}</td>
                      <td className="space-y-1 px-1 py-1">
                        {stateSelect(row)}
                        {!row.state && (
                          <Input value={row.remark} maxLength={200} placeholder="備考" aria-label="自由明細の備考" className="h-7 text-xs"
                            onChange={(event) => update(row.key, { remark: event.target.value })} />
                        )}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button type="button" className="text-[0.7rem] text-danger underline" onClick={() => remove(row.key)}>外す</button>
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr className="border-t-2 border-slate-300">
              <td colSpan={4} className="px-2 py-1.5 text-right text-muted">税別小計（経費を含む）</td>
              <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatYen(totals.rawSubtotal)}</td>
              <td colSpan={2} />
            </tr>
            <tr>
              <td colSpan={4} className="px-2 py-1 text-right text-muted">調整額</td>
              <td className="px-1 py-1">
                <Input value={adjustment} inputMode="numeric" aria-label="調整額" className="h-7 text-right text-xs" data-testid="v25-revision-adjustment"
                  onChange={(event) => setAdjustment(event.target.value)} />
              </td>
              <td colSpan={2} className="px-1 py-1">
                <Input value={adjustmentReason} maxLength={500} placeholder="調整額の理由" aria-label="調整額の理由" className="h-7 text-xs"
                  onChange={(event) => setAdjustmentReason(event.target.value)} />
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="px-2 py-1 text-right text-muted">消費税</td>
              <td className="px-2 py-1 text-right tabular-nums">{formatYen(totals.tax)}</td>
              <td colSpan={2} />
            </tr>
            <tr className="border-t border-slate-300">
              <td colSpan={4} className="px-2 py-1.5 text-right font-semibold">合計（税込・試算）</td>
              <td className="px-2 py-1.5 text-right text-sm font-semibold tabular-nums" data-testid="v25-revision-total">{formatYen(totals.total)}</td>
              <td colSpan={2} className="px-2 py-1.5 text-[0.68rem] text-muted">
                前の版 {formatYen(quote.total)}（差 {formatYen(totals.total - quote.total)}）
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <QuotePorReview
        rows={porRows}
        selections={porState.selections}
        confirmed={porConfirmed}
        onConfirmedChange={setPorConfirmed}
        onUpdate={updatePor}
      />

      <label className="block space-y-1 text-xs">
        <span className="font-semibold text-ink-soft">申し送り（現地条件・工期など）</span>
        <Textarea value={dealerNote} maxLength={1000} rows={3} onChange={(event) => setDealerNote(event.target.value)} />
      </label>

      {problems.length > 0 && (
        <Alert tone="warn">
          <ul className="list-disc space-y-0.5 pl-5">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || problems.length > 0} data-testid="v25-revision-submit">
          {pending ? '発行しています…' : `第${quote.revision + 1}版を発行する`}
        </Button>
      </div>

      {picker && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]" onClick={() => setPicker(null)}>
          <div role="dialog" aria-modal="true" aria-label="商品台帳から足す" className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">{SECTIONS.find((section) => section.code === picker)?.label}：商品台帳から足す</p>
              <button type="button" className="text-sm text-muted underline" onClick={() => setPicker(null)}>閉じる</button>
            </div>
            <div className="border-b border-line px-4 py-2">
              <Input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="商品名・メーカー・型番" aria-label="商品を検索" className="h-8 text-xs" />
            </div>
            <ul className="divide-y divide-line overflow-y-auto" data-testid="v25-revision-picker">
              {pickerProducts.map((product) => (
                <li key={product.id}>
                  <button type="button" disabled={product.defaultUnit === null}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-sand/40 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => addCatalog(product)}>
                    <span className="min-w-0">
                      <span className="font-medium">{product.name}</span>
                      <span className="block text-xs text-muted">{[product.categoryName, product.manufacturer, product.modelNo].filter(Boolean).join(' ／ ')}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">
                      {product.defaultUnit === null ? '価格未確定（自由明細で）' : formatYen(product.defaultUnit)}
                    </span>
                  </button>
                </li>
              ))}
              {pickerProducts.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">選べる商品がありません。</li>}
            </ul>
          </div>
        </div>
      )}
    </form>
  );
}
