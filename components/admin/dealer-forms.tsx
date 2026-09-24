'use client';

import { Fragment, useActionState, useState, type KeyboardEvent } from 'react';
import { LockKeyhole, Plus, Trash2, X } from 'lucide-react';
import { assignQuoteDealerAction, createDealerRevisionAction, updateUserRoleAction } from '@/lib/actions/admin';
import { formatQty, formatYen } from '@/lib/domain/pricing';
import { ROLE_LABELS, type Profile, type Quote, type QuoteItem, type RoleCode } from '@/lib/domain/types';
import type { RevisionItemKind } from '@/lib/data/store';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';
import { CatalogPickerDialog, type CatalogPickerItem } from './catalog-picker';

const initial = { ok: false } as const;

/** 管理者：見積の担当代理店を割り当てる */
export function AssignDealerForm({ quote, dealers }: { quote: Quote; dealers: Profile[] }) {
  const [state, action, pending] = useActionState(assignQuoteDealerAction, initial);
  return (
    <form action={action} className="card space-y-4 p-6" noValidate data-testid="assign-dealer-form">
      <input type="hidden" name="quote_id" value={quote.id} />
      <p className="font-semibold">担当代理店</p>
      <p className="text-xs text-muted">
        割り当てると、その代理店は本体を閲覧しながら、現地確認後の施工金額やオプション・別途工事等を見積に反映し、改訂見積を発行できます。
      </p>
      <Status state={state} />
      <Field label="代理店・工務店" htmlFor="dealer_id">
        <Select id="dealer_id" name="dealer_id" defaultValue={quote.dealer_id ?? ''} data-testid="dealer-select">
          <option value="">未割り当て</option>
          {dealers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.company_name || d.full_name}（{d.email}）
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton pending={pending} label="割り当てる" />
    </form>
  );
}

interface Row {
  key: string;
  source_id: string | null;
  kind: RevisionItemKind;
  name: string;
  description: string;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  /** 元の明細から引き継ぐ商品画像（見積書下部の画像一覧用） */
  image_url: string | null;
}

const KIND_LABELS: Record<RevisionItemKind, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  interior_exterior: '内外装工事',
  interior_exterior_expense: '内外装工事経費',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途工事',
  free: 'フリー商品',
};
/** 案件見積で編集できる区分 */
const FULL_KINDS: RevisionItemKind[] = [
  'base',
  'base_expense',
  'interior_exterior',
  'interior_exterior_expense',
  'option',
  'option_expense',
  'installation',
  'free',
];
const DEALER_KINDS: RevisionItemKind[] = [
  'interior_exterior',
  'interior_exterior_expense',
  'option',
  'option_expense',
  'installation',
  'free',
];

const COMMON_SITEWORK_ITEMS = ['運搬費', '基礎工事', '電気工事', '給排水工事', '設置工事'] as const;

/**
 * 案件見積の編集。標準見積そのものは変更せず、発行済み案件をコピーした次版を作る。
 * 代理店は本体を閲覧のみ、オプション・別途等を編集可能。
 * 総代理店・本部は本体を含めて編集可能。
 */
export function DealerRevisionForm({
  quote,
  items,
  freeProducts,
  catalog = [],
  canEditBase,
  sheetMode = false,
  onCancel,
}: {
  quote: Quote;
  items: QuoteItem[];
  freeProducts: { code: string; name: string; price: number }[];
  /** 商品台帳（公開中の商品）。行の追加時に呼び出して選べる */
  catalog?: CatalogPickerItem[];
  /** 本体まで編集できるのは総代理店・本部。代理店は本体を閲覧のみ */
  canEditBase: boolean;
  /** 見積書の位置でExcel風に編集する表示 */
  sheetMode?: boolean;
  /** sheetMode時の編集終了 */
  onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(createDealerRevisionAction, initial);
  const editable = (k: QuoteItem['kind']): k is RevisionItemKind =>
    (canEditBase ? FULL_KINDS : DEALER_KINDS).includes(k as RevisionItemKind);

  const lockedItems = sheetMode ? items.filter((i) => !editable(i.kind)) : [];
  const buildInitialRows = () =>
    items
      .filter((i) => editable(i.kind))
      .map((i, n) => ({
        key: `${i.id}-${n}`,
        source_id: i.id,
        kind: i.kind as RevisionItemKind,
        name: i.name,
        description: i.description ?? '',
        unit: i.unit ?? '式',
        remark: i.remark ?? '',
        unit_price: i.unit_price,
        quantity: i.quantity,
        image_url: i.image_url ?? null,
      }));
  const [rows, setRows] = useState<Row[]>(buildInitialRows);
  const [isDirty, setIsDirty] = useState(false);
  const defaultCollapsedSections = () => new Set<string>(['base', 'interior', 'option', 'free']);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(defaultCollapsedSections);
  const [scopeChangeMode, setScopeChangeMode] = useState(false);
  const [dealerNote, setDealerNote] = useState(quote.dealer_note ?? '');

  const amountOf = (r: Row) => Math.round(r.unit_price * Math.max(0.01, r.quantity || 0));
  const sumOf = (...kinds: RevisionItemKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + amountOf(r), 0);
  // 代理店は本体を変更できないため親見積の本体金額を固定で使う。オプションは代理店でも編集できる。
  const baseTotal = canEditBase ? sumOf('base', 'base_expense') : quote.base_price + quote.base_expense;
  const interiorExteriorTotal = sumOf('interior_exterior', 'interior_exterior_expense');
  const optionTotal = sumOf('option', 'option_expense');
  const siteworkTotal = sumOf('installation');
  const freeTotal = sumOf('free');
  const entered = siteworkTotal + freeTotal;
  const subRaw = baseTotal + interiorExteriorTotal + optionTotal + entered;
  const subtotal = Math.floor(subRaw / 1000) * 1000;
  const tax = Math.floor(subtotal * quote.tax_rate);
  const editingTotal = subtotal + tax;
  const revisionDifference = editingTotal - quote.total;
  const siteworkRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.kind === 'installation');
  const siteworkNames = new Set(siteworkRows.map(({ row }) => row.name.trim()).filter(Boolean));
  const originalEditableItems = items.filter((item) => editable(item.kind));
  const currentBySourceId = new Map(
    rows.filter((row) => row.source_id).map((row) => [row.source_id as string, row])
  );
  const changePreview: { key: string; label: string; delta: number | null }[] = [];

  for (const original of originalEditableItems) {
    const current = currentBySourceId.get(original.id);
    if (!current) {
      changePreview.push({
        key: `removed-${original.id}`,
        label: `${original.name}を削除`,
        delta: -original.amount,
      });
      continue;
    }
    const changed =
      current.kind !== original.kind ||
      current.name !== original.name ||
      current.description !== (original.description ?? '') ||
      current.unit !== (original.unit ?? '式') ||
      current.remark !== (original.remark ?? '') ||
      current.unit_price !== original.unit_price ||
      current.quantity !== original.quantity;
    if (changed) {
      changePreview.push({
        key: `changed-${original.id}`,
        label: `${current.name || original.name}を変更`,
        delta: amountOf(current) - original.amount,
      });
    }
  }
  for (const row of rows.filter((item) => !item.source_id)) {
    changePreview.push({
      key: row.key,
      label: `${row.name.trim() || '新しい項目'}を追加`,
      delta: amountOf(row),
    });
  }
  if (dealerNote !== (quote.dealer_note ?? '')) {
    changePreview.push({ key: 'dealer-note', label: 'お客様への申し送りを変更', delta: null });
  }

  const markDirty = () => setIsDirty(true);
  const update = (key: string, patch: Partial<Row>) => {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    markDirty();
  };
  const toggleSection = (key: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const resetRows = () => {
    setRows(buildInitialRows());
    setCollapsedSections(defaultCollapsedSections());
    setScopeChangeMode(false);
    setDealerNote(quote.dealer_note ?? '');
    setIsDirty(false);
  };
  const toggleScopeChangeMode = () => {
    const next = !scopeChangeMode;
    setScopeChangeMode(next);
    if (!next) setCollapsedSections(defaultCollapsedSections());
  };
  const handleSheetKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key !== 'Enter') return;
    const col = event.currentTarget.dataset.revisionCol;
    if (!col) return;
    event.preventDefault();
    const cells = Array.from(
      document.querySelectorAll<HTMLInputElement>(`[data-revision-col="${col}"]`)
    ).filter((element) => !element.disabled && !element.readOnly && element.offsetParent !== null);
    const index = cells.indexOf(event.currentTarget);
    const target = cells[event.shiftKey ? index - 1 : index + 1];
    if (!target) return;
    target.focus();
    target.select();
  };
  const rowKinds = canEditBase ? FULL_KINDS : DEALER_KINDS;
  const insertByKind = (cur: Row[], next: Row) => {
    const lastSameKind = cur.reduce((last, row, index) => (row.kind === next.kind ? index : last), -1);
    if (lastSameKind >= 0) return [...cur.slice(0, lastSameKind + 1), next, ...cur.slice(lastSameKind + 1)];
    const targetOrder = rowKinds.indexOf(next.kind);
    const nextGroup = cur.findIndex((row) => rowKinds.indexOf(row.kind) > targetOrder);
    if (nextGroup < 0) return [...cur, next];
    return [...cur.slice(0, nextGroup), next, ...cur.slice(nextGroup)];
  };
  const changeKind = (key: string, kind: RevisionItemKind) => {
    setRows((cur) => {
      const row = cur.find((item) => item.key === key);
      if (!row) return cur;
      return insertByKind(cur.filter((item) => item.key !== key), { ...row, kind });
    });
    markDirty();
  };
  const sectionKeyForKind = (kind: Row['kind']) => {
    if (kind === 'base' || kind === 'base_expense') return 'base';
    if (kind === 'interior_exterior' || kind === 'interior_exterior_expense') return 'interior';
    if (kind === 'option' || kind === 'option_expense') return 'option';
    if (kind === 'installation') return 'sitework';
    return 'free';
  };
  const addRow = (kind: Row['kind'], preset?: { name: string; price: number; description?: string; unit?: string; image_url?: string | null }) => {
    setRows((cur) =>
      insertByKind(cur, {
        key: `new-${cur.length}-${Date.now()}-${kind}`,
        source_id: null,
        kind,
        name: preset?.name ?? '',
        description: preset?.description ?? '',
        unit: preset?.unit ?? '式',
        remark: '',
        unit_price: preset?.price ?? 0,
        quantity: 1,
        image_url: preset?.image_url ?? null,
      })
    );
    setCollapsedSections((current) => {
      const next = new Set(current);
      next.delete(sectionKeyForKind(kind));
      return next;
    });
    markDirty();
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const cellInputClass = sheetMode
    ? 'h-7 w-full rounded-none border-transparent bg-transparent px-2 py-0.5 text-xs shadow-none focus:border-[#6d9480] focus:bg-white focus:ring-1 focus:ring-[#6d9480]/30'
    : '';
  const compactMetaInputClass = sheetMode
    ? 'h-5 rounded-none border-transparent bg-transparent px-1 py-0 text-[0.62rem] text-muted shadow-none focus:border-[#6d9480] focus:bg-white focus:ring-1 focus:ring-[#6d9480]/30'
    : 'mt-1 text-xs';
  const isFireDisplayItem = (item: Pick<Row, 'kind' | 'name'> | Pick<QuoteItem, 'kind' | 'name'>) =>
    item.kind === 'option' && item.name.includes('防火');
  const sheetSections: {
    key: 'base' | 'interior' | 'option' | 'sitework' | 'free';
    label: string;
    kinds: RevisionItemKind[];
    subtotalLabel: string;
    amount: number;
    always?: boolean;
  }[] = [
    { key: 'base', label: '本体', kinds: ['base', 'base_expense'], subtotalLabel: '【本体価格計】', amount: baseTotal, always: true },
    { key: 'interior', label: '内外装工事', kinds: ['interior_exterior', 'interior_exterior_expense'], subtotalLabel: '【内外装価格計】', amount: interiorExteriorTotal },
    { key: 'option', label: 'オプション', kinds: ['option', 'option_expense'], subtotalLabel: '【オプション価格計】', amount: optionTotal, always: true },
    { key: 'sitework', label: '別途工事（運送費・現地工事）', kinds: ['installation'], subtotalLabel: '【別途工事計】', amount: siteworkTotal, always: true },
    { key: 'free', label: 'フリー商品', kinds: ['free'], subtotalLabel: '【フリー商品計】', amount: freeTotal },
  ];
  const matchesSheetSection = (
    section: (typeof sheetSections)[number],
    item: Pick<Row, 'kind' | 'name'> | Pick<QuoteItem, 'kind' | 'name'>
  ) => {
    const fire = isFireDisplayItem(item);
    if (section.key === 'base') return section.kinds.includes(item.kind as RevisionItemKind) || fire;
    if (section.key === 'option') return section.kinds.includes(item.kind as RevisionItemKind) && !fire;
    return section.kinds.includes(item.kind as RevisionItemKind);
  };


  return (
    <form
      id="quote-editor"
      action={action}
      className={
        sheetMode
          ? 'scroll-mt-6 overflow-hidden rounded-lg border border-line bg-white shadow-sm'
          : 'card scroll-mt-6 space-y-5 p-6'
      }
      noValidate
      data-testid="dealer-revision-form"
      data-sheet-mode={sheetMode ? 'true' : undefined}
    >
      <input type="hidden" name="quote_id" value={quote.id} />
      <div className={sheetMode ? 'flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#fafbf9] px-3 py-2' : ''}>
        <div>
          <p className={sheetMode ? 'text-xs font-semibold text-[#315745]' : 'font-semibold'}>
            {sheetMode ? `見積内容を編集中（第${quote.revision + 1}版）` : '案件見積の編集'}
          </p>
          <p className={sheetMode ? 'mt-0.5 text-[0.65rem] text-muted' : 'mt-1 text-xs text-muted'}>
            {sheetMode
              ? '現地確認後に決まる運送・基礎・電気・給排水・設置などの金額を入力します。シミュレーターで確定した内容は通常は確認表示です。'
              : '入力内容を反映して改訂見積を発行すると次の版が作られ、現在の版は履歴として残ります。'}
          </p>
        </div>
        {sheetMode && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-ink-soft hover:bg-sand/50"
            data-testid="quote-edit-cancel"
          >
            <X className="size-3.5" aria-hidden="true" />
            編集をやめる
          </button>
        )}
      </div>
      <div className={sheetMode ? 'px-3 pt-2' : ''}>
        <Status state={state} />
      </div>

      {sheetMode ? (
        <>
          <div
            className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white/95 px-3 py-2 shadow-sm backdrop-blur"
            data-testid="revision-sticky-summary"
          >
            <span
              className={
                isDirty
                  ? 'rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[0.65rem] font-semibold text-amber-800'
                  : 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.65rem] font-semibold text-emerald-800'
              }
            >
              {isDirty ? '未保存の変更あり' : '編集前と同じ'}
            </span>
            <span className="text-[0.68rem] text-muted">
              前版 <strong className="ml-1 text-xs text-ink">{formatYen(quote.total)}</strong>
            </span>
            <span className="text-[0.68rem] text-muted">
              編集中 <strong className="ml-1 text-sm text-ink">{formatYen(editingTotal)}</strong>
            </span>
            <span className="text-[0.68rem] text-muted">
              差額{' '}
              <strong className="ml-1 text-xs text-ink">
                {revisionDifference > 0 ? '+' : ''}{formatYen(revisionDifference)}
              </strong>
            </span>
            <button
              type="button"
              className="ml-auto rounded border border-line bg-white px-2 py-1 text-[0.65rem] font-semibold text-ink-soft disabled:opacity-40"
              onClick={resetRows}
              disabled={!isDirty}
            >
              明細を編集前に戻す
            </button>
          </div>

          <div className="max-h-[40rem] overflow-auto [scrollbar-width:thin]" data-testid="revision-sheet-scroll">
            <table className="w-full min-w-[52rem] text-sm" data-testid="revision-preview">
              <thead className="sticky top-0 z-10 bg-[#eef3f2] text-left text-xs text-[#536771]">
                <tr>
                  <th className="min-w-[20rem] px-3 py-1.5 font-semibold">品名</th>
                  <th className="w-16 px-2 py-1.5 text-right font-semibold">数量</th>
                  <th className="w-16 px-2 py-1.5 font-semibold whitespace-nowrap">単位</th>
                  <th className="w-24 px-2 py-1.5 text-right font-semibold">売価</th>
                  <th className="w-28 px-3 py-1.5 text-right font-semibold">売価金額</th>
                  <th className="w-40 px-3 py-1.5 font-semibold">備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {sheetSections.map((section) => {
                  const locked = lockedItems.filter((item) => matchesSheetSection(section, item));
                  const matchedEditableRows = rows
                    .map((row, index) => ({ row, index }))
                    .filter(({ row }) => matchesSheetSection(section, row));
                  const editableRows =
                    section.key === 'base'
                      ? [
                          ...matchedEditableRows.filter(({ row }) => isFireDisplayItem(row)),
                          ...matchedEditableRows.filter(({ row }) => !isFireDisplayItem(row)),
                        ]
                      : matchedEditableRows;
                  if (!section.always && locked.length === 0 && editableRows.length === 0) return null;
                  const isCollapsed = collapsedSections.has(section.key);
                  return (
                    <Fragment key={section.label}>
                      {isCollapsed && editableRows.map(({ row: r, index: i }) => (
                        <Fragment key={`collapsed-${r.key}`}>
                          <input type="hidden" name={`items.${i}.kind`} value={r.kind} />
                          <input type="hidden" name={`items.${i}.name`} value={r.name} />
                          <input type="hidden" name={`items.${i}.description`} value={r.description} />
                          <input type="hidden" name={`items.${i}.unit`} value={r.unit} />
                          <input type="hidden" name={`items.${i}.remark`} value={r.remark} />
                          <input type="hidden" name={`items.${i}.unit_price`} value={r.unit_price} />
                          <input type="hidden" name={`items.${i}.quantity`} value={r.quantity} />
                          <input type="hidden" name={`items.${i}.image_url`} value={r.image_url ?? ''} />
                        </Fragment>
                      ))}
                      <tr className="bg-ivory">
                        <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-ink-soft">
                          <span className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              className="flex size-5 items-center justify-center rounded border border-line bg-white text-[0.7rem] font-bold"
                              aria-expanded={!isCollapsed}
                              aria-label={isCollapsed ? section.label + 'を開く' : section.label + 'を閉じる'}
                              onClick={() => toggleSection(section.key)}
                            >
                              {isCollapsed ? '+' : '−'}
                            </button>
                            <span>{section.label}</span>
                            {section.key === 'sitework' ? (
                              <span className="rounded-full bg-[#e8f3ec] px-2 py-0.5 font-normal text-[0.6rem] text-[#315745]">現地確認後に入力</span>
                            ) : scopeChangeMode ? (
                              <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 font-normal text-[0.6rem] text-[#8a6416]">変更モード</span>
                            ) : (
                              <span className="font-normal text-[0.62rem] text-muted">確定済み・確認のみ</span>
                            )}
                            {section.key === 'base' && rows.some(isFireDisplayItem) && (
                              <span className="font-normal text-[0.62rem] text-muted">防火仕様を含む</span>
                            )}
                          </span>
                        </td>
                      </tr>

                      {!isCollapsed && locked.map((item, index) => {
                        const previous = locked[index - 1];
                        const next = locked[index + 1];
                        const showBaseGroupHeading =
                          section.key === 'base' &&
                          item.kind === 'base' &&
                          Boolean(item.description) &&
                          (previous?.kind !== 'base' || previous.description !== item.description);
                        const showBaseGroupSubtotal =
                          section.key === 'base' &&
                          item.kind === 'base' &&
                          Boolean(item.description) &&
                          (next?.kind !== 'base' || next.description !== item.description);
                        const baseGroupAmount = showBaseGroupSubtotal
                          ? locked
                              .filter((candidate) => candidate.kind === 'base' && candidate.description === item.description)
                              .reduce((sum, candidate) => sum + candidate.amount, 0)
                          : 0;
                        return (
                          <Fragment key={item.id}>
                            {showBaseGroupHeading && (
                              <tr className="bg-sand/40">
                                <td colSpan={6} className="px-3 py-1 text-[0.68rem] font-semibold text-ink-soft">{item.description}</td>
                              </tr>
                            )}
                            <tr className="bg-white text-xs" data-testid={`revision-locked-row-${index}`}>
                              <td className="px-3 py-1">
                                <span className="inline-flex items-center gap-1.5">
                                  <LockKeyhole className="size-3 text-muted" aria-label="変更不可" />
                                  <span>{item.name}</span>
                                </span>
                              </td>
                              <td className="w-16 px-2 py-1 text-right tabular-nums">{formatQty(item.quantity)}</td>
                              <td className="w-16 px-2 py-1 whitespace-nowrap text-muted">{item.unit ?? '式'}</td>
                              <td className="w-24 px-2 py-1 text-right tabular-nums">{item.unit_price !== 0 ? formatYen(item.unit_price) : ''}</td>
                              <td className="w-28 px-3 py-1 text-right tabular-nums">{item.amount !== 0 ? formatYen(item.amount) : '−'}</td>
                              <td className="w-40 px-3 py-1 text-[0.68rem] text-muted">{item.remark ?? ''}</td>
                            </tr>
                            {showBaseGroupSubtotal && (
                              <tr className="bg-white text-[0.68rem] text-ink-soft">
                                <td colSpan={4} className="px-3 py-1 text-right font-semibold">{item.description}　計</td>
                                <td className="px-3 py-1 text-right font-semibold tabular-nums">{formatYen(baseGroupAmount)}</td>
                                <td></td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}

                      {!isCollapsed && editableRows.map(({ row: r, index: i }, visibleIndex) => {
                        const previous = editableRows[visibleIndex - 1]?.row;
                        const next = editableRows[visibleIndex + 1]?.row;
                        const showBaseGroupHeading =
                          section.key === 'base' &&
                          r.kind === 'base' &&
                          Boolean(r.description) &&
                          (previous?.kind !== 'base' || previous.description !== r.description);
                        const showBaseGroupSubtotal =
                          section.key === 'base' &&
                          r.kind === 'base' &&
                          Boolean(r.description) &&
                          (next?.kind !== 'base' || next.description !== r.description);
                        const baseGroupAmount = showBaseGroupSubtotal
                          ? editableRows
                              .filter(({ row }) => row.kind === 'base' && row.description === r.description)
                              .reduce((sum, { row }) => sum + amountOf(row), 0)
                          : 0;
                        const rowEditable = section.key === 'sitework' || scopeChangeMode;
                        const rowInputClass = rowEditable
                          ? cellInputClass
                          : `${cellInputClass} cursor-default bg-[#f7f8f8] text-ink-soft`;
                        const rowMetaInputClass = rowEditable
                          ? compactMetaInputClass
                          : `${compactMetaInputClass} cursor-default bg-[#f7f8f8] text-muted`;
                        return (
                          <Fragment key={r.key}>
                            {showBaseGroupHeading && (
                              <tr className="bg-sand/40">
                                <td colSpan={6} className="px-3 py-1 text-[0.68rem] font-semibold text-ink-soft">{r.description}</td>
                              </tr>
                            )}
                            <tr
                              className={rowEditable ? 'group bg-white text-xs' : 'group bg-[#fbfcfb] text-xs'}
                              data-testid={`revision-row-${i}`}
                              data-editable={rowEditable ? 'true' : 'false'}
                            >
                              <td className="relative px-0 py-0 align-top">
                                <input type="hidden" name={`items.${i}.kind`} value={r.kind} />
                                <input type="hidden" name={`items.${i}.image_url`} value={r.image_url ?? ''} />
                                <div className="flex items-start">
                                  <div className="min-w-0 flex-1">
                                    <Input
                                      name={`items.${i}.name`}
                                      value={r.name}
                                      onChange={(e) => update(r.key, { name: e.target.value })}
                                      aria-label={`${i + 1} 行目の項目名`}
                                      className={rowInputClass}
                                      readOnly={!rowEditable}
                                      data-revision-col="name"
                                      onKeyDown={handleSheetKeyDown}
                                      onFocus={(event) => event.currentTarget.select()}
                                      required
                                    />
                                    <div className="flex border-t border-line/40">
                                      <select
                                        value={r.kind}
                                        onChange={(e) => changeKind(r.key, e.target.value as RevisionItemKind)}
                                        aria-label={`${i + 1} 行目の区分`}
                                        className="h-5 w-28 border-0 bg-transparent px-1 text-[0.6rem] text-muted outline-none focus:bg-white disabled:cursor-default disabled:opacity-70"
                                        disabled={!rowEditable}
                                      >
                                        {(canEditBase ? FULL_KINDS : DEALER_KINDS).map((kind) => (
                                          <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
                                        ))}
                                      </select>
                                      <Input
                                        name={`items.${i}.description`}
                                        value={r.description}
                                        onChange={(e) => update(r.key, { description: e.target.value })}
                                        placeholder="摘要"
                                        aria-label={`${i + 1} 行目の摘要`}
                                        className={`${rowMetaInputClass} min-w-0 flex-1`}
                                        readOnly={!rowEditable}
                                        onFocus={(event) => event.currentTarget.select()}
                                      />
                                    </div>
                                  </div>
                                  {rowEditable && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRows((cur) => cur.filter((x) => x.key !== r.key));
                                        markDirty();
                                      }}
                                      className="mt-1 mr-1 rounded p-1 text-muted opacity-35 hover:bg-sand hover:text-warn group-hover:opacity-100 focus:opacity-100"
                                      aria-label={`${i + 1} 行目を削除`}
                                    >
                                      <Trash2 className="size-3.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="w-16 p-0 align-top">
                                <Input
                                  name={`items.${i}.quantity`}
                                  type="number"
                                  min={0.01}
                                  step="any"
                                  value={r.quantity}
                                  onChange={(e) => update(r.key, { quantity: Number(e.target.value) })}
                                  aria-label={`${i + 1} 行目の数量`}
                                  className={`${rowInputClass} text-right`}
                                  readOnly={!rowEditable}
                                  data-revision-col="quantity"
                                  onKeyDown={handleSheetKeyDown}
                                  onFocus={(event) => event.currentTarget.select()}
                                />
                              </td>
                              <td className="w-16 p-0 align-top">
                                <Input
                                  name={`items.${i}.unit`}
                                  value={r.unit}
                                  onChange={(e) => update(r.key, { unit: e.target.value })}
                                  aria-label={`${i + 1} 行目の単位`}
                                  placeholder="式"
                                  className={rowInputClass}
                                  readOnly={!rowEditable}
                                  data-revision-col="unit"
                                  onKeyDown={handleSheetKeyDown}
                                  onFocus={(event) => event.currentTarget.select()}
                                />
                              </td>
                              <td className="w-24 p-0 align-top">
                                <Input
                                  name={`items.${i}.unit_price`}
                                  type="number"
                                  min={r.name === '選択商品の変更差額' ? undefined : 0}
                                  step={1000}
                                  value={r.unit_price}
                                  onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })}
                                  aria-label={`${i + 1} 行目の売価`}
                                  className={`${rowInputClass} text-right`}
                                  readOnly={!rowEditable}
                                  data-revision-col="sale"
                                  onKeyDown={handleSheetKeyDown}
                                  onFocus={(event) => event.currentTarget.select()}
                                />
                              </td>
                              <td className="w-28 bg-[#fafbf9] px-3 py-1 text-right tabular-nums">{formatYen(amountOf(r))}</td>
                              <td className="w-36 p-0 align-top">
                                <Input
                                  name={`items.${i}.remark`}
                                  value={r.remark}
                                  onChange={(e) => update(r.key, { remark: e.target.value })}
                                  aria-label={`${i + 1} 行目の備考`}
                                  className={rowInputClass}
                                  readOnly={!rowEditable}
                                  data-revision-col="remark"
                                  onKeyDown={handleSheetKeyDown}
                                  onFocus={(event) => event.currentTarget.select()}
                                />
                              </td>
                            </tr>
                            {showBaseGroupSubtotal && (
                              <tr className="bg-white text-[0.68rem] text-ink-soft">
                                <td colSpan={4} className="px-3 py-1 text-right font-semibold">{r.description}　計</td>
                                <td className="px-3 py-1 text-right font-semibold tabular-nums">{formatYen(baseGroupAmount)}</td>
                                <td></td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}

                      <tr className="border-y border-[#d8e1dd] bg-[#f4f7f5] font-semibold">
                        <td colSpan={4} className="px-3 py-1.5 text-xs">{section.subtotalLabel}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums">
                          {section.label.startsWith('別途工事') && section.amount === 0 ? '別途' : formatYen(section.amount)}
                        </td>
                        <td></td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm">
                  <td colSpan={4} className="px-3 pt-3 pb-1">小　計</td>
                  <td className="px-3 pt-3 pb-1 text-right tabular-nums">{formatYen(subRaw)}</td>
                  <td></td>
                </tr>
                <tr className="text-sm text-ink-soft">
                  <td colSpan={4} className="px-3 py-1">値引き等調整額（千円未満切捨て）</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatYen(subtotal - subRaw)}</td>
                  <td></td>
                </tr>
                <tr className="text-sm">
                  <td colSpan={4} className="px-3 py-1">税抜請負額</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatYen(subtotal)}</td>
                  <td></td>
                </tr>
                <tr className="text-sm text-ink-soft">
                  <td colSpan={4} className="px-3 py-1">消費税（{Math.round(quote.tax_rate * 100)}%）</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatYen(tax)}</td>
                  <td></td>
                </tr>
                <tr className="border-t-2 border-ink bg-ivory">
                  <td colSpan={4} className="px-3 py-3 font-serif text-lg">合　計（税込）</td>
                  <td className="px-3 py-3 text-right">
                    <span className="font-serif text-2xl tabular-nums" data-testid="revision-total">
                      {formatYen(editingTotal)}
                    </span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ): (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] text-sm">
            <thead className="bg-sand/60 text-left text-xs text-muted">
              <tr>
                <th className="w-28 px-3 py-2 font-semibold">区分</th>
                <th className="px-3 py-2 font-semibold">項目</th>
                <th className="w-20 px-3 py-2 text-right font-semibold">数量</th>
                <th className="w-16 px-3 py-2 font-semibold">単位</th>
                <th className="w-32 px-3 py-2 text-right font-semibold">単価（売価）</th>
                <th className="w-32 px-3 py-2 text-right font-semibold">金額</th>
                <th className="w-40 px-3 py-2 font-semibold">備考</th>
                <th className="w-10 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => (
                <tr key={r.key} data-testid={`revision-row-${i}`}>
                  <td className="px-3 py-2">
                    <input type="hidden" name={`items.${i}.kind`} value={r.kind} />
                    <input type="hidden" name={`items.${i}.image_url`} value={r.image_url ?? ''} />
                    <Select
                      value={r.kind}
                      onChange={(e) => update(r.key, { kind: e.target.value as RevisionItemKind })}
                      aria-label={`${i + 1} 行目の区分`}
                      className="py-1 text-xs"
                    >
                      {(canEditBase ? FULL_KINDS : DEALER_KINDS).map((kind) => (
                        <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <Input name={`items.${i}.name`} value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} required />
                    <Input name={`items.${i}.description`} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} className="mt-1 text-xs" />
                  </td>
                  <td className="px-3 py-2"><Input name={`items.${i}.quantity`} type="number" value={r.quantity} onChange={(e) => update(r.key, { quantity: Number(e.target.value) })} className="text-right" /></td>
                  <td className="px-3 py-2"><Input name={`items.${i}.unit`} value={r.unit} onChange={(e) => update(r.key, { unit: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input name={`items.${i}.unit_price`} type="number" value={r.unit_price} onChange={(e) => update(r.key, { unit_price: Number(e.target.value) })} className="text-right" /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatYen(amountOf(r))}</td>
                  <td className="px-3 py-2"><Input name={`items.${i}.remark`} value={r.remark} onChange={(e) => update(r.key, { remark: e.target.value })} className="text-xs" /></td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => setRows((cur) => cur.filter((x) => x.key !== r.key))} className="rounded p-1 text-muted hover:bg-sand hover:text-warn">
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={sheetMode ? 'border-b border-line bg-[#fafbf9] px-3 py-2' : 'space-y-2'}>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => addRow('installation')} data-testid="add-installation">
            <Plus className="size-4" aria-hidden="true" />
            現地工事を追加
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleScopeChangeMode}
            data-testid="toggle-scope-change"
          >
            {scopeChangeMode ? '通常入力に戻す' : '見積内容を変更'}
          </Button>
          {!scopeChangeMode && (
            <span className="text-[0.65rem] text-muted">
              本体・内外装・オプションは確認表示です。変更が必要な場合だけ「見積内容を変更」を開きます。
            </span>
          )}
        </div>

        {scopeChangeMode && (
          <div
            className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-[#ead6a9] bg-[#fffaf0] p-2"
            data-testid="scope-change-actions"
          >
            <span className="w-full text-[0.65rem] font-semibold text-[#765d1f]">
              商品・仕様変更
            </span>
            {catalog.length > 0 && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpen(true)} data-testid="open-catalog-picker">
                <Plus className="size-4" aria-hidden="true" />
                商品台帳から追加
              </Button>
            )}
            {canEditBase && (
              <Button type="button" variant="secondary" size="sm" onClick={() => addRow('base')} data-testid="add-base">
                <Plus className="size-4" aria-hidden="true" />
                本体の行を追加
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow('interior_exterior')} data-testid="add-interior-exterior">
              <Plus className="size-4" aria-hidden="true" />
              内外装工事を追加
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow('option')} data-testid="add-option">
              <Plus className="size-4" aria-hidden="true" />
              オプションを追加
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => addRow('free')} data-testid="add-free">
              <Plus className="size-4" aria-hidden="true" />
              フリー商品を追加
            </Button>
            {freeProducts.map((f) => (
              <Button
                key={f.code}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addRow('free', { name: f.name, price: f.price })}
                data-testid={`add-free-${f.code}`}
              >
                ＋ {f.name}（{formatYen(f.price)}）
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className={sheetMode ? 'border-b border-line px-3 py-3' : 'space-y-5'}>
        <Field label="お客様への申し送り（任意）" htmlFor="dealer_note" hint="現地条件・工期・注意事項など。見積書の備考に入ります">
          <Textarea
            id="dealer_note"
            name="dealer_note"
            rows={sheetMode ? 3 : 3}
            defaultValue={quote.dealer_note ?? ''}
            onChange={markDirty}
            className={sheetMode ? 'min-h-20 text-xs' : undefined}
          />
        </Field>
        {!sheetMode && (
          <dl className="space-y-1 rounded-lg bg-ivory px-4 py-3 text-sm" data-testid="revision-preview">
            <div className="flex justify-between text-muted"><dt>本体価格計{canEditBase ? '' : '（変更不可）'}</dt><dd>{formatYen(baseTotal)}</dd></div>
            <div className="flex justify-between text-muted"><dt>内外装工事計</dt><dd>{formatYen(interiorExteriorTotal)}</dd></div>
            <div className="flex justify-between text-muted"><dt>オプション価格計</dt><dd>{formatYen(optionTotal)}</dd></div>
            <div className="flex justify-between"><dt>別途工事・フリー商品</dt><dd>{formatYen(entered)}</dd></div>
            <div className="flex justify-between text-muted"><dt>消費税</dt><dd>{formatYen(tax)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>改訂後の見積合計（税込）</dt><dd>{formatYen(subtotal + tax)}</dd></div>
          </dl>
        )}
      </div>
      <div className={sheetMode ? 'flex flex-wrap items-center justify-between gap-2 bg-[#f7f9f8] px-3 py-2' : ''}>
        {sheetMode && (
          <p className="text-[0.67rem] text-muted">
            この内容を第{quote.revision + 1}版として発行します。現在の版は履歴として残ります。
          </p>
        )}
        <SubmitButton pending={pending} label="この内容で改訂見積を発行" />
      </div>

      {pickerOpen && (
        <CatalogPickerDialog
          catalog={catalog}
          kinds={canEditBase ? FULL_KINDS : DEALER_KINDS}
          kindLabels={KIND_LABELS}
          onPick={(item, kind) =>
            addRow(kind, {
              name: item.name,
              price: item.price_on_request ? 0 : item.price,
              description: item.category,
              unit: item.unit ?? '式',
              image_url: item.image_url,
            })
          }
          onClose={() => setPickerOpen(false)}
        />
      )}
    </form>
  );
}

/** 管理者：ユーザーの権限を変更する（顧客一覧の各行） */
export function UserRoleForm({ profile, isSelf }: { profile: Profile; isSelf: boolean }) {
  const [state, action, pending] = useActionState(updateUserRoleAction, initial);
  return (
    <form action={action} className="flex items-center gap-1" noValidate data-testid={`role-form-${profile.id}`}>
      <input type="hidden" name="user_id" value={profile.id} />
      <Select
        name="role_code"
        defaultValue={profile.role_code}
        disabled={isSelf}
        aria-label={`${profile.full_name} さんの権限`}
        className="min-w-[9rem] py-1 text-xs"
        data-testid={`role-select-${profile.email}`}
      >
        {(Object.keys(ROLE_LABELS) as RoleCode[]).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary" size="sm" disabled={pending || isSelf} title={isSelf ? '自分自身の権限は変更できません' : undefined}>
        {pending ? '…' : '変更'}
      </Button>
      {state.error && <span className="text-xs text-warn">{state.error}</span>}
      {state.ok && state.message && <span className="text-xs text-forest">保存しました</span>}
    </form>
  );
}
