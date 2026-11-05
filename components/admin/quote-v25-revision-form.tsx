'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { createQuoteRevisionV25Action, fetchQuoteV25UnitsAction, type QuoteV25ActionState } from '@/lib/actions/quote-v25';
import type { QuoteV25EditContext, QuoteV25RevisionLine } from '@/lib/data/store';
import { formatYen } from '@/lib/domain/pricing';
import { pruneHiddenVariantChoices, visibleVariantGroups } from '@/lib/domain/preset';
import {
  computeQuoteV25Totals,
  QUOTE_V25_EXPENSE_MAX,
  quoteV25ExpenseLines,
  quoteV25RowAmount,
  type QuoteV25ExpenseSettings,
  type QuoteV25Row,
  type QuoteV25Section,
} from '@/lib/domain/quote-v25';
import {
  findUnresolvedLines,
  isPorMarkedLine,
  LINE_STATE_KINDS,
  POR_DESCRIPTION,
  porSelectionUnavailableReason,
  type QuoteLineCheckLine,
  type QuoteLineState,
  type QuotePorSelectionState,
} from '@/lib/domain/quote-por';
import type { OptionVariantChoice, OptionVariantGroup, Quote, QuoteItem } from '@/lib/domain/types';
import { Alert, Badge, Button, Input, Select, Textarea } from '@/components/ui';
import { QuotePorReview, type QuotePorReviewPatch, type QuotePorReviewRow } from './quote-por-review';

/** 商品台帳の商品（固定した版の売価つき。原価・旧来の追加金額は渡さない） */
export interface QuoteV25Product {
  id: string;
  name: string;
  categoryName: string;
  section: 'interior_exterior' | 'option' | 'sitework';
  manufacturer: string;
  modelNo: string;
  /** この商品の公開中の選択項目・選択肢（表示条件の判定に使う。選択肢の追加金額は 0 にして渡す） */
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
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
      remark: string;
      optionId: string | null;
      unit: string;
      parentUnitPrice: number;
      parentQuantity: number;
      parentAmount: number;
      quantity: string;
      /** 前の版で別途見積（価格未確定）の行。担当者が売価を入れられる（集約の行を除く） */
      por: boolean;
      /** 第 1 版の「価格未確定の商品」（選んだ商品の集約の行）。金額は入れず、扱いを決めるか外す */
      aggregate: boolean;
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
/** 区分の経費の行（品名は見積の経費の行と同じ） */
const EXPENSE_LABEL: Record<'base' | 'interior_exterior' | 'option', string> = {
  base: '本体諸費用',
  interior_exterior: '内外装工事経費',
  option: 'オプション諸費用',
};
type ExpenseSection = keyof typeof EXPENSE_LABEL;
type ExpenseInput = { method: 'rate' | 'fixed'; amount: string };
const QUANTITY = /^\d+(\.\d{1,4})?$/;
const PRICE = /^\d{1,9}$/;
/** 別途見積の行に入れる売価（1 円以上。0 円にするときは「0円確定」） */
const POR_PRICE = /^[1-9]\d{0,8}$/;

const validQuantity = (value: string) => QUANTITY.test(value.trim()) && Number(value) > 0 && Number(value) <= 99999;

function sectionOfKind(kind: QuoteItem['kind']): QuoteV25Section {
  if (kind === 'base') return 'base';
  if (kind === 'interior_exterior') return 'interior_exterior';
  if (kind === 'option') return 'option';
  return 'sitework';
}

function kindOfSection(section: QuoteV25Section): QuoteItem['kind'] {
  return section === 'sitework' ? 'installation' : section;
}

let seq = 0;
const newKey = (prefix: string) => `${prefix}-${(seq += 1)}`;

/**
 * v2.5 の標準見積から作った見積の第 2 版以降の編集画面（v2.5 PR-D1）。金額はサーバー（DB）が作り、ここは試算して見せるだけ：
 * 前の版の行は前の版の単価のまま（別途見積の行だけ売価を入れられる）、商品台帳の商品は固定した版の v2.5 の売価、自由明細は担当者の売価。
 * 経費・税はサーバーが計算する（千円未満の切り捨てはしない）。金額未確定の判定は DB と同じ決まり（findUnresolvedLines）
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
      .map((item) => {
        const por = item.unit_price === 0 && isPorMarkedLine(item);
        return {
          key: `parent-${item.id}`,
          source: 'parent' as const,
          itemId: item.id,
          section: sectionOfKind(item.kind),
          kind: item.kind,
          name: item.name,
          description: item.description ?? '',
          remark: item.remark ?? '',
          optionId: item.option_id ?? null,
          unit: item.unit ?? '式',
          parentUnitPrice: item.unit_price,
          parentQuantity: item.quantity,
          parentAmount: item.amount,
          quantity: String(item.quantity),
          por,
          aggregate: por && (item.description ?? '').includes('合計に含めていません'),
          price: '',
          state: null,
          stateReason: '',
          // 本体の行は総代理店・本部だけが変えられる（代理店の発行では、サーバーが前の版の本体をそのまま写す）
          locked: item.kind === 'base' && !canEditBase,
          isDelta: item.name.trim() === '選択商品の変更差額',
        };
      })
  );
  const [adjustment, setAdjustment] = useState(String(quote.adjustment));
  const [adjustmentReason, setAdjustmentReason] = useState(quote.adjustment_reason ?? context.standardAdjustmentReason ?? '');
  const [dealerNote, setDealerNote] = useState(quote.dealer_note ?? '');
  const [porConfirmed, setPorConfirmed] = useState(false);
  const [picker, setPicker] = useState<CatalogSection | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  // 区分の経費の決め方（A-2 ⑥）：前の版の決め方から始める。DB の更新の前（決め方を返さない）は率だけ
  const expenseManual = context.money.expenses !== undefined;
  const [expenseInputs, setExpenseInputs] = useState<Record<ExpenseSection, ExpenseInput>>(() => {
    const of = (section: ExpenseSection): ExpenseInput => {
      const setting = context.money.expenses?.[section];
      return setting?.method === 'fixed' ? { method: 'fixed', amount: String(setting.amount) } : { method: 'rate', amount: '' };
    };
    return { base: of('base'), interior_exterior: of('interior_exterior'), option: of('option') };
  });
  const expenseAmountOk = (input: ExpenseInput) => PRICE.test(input.amount.trim()) && Number(input.amount.trim()) <= QUOTE_V25_EXPENSE_MAX;
  // 試算と発行に使う決め方（手動の額が正しくない区分は、直すまで率で試算し、発行を止める）
  const expenseSettings: QuoteV25ExpenseSettings = Object.fromEntries(
    (Object.keys(EXPENSE_LABEL) as ExpenseSection[]).map((section) => {
      const input = expenseInputs[section];
      return [section, input.method === 'fixed' && expenseAmountOk(input) ? { method: 'fixed', amount: Number(input.amount.trim()) } : { method: 'rate' }];
    })
  );
  const expenseInvalid =
    expenseManual &&
    (Object.keys(EXPENSE_LABEL) as ExpenseSection[]).some(
      (section) => context.money.expenseSections.includes(section) && expenseInputs[section].method === 'fixed' && !expenseAmountOk(expenseInputs[section])
    );

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

  const porPriced = (row: Extract<Row, { source: 'parent' }>) => row.por && !row.aggregate && !row.state && POR_PRICE.test(row.price.trim());
  const adjustmentValue = /^-?\d{1,9}$/.test(adjustment.trim()) ? Number(adjustment.trim()) : null;
  const moneyRows: QuoteV25Row[] = rows.map((row) => {
    const quantity = validQuantity(row.quantity) ? row.quantity.trim() : '0';
    if (row.source === 'parent') {
      const priced = porPriced(row);
      const unitPrice = row.por && !row.state ? (priced ? Number(row.price.trim()) : null) : row.parentUnitPrice;
      const unchanged = !row.state && !priced && validQuantity(row.quantity) && Number(row.quantity) === row.parentQuantity;
      return { section: row.section, unitPrice, quantity, state: row.state, unchangedAmount: unchanged ? row.parentAmount : undefined };
    }
    if (row.source === 'catalog') return { section: row.section, unitPrice: row.unit ?? null, quantity, state: null };
    const price = PRICE.test(row.price.trim()) ? Number(row.price.trim()) : null;
    return { section: row.section, unitPrice: price, quantity, state: row.state };
  });
  const totals = computeQuoteV25Totals(moneyRows, context.money, adjustmentValue ?? 0, expenseManual ? expenseSettings : undefined);

  // 金額未確定の判定は DB（assert_quote_lines_resolved）と同じ決まり：発行する版の明細の形にして、前の版の明細と照らす
  const issuedLines: (QuoteLineCheckLine & { rowKey: string })[] = rows.map((row) => {
    if (row.source === 'parent') {
      const priced = porPriced(row);
      return {
        rowKey: row.key,
        kind: row.kind,
        name: row.name,
        description: priced && row.description.trim() === POR_DESCRIPTION ? null : row.description,
        remark: priced ? null : row.remark,
        unit_price: row.state ? 0 : priced ? Number(row.price.trim()) : row.parentUnitPrice,
        option_id: row.optionId,
        line_state: row.state,
      };
    }
    if (row.source === 'catalog') {
      const product = productById.get(row.productId);
      return { rowKey: row.key, kind: kindOfSection(row.section), name: product?.name ?? '', description: product?.categoryName ?? null, remark: null, unit_price: row.unit ?? 0, option_id: row.productId, line_state: null };
    }
    return {
      rowKey: row.key,
      kind: kindOfSection(row.section),
      name: row.name.trim(),
      description: null,
      remark: row.remark,
      unit_price: row.state ? 0 : PRICE.test(row.price.trim()) ? Number(row.price.trim()) : 0,
      line_state: row.state,
    };
  });
  const unresolvedLines = findUnresolvedLines(issuedLines, { parentLines: items });
  const unresolvedKeys = new Set([...unresolvedLines].map((line) => line.rowKey));

  const problems: string[] = [];
  if (rows.some((row) => !validQuantity(row.quantity))) problems.push('数量は 0 より大きく 99999 以下の数（小数 4 桁まで）で入力してください');
  if (rows.some((row) => row.source === 'catalog' && row.unit === undefined)) problems.push('商品の売価を計算しています');
  if (rows.some((row) => row.source === 'catalog' && row.unit === null)) {
    problems.push('価格未確定の商品があります。行を外して、自由明細で金額を入れてください');
  }
  if (
    rows.some((row) => {
      if (row.source !== 'catalog') return false;
      const product = productById.get(row.productId);
      if (!product) return false;
      return visibleVariantGroups(product.variantGroups, product.variantChoices, row.choiceIds).some(
        (group) =>
          group.is_required &&
          product.variantChoices.some((choice) => choice.group_id === group.id) &&
          !product.variantChoices.some((choice) => choice.group_id === group.id && row.choiceIds.includes(choice.id))
      );
    })
  ) {
    problems.push('商品の必須の仕様を選んでください');
  }
  if (rows.some((row) => row.source === 'manual' && !row.name.trim())) problems.push('自由明細の品名を入力してください');
  if (rows.some((row) => row.source === 'manual' && !row.state && !PRICE.test(row.price.trim()))) problems.push('自由明細の売価を整数円で入力してください');
  if (rows.some((row) => row.source === 'parent' && row.por && !row.aggregate && !row.state && row.price.trim() !== '' && !POR_PRICE.test(row.price.trim()))) {
    problems.push('別途見積の行の売価は 1 円以上の整数で入力してください（0 円にするときは「0円確定」を選びます）');
  }
  if (rows.some((row) => row.source !== 'catalog' && row.state === 'zero_confirmed' && !row.stateReason.trim())) {
    problems.push('「0円確定」の理由を入力してください');
  }
  if (unresolvedKeys.size > 0) problems.push(`金額が未確定の明細が ${unresolvedKeys.size} 行あります。金額を入れるか、「0円確定」「対象外」を選ぶか、行を外してください`);
  if (expenseInvalid) problems.push('経費の手動の額は 0〜100,000,000 円の整数で入力してください');
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
          quantity: validQuantity(row.quantity) && Number(row.quantity) !== row.parentQuantity ? row.quantity.trim() : null,
          unit_price: porPriced(row) ? Number(row.price.trim()) : null,
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
        unit_price: !row.state && PRICE.test(row.price.trim()) ? Number(row.price.trim()) : 0,
        remark: row.state ? null : row.remark.trim() || null,
        state: row.state,
        state_reason: row.state ? row.stateReason.trim() || null : null,
      };
    })
    // 前の版から変えた区分の経費の決め方（送らない区分は、サーバーが前の版の決め方を引き継ぐ）
    .concat(quoteV25ExpenseLines(context.money, expenseSettings));
  const payload = JSON.stringify({
    quote_id: quote.id,
    lines,
    adjustment: adjustmentValue ?? 0,
    adjustment_reason: adjustmentReason.trim() || null,
    dealer_note: dealerNote.trim() || null,
    por_keys: porState.selections.map((selection) => selection.key),
    por_confirmed: porConfirmed,
  });

  // 金額未確定の確認の欄：前の版の別途見積の行（集約の行は扱いだけ）
  const porRows: QuotePorReviewRow[] = rows.flatMap((row): QuotePorReviewRow[] =>
    row.source === 'parent' && row.por
      ? [{
          key: row.key,
          name: row.name,
          sectionLabel: SECTIONS.find((section) => section.code === row.section)?.label ?? '',
          unitPrice: POR_PRICE.test(row.price.trim()) ? Number(row.price.trim()) : 0,
          remark: '',
          lineState: row.state,
          lineStateReason: row.stateReason,
          unresolved: unresolvedKeys.has(row.key),
          editable: !row.aggregate,
          lineStateSelectable: LINE_STATE_KINDS.has(row.kind),
          note: row.aggregate ? '選んだ商品の集約の行です。商品ごとの明細を足し、この行は表で「0円確定」か「対象外」にするか外してください' : undefined,
        }]
      : []
  );
  const updatePor = (key: string, patch: QuotePorReviewPatch) => {
    const target = rows.find((row) => row.key === key);
    if (!target || target.source !== 'parent' || target.aggregate) return;
    update(key, {
      ...(patch.unitPrice !== undefined ? { price: patch.unitPrice > 0 ? String(patch.unitPrice) : '' } : {}),
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
  const expensePercent = String(Math.round(Number(context.money.expenseRate) * 10000) / 100);
  const setExpense = (section: ExpenseSection, patch: Partial<ExpenseInput>) =>
    setExpenseInputs((current) => ({ ...current, [section]: { ...current[section], ...patch } }));

  // 区分の経費の行：率で計算か、金額を手動か（本体諸費用は本体の行と同じく本部・総代理店だけが変えられる）
  const expenseRow = (section: QuoteV25Section) => {
    if (!expenseManual || section === 'sitework' || !context.money.expenseSections.includes(section)) return null;
    const input = expenseInputs[section];
    const locked = section === 'base' && !canEditBase;
    return (
      <tr key={`${section}-expense`} className="border-b border-slate-200 bg-slate-50/70 align-top" data-testid="v25-revision-expense" data-section={section}>
        <td className="px-2 py-1.5">
          <span className="font-medium text-ink">{EXPENSE_LABEL[section]}</span>
          <span className="block text-[0.68rem] text-muted">交通費、労災、安全管理費等</span>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-muted">1</td>
        <td className="px-2 py-1.5 text-muted">式</td>
        <td className="space-y-1 px-1 py-1">
          <Select value={input.method} disabled={locked} aria-label={`経費の決め方：${EXPENSE_LABEL[section]}`} className="h-7 text-xs"
            data-testid="v25-revision-expense-method"
            onChange={(event) => {
              const method = event.target.value as ExpenseInput['method'];
              // 手動にしたときは、今の率の額から始める
              setExpense(section, method === 'fixed' && input.amount.trim() === '' ? { method, amount: String(totals.expenses[section]) } : { method });
            }}>
            <option value="rate">率で計算（{expensePercent}%）</option>
            <option value="fixed">金額を手動</option>
          </Select>
          {input.method === 'fixed' && (
            <Input value={input.amount} inputMode="numeric" disabled={locked} placeholder="税別の金額" aria-label={`経費の手動の額：${EXPENSE_LABEL[section]}`}
              className="h-7 text-right text-xs" data-testid="v25-revision-expense-amount"
              onChange={(event) => setExpense(section, { amount: event.target.value })} />
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(totals.expenses[section])}</td>
        <td className="px-2 py-1.5 text-[0.68rem] text-muted">
          {locked ? '本体（前の版のまま）' : input.method === 'fixed' ? '手動の額（明細を変えても変わりません）' : `区分の小計 × ${expensePercent}%`}
        </td>
        <td />
      </tr>
    );
  };

  const stateSelect = (row: Extract<Row, { source: 'parent' | 'manual' }>) =>
    !LINE_STATE_KINDS.has(row.source === 'parent' ? row.kind : kindOfSection(row.section)) ? null : (
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
        商品台帳の商品はこの版の売価、自由明細は入力した税別の売価。
        {expenseManual
          ? `経費は区分ごとに「率で計算（${expensePercent}%）」か「金額を手動」で決めます（前の版の決め方を引き継ぎ、手動の額は明細を変えても変わりません）。消費税は自動で計算し、千円未満の切り捨てはしません。`
          : `経費（${expensePercent}%）と消費税は自動で計算し、千円未満の切り捨てはしません。`}
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
              const catalogSection = section.code === 'base' ? null : (section.code as CatalogSection);
              return [
                <tr key={`${section.code}-head`} className="border-y border-slate-300 bg-[#eef3ef]" data-testid={`v25-revision-section-${section.code}`}>
                  <td colSpan={7} className="px-2 py-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink">
                        {section.label}
                        <span className="ml-2 font-normal text-muted">
                          小計 {formatYen(totals.lineTotals[section.code])}
                          {context.money.expenseSections.includes(section.code)
                            ? `・経費 ${formatYen(totals.expenses[section.code])}${expenseManual && expenseSettings[section.code]?.method === 'fixed' ? '（手動）' : ''}`
                            : ''}
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
                  const unresolved = unresolvedKeys.has(row.key);
                  if (row.source === 'parent') {
                    const priceEditable = row.por && !row.aggregate && !row.state;
                    return (
                      <tr key={row.key} className="border-b border-slate-200 align-top" data-testid="v25-revision-row" data-source="parent">
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-ink">{row.name}</span>
                          {row.description && <span className="block text-[0.68rem] text-muted">{row.description}</span>}
                          {unresolved && <Badge tone="warn">未確定</Badge>}
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
                    const groups = product ? visibleVariantGroups(product.variantGroups, product.variantChoices, row.choiceIds) : [];
                    return (
                      <tr key={row.key} className="border-b border-slate-200 bg-amber-50/40 align-top" data-testid="v25-revision-row" data-source="catalog">
                        <td className="px-2 py-1.5">
                          <span className="font-medium text-ink">{product?.name ?? '（商品が見つかりません）'}</span>
                          <span className="block text-[0.68rem] text-muted">{[product?.categoryName, product?.manufacturer, product?.modelNo].filter(Boolean).join(' ／ ')}</span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {groups.map((group) => {
                              const choices = (product?.variantChoices ?? []).filter((choice) => choice.group_id === group.id).sort((a, b) => a.sort_order - b.sort_order);
                              const current = choices.find((choice) => row.choiceIds.includes(choice.id))?.id ?? '';
                              return (
                                <Select key={group.id} aria-label={group.name} className="h-7 w-auto text-xs" value={current}
                                  onChange={(event) => {
                                    if (!product) return;
                                    const others = row.choiceIds.filter((id) => !choices.some((choice) => choice.id === id));
                                    const next = pruneHiddenVariantChoices(product.variantGroups, product.variantChoices, event.target.value ? [...others, event.target.value] : others);
                                    update(row.key, { choiceIds: next, unit: undefined });
                                  }}>
                                  {(!group.is_required || !current) && <option value="">{group.is_required ? `${group.name}：選んでください` : `${group.name}：なし`}</option>}
                                  {choices.map((choice) => <option key={choice.id} value={choice.id}>{group.name}：{choice.name}</option>)}
                                </Select>
                              );
                            })}
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
                        {unresolved && <Badge tone="warn">未確定</Badge>}
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
                expenseRow(section.code),
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
