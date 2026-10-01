'use client';

import { Fragment, useActionState, useState } from 'react';
import { X } from 'lucide-react';
import { assignQuoteDealerAction, createDealerRevisionAction, updateUserRoleAction } from '@/lib/actions/admin';
import { formatYen } from '@/lib/domain/pricing';
import { ROLE_LABELS, type Profile, type Quote, type QuoteItem, type RoleCode } from '@/lib/domain/types';
import type { RevisionItemKind } from '@/lib/data/store';
import { Button, Field, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';
import type { CatalogPickerItem } from './catalog-picker';
import {
  CustomerQuotePreview,
  QuoteAuthoringGrid,
  QuoteAuthoringTabs,
  QuoteFinancialSummary,
  QuoteInternalRateStrip,
  type QuoteAuthoringRow,
  type QuoteAuthoringSection,
  type QuoteCatalogProduct,
} from './quote-authoring-ui';

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
  kind: RevisionItemKind;
  option_id: string | null;
  name: string;
  description: string;
  unit: string;
  remark: string;
  unit_price: number;
  quantity: number;
  /** 元の明細から引き継ぐ商品画像（見積書下部の画像一覧用） */
  image_url: string | null;
}

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

/**
 * 案件見積の編集。標準見積そのものは変更せず、発行済み案件をコピーした次版を作る。
 * 代理店は本体を閲覧のみ、オプション・別途等を編集可能。
 * 総代理店・本部は本体を含めて編集可能。
 */
export function DealerRevisionForm({
  quote,
  items,
  canEditBase,
  sheetMode = false,
  onCancel,
  products = [],
  baseModelId = '',
  specCode = '',
}: {
  quote: Quote;
  items: QuoteItem[];
  /** 旧caller互換。共通QuoteAuthoringGridでは商品台帳productsを利用する。 */
  freeProducts?: { code: string; name: string; price: number }[];
  /** 旧caller互換。専用改訂画面ではproductsを利用する。 */
  catalog?: CatalogPickerItem[];
  canEditBase: boolean;
  sheetMode?: boolean;
  onCancel?: () => void;
  products?: QuoteCatalogProduct[];
  baseModelId?: string;
  specCode?: string;
}) {
  const [state, action, pending] = useActionState(createDealerRevisionAction, initial);
  const editable = (kind: QuoteItem['kind']): kind is RevisionItemKind =>
    (canEditBase ? FULL_KINDS : DEALER_KINDS).includes(kind as RevisionItemKind);

  const lockedItems = items.filter((item) => !editable(item.kind));
  const buildInitialRows = () =>
    items
      .filter((item) => editable(item.kind))
      .map((item, index): Row => ({
        key: `${item.id}-${index}`,
        kind: item.kind as RevisionItemKind,
        option_id: item.option_id ?? null,
        name: item.name,
        description: item.description ?? '',
        unit: item.unit ?? '式',
        remark: item.remark ?? '',
        unit_price: item.unit_price,
        quantity: item.quantity,
        image_url: item.image_url ?? null,
      }));

  const [rows, setRows] = useState<Row[]>(buildInitialRows);
  const [isDirty, setIsDirty] = useState(false);
  const [scopeChangeMode, setScopeChangeMode] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const amountOf = (row: Row) => Math.round(row.unit_price * Math.max(0.01, row.quantity || 0));
  const sumOf = (...kinds: RevisionItemKind[]) =>
    rows.filter((row) => kinds.includes(row.kind)).reduce((sum, row) => sum + amountOf(row), 0);

  // 保存・金額契約は既存createDealerRevisionActionのまま。ここでは表示用合計だけを算出する。
  const baseTotal = canEditBase ? sumOf('base', 'base_expense') : quote.base_price + quote.base_expense;
  const interiorExteriorTotal = sumOf('interior_exterior', 'interior_exterior_expense');
  const optionTotal = sumOf('option', 'option_expense');
  const siteworkTotal = sumOf('installation');
  const freeTotal = sumOf('free');
  const subRaw = baseTotal + interiorExteriorTotal + optionTotal + siteworkTotal + freeTotal;
  const subtotal = Math.floor(subRaw / 1000) * 1000;
  const adjustment = subtotal - subRaw;
  const tax = Math.floor(subtotal * quote.tax_rate);
  const editingTotal = subtotal + tax;
  const revisionDifference = editingTotal - quote.total;

  const rowCanEdit = (row: Row) => row.kind === 'installation' || scopeChangeMode;
  const authoringRows: QuoteAuthoringRow[] = [
    ...lockedItems.map((item) => ({
      key: item.id,
      kind: item.kind,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit ?? '',
      unitPrice: item.unit_price,
      amount: item.amount,
      remark: item.remark ?? '',
      optionId: item.option_id ?? null,
      locked: true,
    })),
    ...rows.map((row) => ({
      key: row.key,
      kind: row.kind,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      unitPrice: row.unit_price,
      amount: amountOf(row),
      remark: row.remark,
      optionId: row.option_id,
      locked: !rowCanEdit(row),
    })),
  ];

  const editableSections: QuoteAuthoringSection[] = scopeChangeMode
    ? canEditBase
      ? ['base', 'interior_exterior', 'option', 'installation']
      : ['interior_exterior', 'option', 'installation']
    : ['installation'];

  const markDirty = () => setIsDirty(true);

  const updateAuthoringRow = (
    key: string,
    patch: Partial<Pick<QuoteAuthoringRow, 'name' | 'quantity' | 'unit' | 'unitPrice' | 'remark'>>
  ) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key || !rowCanEdit(row)) return row;
        return {
          ...row,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit ?? '' } : {}),
          ...(patch.unitPrice !== undefined ? { unit_price: patch.unitPrice } : {}),
          ...(patch.remark !== undefined ? { remark: patch.remark ?? '' } : {}),
        };
      })
    );
    markDirty();
  };

  const kindForSection = (section: QuoteAuthoringSection): RevisionItemKind => {
    if (section === 'base') return 'base';
    if (section === 'interior_exterior') return 'interior_exterior';
    if (section === 'option') return 'option';
    return 'installation';
  };

  const addAuthoringRow = (section: QuoteAuthoringSection) => {
    if (!editableSections.includes(section)) return;
    const kind = kindForSection(section);
    setRows((current) => [
      ...current,
      {
        key: `new-${crypto.randomUUID()}`,
        kind,
        option_id: null,
        name: '',
        description: '',
        unit: '式',
        remark: '',
        unit_price: 0,
        quantity: 1,
        image_url: null,
      },
    ]);
    markDirty();
  };

  const selectCatalogProduct = (
    section: QuoteAuthoringSection,
    targetKey: string | null,
    product: QuoteCatalogProduct
  ) => {
    if (!editableSections.includes(section)) return;
    const productRemark = product.priceOnRequest
      ? '別途見積'
      : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ ');
    const patch = {
      option_id: product.id,
      name: product.name,
      description: product.categoryName,
      unit_price: product.priceOnRequest ? 0 : product.price,
      remark: productRemark,
      image_url: product.imageUrl,
    };

    setRows((current) => {
      const duplicate = current.some((row) => row.option_id === product.id && row.key !== targetKey);
      if (duplicate) return current;
      if (targetKey) {
        return current.map((row) => (row.key === targetKey && rowCanEdit(row) ? { ...row, ...patch } : row));
      }
      return [
        ...current,
        {
          key: `product-${crypto.randomUUID()}`,
          kind: kindForSection(section),
          unit: '式',
          quantity: 1,
          ...patch,
        },
      ];
    });
    markDirty();
  };

  const removeAuthoringRow = (key: string) => {
    const target = rows.find((row) => row.key === key);
    if (!target || !rowCanEdit(target)) return;
    setRows((current) => current.filter((row) => row.key !== key));
    markDirty();
  };

  const resetRows = () => {
    setRows(buildInitialRows());
    setScopeChangeMode(false);
    setIsDirty(false);
  };

  return (
    <form
      id="quote-editor"
      action={action}
      className={
        sheetMode
          ? 'scroll-mt-6 overflow-hidden rounded-lg border border-line bg-white shadow-sm'
          : 'card scroll-mt-6 space-y-3 p-6'
      }
      noValidate
      data-testid="dealer-revision-form"
      data-sheet-mode={sheetMode ? 'true' : undefined}
    >
      <input type="hidden" name="quote_id" value={quote.id} />
      {rows.map((row, index) => (
        <Fragment key={`revision-submit-${row.key}`}>
          <input type="hidden" name={`items.${index}.kind`} value={row.kind} />
          <input type="hidden" name={`items.${index}.name`} value={row.name} />
          <input type="hidden" name={`items.${index}.description`} value={row.description} />
          <input type="hidden" name={`items.${index}.unit`} value={row.unit} />
          <input type="hidden" name={`items.${index}.remark`} value={row.remark} />
          <input type="hidden" name={`items.${index}.unit_price`} value={row.unit_price} />
          <input type="hidden" name={`items.${index}.quantity`} value={row.quantity} />
          <input type="hidden" name={`items.${index}.image_url`} value={row.image_url ?? ''} />
        </Fragment>
      ))}

      <div className={sheetMode ? 'flex flex-wrap items-center justify-between gap-2 border-b border-line bg-[#fafbf9] px-3 py-2' : ''}>
        <div>
          <p className={sheetMode ? 'text-xs font-semibold text-[#315745]' : 'font-semibold'}>
            {sheetMode ? `第${quote.revision + 1}版 見積編集` : '案件見積の編集'}
          </p>
          <p className={sheetMode ? 'mt-0.5 text-[0.65rem] text-muted' : 'mt-1 text-xs text-muted'}>
            発行済みの見積は変更せず、次の版として編集します。現地確認後に決まる施工金額もここで反映します。
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

      <QuoteAuthoringTabs />
      <QuoteInternalRateStrip showPlannedDefaults />

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-white/95 px-3 py-2"
        data-testid="revision-sticky-summary"
      >
        <span
          className={
            isDirty
              ? 'rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[0.65rem] font-semibold text-amber-800'
              : 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[0.65rem] font-semibold text-emerald-800'
          }
        >
          {isDirty ? '未発行の変更あり' : '編集前と同じ'}
        </span>
        <span className="text-[0.68rem] text-muted">
          前版 <strong className="ml-1 text-xs text-ink">{formatYen(quote.total)}</strong>
        </span>
        <span className="text-[0.68rem] text-muted">
          編集中 <strong className="ml-1 text-sm text-ink">{formatYen(editingTotal)}</strong>
        </span>
        <span className="text-[0.68rem] text-muted">
          差額 <strong className="ml-1 text-xs text-ink">{revisionDifference > 0 ? '+' : ''}{formatYen(revisionDifference)}</strong>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setScopeChangeMode((current) => !current)}
          data-testid="toggle-scope-change"
        >
          {scopeChangeMode ? '通常入力に戻す' : '見積内容を変更'}
        </Button>
        <button
          type="button"
          className="ml-auto rounded border border-line bg-white px-2 py-1 text-[0.65rem] font-semibold text-ink-soft disabled:opacity-40"
          onClick={resetRows}
          disabled={!isDirty}
        >
          明細を編集前に戻す
        </button>
      </div>

      {!scopeChangeMode && (
        <div className="border-b border-line bg-[#f7faf8] px-3 py-1.5 text-[10px] text-muted">
          通常は現地工事の明細だけ編集できます。本体・内外装・オプションを変更する場合は「見積内容を変更」を選択してください。
        </div>
      )}

      {!baseModelId || !specCode ? (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[10px] text-amber-900">
          この見積には商品モデル・仕様の識別情報が保存されていないため、商品台帳からの選択は利用できません。自由明細の編集は可能です。
        </div>
      ) : null}

      <QuoteAuthoringGrid
        rows={authoringRows}
        products={products}
        baseModelId={baseModelId}
        specCode={specCode}
        editableSections={editableSections}
        onUpdate={updateAuthoringRow}
        onRemove={removeAuthoringRow}
        onAddFree={addAuthoringRow}
        onSelectProduct={selectCatalogProduct}
      />

      <div className="grid gap-2 border-t border-line bg-[#fafbf9] px-3 py-3 lg:grid-cols-[1fr_36rem]">
        <Field label="お客様への申し送り（任意）" htmlFor="dealer_note" hint="現地条件・工期・注意事項など。見積書の備考に入ります">
          <Textarea
            id="dealer_note"
            name="dealer_note"
            rows={3}
            defaultValue={quote.dealer_note ?? ''}
            onChange={markDirty}
            className="min-h-20 text-xs"
          />
        </Field>
        <QuoteFinancialSummary
          subtotalRaw={subRaw}
          adjustment={adjustment}
          adjustmentReason="千円未満切捨て"
          tax={tax}
          total={editingTotal}
          onAdjustment={() => undefined}
          onAdjustmentReason={() => undefined}
          showAdjustmentControls={false}
        />
      </div>

      {showPreview && (
        <div className="border-t border-line bg-white px-3 py-3">
          <CustomerQuotePreview
            caseName={quote.customer_company || quote.customer_name}
            customerName={quote.customer_name}
            companyName={quote.customer_company || ''}
            address=""
            phone=""
            rows={authoringRows}
            subtotal={subRaw}
            adjustment={adjustment}
            tax={tax}
            total={editingTotal}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#f7f9f8] px-3 py-2">
        <div>
          <p className="text-[0.67rem] text-muted">
            発行すると第{quote.revision + 1}版になり、現在の第{quote.revision}版は履歴として残ります。
          </p>
          <p className="mt-0.5 text-[0.62rem] text-muted">
            この既存Web案件の改訂は、途中の下書き保存には現在対応していません。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setShowPreview((current) => !current)}>
            {showPreview ? 'プレビューを閉じる' : 'プレビュー'}
          </Button>
          <SubmitButton pending={pending} label={`この内容で第${quote.revision + 1}版を発行`} />
        </div>
      </div>
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
