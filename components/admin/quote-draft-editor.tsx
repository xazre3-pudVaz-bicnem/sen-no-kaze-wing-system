'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  finalizeQuoteDraftAction,
  saveQuoteDraftAction,
  type QuoteDraftFormState,
} from '@/lib/actions/admin';
import type { QuoteDraftDetail, QuoteDraftSaveItem } from '@/lib/data/store';
import type { QuoteItemKind } from '@/lib/domain/types';
import { Button, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';
import {
  CustomerQuotePreview,
  QuoteAuthoringGrid,
  QuoteAuthoringTabs,
  QuoteEditorTopbar,
  QuoteFinancialSummary,
  QuoteInternalRateStrip,
  isValidQuoteQuantity,
  quoteQuantityRule,
  type QuoteAuthoringRow,
  type QuoteAuthoringSection,
  type QuoteCatalogProduct,
  type QuotePickerRow,
} from '@/components/admin/quote-authoring-ui';

const initialState: QuoteDraftFormState = { ok: false };

const roundLikePostgres = (value: number) => value < 0 ? -Math.round(-value) : Math.round(value);

const KINDS = ([
  'base',
  'base_expense',
  'interior_exterior',
  'interior_exterior_expense',
  'option',
  'option_expense',
  'installation',
  'free',
  'discount',
] as QuoteItemKind[]).filter((kind) => kind !== 'discount');

type EditorRow = QuoteDraftSaveItem & { key: string };

function kindForSection(section: QuoteAuthoringSection): QuoteItemKind {
  if (section === 'base') return 'base';
  if (section === 'interior_exterior') return 'interior_exterior';
  if (section === 'option') return 'option';
  return 'installation';
}

function newRow(kind: QuoteItemKind = 'installation'): EditorRow {
  return {
    key: crypto.randomUUID(),
    line_key: crypto.randomUUID(),
    kind,
    option_id: null,
    name: '',
    description: null,
    unit: '式',
    remark: null,
    unit_price: 0,
    quantity: 1,
    image_url: null,
  };
}

export function QuoteDraftEditor({
  detail,
  modelName,
  canEditBase,
  estimates = [],
  products = [],
  targetRevision = 1,
}: {
  detail: QuoteDraftDetail;
  modelName: string;
  canEditBase: boolean;
  estimates?: QuotePickerRow[];
  products?: QuoteCatalogProduct[];
  targetRevision?: number;
}) {
  const [saveState, saveAction, savePending] = useActionState(saveQuoteDraftAction, initialState);
  const [finalizeState, finalizeAction, finalizePending] = useActionState(finalizeQuoteDraftAction, initialState);
  const [rows, setRows] = useState<EditorRow[]>(() =>
    detail.items.map((item) => ({
      key: item.id,
      line_key: item.line_key,
      kind: item.kind,
      option_id: item.option_id,
      name: item.name,
      description: item.description,
      unit: item.unit,
      remark: item.remark,
      unit_price: item.unit_price,
      quantity: item.quantity,
      image_url: item.image_url,
    }))
  );
  const [baseRevisionId, setBaseRevisionId] = useState(detail.draft.base_master_revision_id ?? '');
  const [adjustment, setAdjustment] = useState(detail.draft.adjustment);
  const [adjustmentReason, setAdjustmentReason] = useState(detail.draft.adjustment_reason ?? '');
  const [dealerNote, setDealerNote] = useState(detail.draft.dealer_note ?? '');
  const [notes, setNotes] = useState(detail.draft.notes ?? '');
  const [showPreview, setShowPreview] = useState(false);

  const isRevisionDraft = detail.draft.parent_quote_id !== null;
  const baseLocked = isRevisionDraft && !canEditBase;
  const formalRevisionLabel = `第${targetRevision}版`;
  const lockVersion = saveState.savedVersion ?? detail.draft.lock_version;
  const [editGeneration, setEditGeneration] = useState(0);
  const [savedGeneration, setSavedGeneration] = useState(0);
  const submittedGeneration = useRef<number | null>(null);
  const dirty = editGeneration !== savedGeneration;

  useEffect(() => {
    if (saveState.savedVersion == null || submittedGeneration.current == null) return;
    if (editGeneration === submittedGeneration.current) {
      setSavedGeneration(editGeneration);
    }
  }, [saveState.savedVersion, editGeneration]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const amountForRow = (row: EditorRow) => {
    const source = detail.items.find((item) => item.line_key === row.line_key);
    if (source && source.unit_price === row.unit_price && source.quantity === row.quantity) {
      return source.amount;
    }
    return roundLikePostgres(row.unit_price * row.quantity);
  };

  const subtotalRaw = rows.reduce((sum, row) => sum + amountForRow(row), 0);
  const subtotal = Math.max(0, subtotalRaw + adjustment);
  const tax = Math.floor(subtotal * detail.draft.tax_rate);
  const totals = { subtotalRaw, subtotal, tax, total: subtotal + tax };

  const markDirty = () => setEditGeneration((current) => current + 1);
  const confirmLeave = () =>
    !dirty ||
    window.confirm('保存していない内容があります。保存せずに別の見積書へ移動しますか？');

  const itemsJson = JSON.stringify(
    rows.map(({ key: _key, ...row }) => ({
      ...row,
      description: row.description || null,
      unit: row.unit || null,
      remark: row.remark || null,
      image_url: row.image_url || null,
      option_id: row.option_id || null,
    }))
  );

  const authoringRows: QuoteAuthoringRow[] = rows.map((row) => {
    const rowBaseLocked = baseLocked && (row.kind === 'base' || row.kind === 'base_expense');
    return {
      key: row.key,
      kind: row.kind,
      name: row.name,
      quantity: row.quantity,
      unit: row.unit ?? '',
      unitPrice: row.unit_price,
      amount: amountForRow(row),
      remark: row.remark ?? '',
      optionId: row.option_id ?? null,
      locked: rowBaseLocked,
    };
  });

  const revisionEditableKinds: QuoteItemKind[] = baseLocked
    ? KINDS.filter((kind) => kind !== 'base' && kind !== 'base_expense')
    : KINDS;

  const updateAuthoringRow = (
    key: string,
    patch: Partial<Pick<QuoteAuthoringRow, 'name' | 'quantity' | 'unit' | 'unitPrice' | 'remark'>>
  ) => {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;

        let nextUnit = row.unit ?? '';
        let nextQuantity = row.quantity;

        if (patch.unit !== undefined) {
          nextUnit = patch.unit ?? '';
          if (quoteQuantityRule(nextUnit) === 'fixed-one') nextQuantity = 1;
          else if (!isValidQuoteQuantity(nextQuantity, nextUnit)) return row;
        }
        if (patch.quantity !== undefined) {
          if (!isValidQuoteQuantity(patch.quantity, nextUnit)) return row;
          nextQuantity = patch.quantity;
        }

        return {
          ...row,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.quantity !== undefined || patch.unit !== undefined ? { quantity: nextQuantity } : {}),
          ...(patch.unit !== undefined ? { unit: nextUnit } : {}),
          ...(patch.unitPrice !== undefined ? { unit_price: patch.unitPrice } : {}),
          ...(patch.remark !== undefined ? { remark: patch.remark } : {}),
        };
      })
    );
    markDirty();
  };

  const addAuthoringRow = (section: QuoteAuthoringSection) => {
    const kind = kindForSection(section);
    if (!revisionEditableKinds.includes(kind)) return;
    setRows((current) => [...current, newRow(kind)]);
    markDirty();
  };

  const selectCatalogProduct = (
    section: QuoteAuthoringSection,
    targetKey: string | null,
    product: QuoteCatalogProduct
  ) => {
    const kind = kindForSection(section);
    if (!revisionEditableKinds.includes(kind)) return;

    const productRemark = product.priceOnRequest
      ? '別途見積'
      : [product.manufacturer, product.modelNo].filter(Boolean).join(' ／ ');
    const productPatch = {
      option_id: product.id,
      name: product.name,
      unit_price: product.priceOnRequest ? 0 : product.price,
      remark: productRemark,
      image_url: product.imageUrl,
    };

    setRows((current) => {
      const duplicate = current.some((row) => row.option_id === product.id && row.key !== targetKey);
      if (duplicate) return current;
      if (targetKey) {
        return current.map((row) => (row.key === targetKey ? { ...row, ...productPatch } : row));
      }
      return [
        ...current,
        {
          ...newRow(kind),
          ...productPatch,
        },
      ];
    });
    markDirty();
  };

  const removeAuthoringRow = (key: string) => {
    const target = rows.find((row) => row.key === key);
    if (target && baseLocked && (target.kind === 'base' || target.kind === 'base_expense')) return;
    setRows((current) => current.filter((row) => row.key !== key));
    markDirty();
  };

  const customer = detail.request.contact;
  const selectedRevision = detail.baseRevisions.find((revision) => revision.id === baseRevisionId);
  const fireSpecLabel = selectedRevision
    ? (selectedRevision.fire_spec_code === 'fire' ? '防火' : '非防火')
    : '未設定';

  return (
    <div className="space-y-2" data-testid="quote-draft-editor">
      <QuoteEditorTopbar mode="edit" estimates={estimates} confirmLeave={confirmLeave} />

      <form
        action={saveAction}
        onSubmit={() => {
          submittedGeneration.current = editGeneration;
        }}
        className="space-y-2"
        noValidate
      >
        <input type="hidden" name="draft_id" value={detail.draft.id} />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <input type="hidden" name="items_json" value={itemsJson} />
        <input type="hidden" name="adjustment" value={adjustment} />
        <input type="hidden" name="adjustment_reason" value={adjustmentReason} />

        <Status state={saveState} />

        <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm" data-testid="quote-draft-editor-shell">
          <section className="border-b border-slate-200 bg-white" data-testid="case-info-panel">
            <div className="grid gap-x-3 gap-y-1 px-3 py-2 text-[11px] sm:grid-cols-2 lg:grid-cols-5">
              <div><span className="text-muted">案件名</span><strong className="ml-1">{detail.request.case_name || customer.full_name}</strong></div>
              <div><span className="text-muted">お客様名</span><strong className="ml-1">{customer.full_name}</strong></div>
              <div><span className="text-muted">会社名</span><strong className="ml-1">{customer.company_name || '未設定'}</strong></div>
              <div><span className="text-muted">設置予定地</span><strong className="ml-1">{customer.site_address || '未設定'}</strong></div>
              <div><span className="text-muted">商品モデル</span><strong className="ml-1">{modelName}</strong></div>
              <div><span className="text-muted">仕様</span><strong className="ml-1">{detail.draft.spec_code}</strong></div>
              <div><span className="text-muted">防火仕様</span><strong className="ml-1">{fireSpecLabel}</strong></div>
              <div><span className="text-muted">適用地域</span><strong className="ml-1">未設定</strong></div>
              <div><span className="text-muted">状態</span><strong className="ml-1">下書き（正式見積ではありません）</strong></div>
            </div>
            <div className="border-t border-slate-100 px-3 py-1.5">
              <label className="grid gap-1 sm:grid-cols-[5rem_1fr] sm:items-center">
                <span className="text-[10px] font-semibold text-muted">メモ</span>
                <Textarea
                  name="notes"
                  value={notes}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    markDirty();
                  }}
                  rows={1}
                  className="min-h-7 resize-y py-1 text-sm"
                />
              </label>
            </div>
          </section>

          <QuoteAuthoringTabs />
          <QuoteInternalRateStrip showPlannedDefaults />

          <section className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-white px-3 py-1.5">
            <div className="min-w-[18rem] max-w-xl flex-1">
              <label className="text-[10px] font-semibold text-muted" htmlFor="draft-base-revision">
                使用する基準本体
              </label>
              {baseLocked && <input type="hidden" name="base_master_revision_id" value={baseRevisionId} />}
              <Select
                id="draft-base-revision"
                name={baseLocked ? undefined : 'base_master_revision_id'}
                value={baseRevisionId}
                disabled={baseLocked}
                onChange={(event) => {
                  setBaseRevisionId(event.target.value);
                  markDirty();
                }}
                className="h-7 min-h-7 text-xs"
              >
                <option value="">選択してください</option>
                {detail.baseRevisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.master_name} ／ {revision.fire_spec_code === 'fire' ? '防火' : '非防火'} ／ v{revision.version}
                  </option>
                ))}
              </Select>
            </div>
            <p className="pb-1 text-[10px] text-muted">
              選択した基準本体は正式保存時に使用されます。
            </p>
          </section>

          <QuoteAuthoringGrid
            rows={authoringRows}
            products={products}
            baseModelId={detail.draft.base_model_id}
            specCode={detail.draft.spec_code}
            onUpdate={updateAuthoringRow}
            onRemove={removeAuthoringRow}
            onAddFree={addAuthoringRow}
            onSelectProduct={selectCatalogProduct}
          />
        </div>

        <div className="grid gap-2 lg:grid-cols-[1fr_36rem]">
          <section className="rounded-lg border border-line bg-white p-3 shadow-sm">
            <label className="block">
              <span className="text-[10px] font-semibold text-muted">担当者申し送り</span>
              <Textarea
                name="dealer_note"
                value={dealerNote}
                onChange={(event) => {
                  setDealerNote(event.target.value);
                  markDirty();
                }}
                rows={2}
                className="mt-1"
              />
            </label>
          </section>

          <QuoteFinancialSummary
            subtotalRaw={totals.subtotalRaw}
            adjustment={adjustment}
            adjustmentReason={adjustmentReason}
            tax={totals.tax}
            total={totals.total}
            onAdjustment={(value) => {
              setAdjustment(value);
              markDirty();
            }}
            onAdjustmentReason={(value) => {
              setAdjustmentReason(value);
              markDirty();
            }}
          />
        </div>

        {showPreview && (
          <CustomerQuotePreview
            caseName={detail.request.case_name || customer.full_name}
            customerName={customer.full_name}
            companyName={customer.company_name || ''}
            address={customer.address}
            phone={customer.phone}
            rows={authoringRows}
            subtotal={totals.subtotalRaw}
            adjustment={adjustment}
            tax={totals.tax}
            total={totals.total}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 shadow-sm">
          <div>
            <p className="text-sm font-semibold">{dirty ? '未保存の変更があります' : 'Draftは保存済みです'}</p>
            <p className="mt-0.5 text-[10px] text-muted">下書き保存時に数量×単価・税額・合計を確認します。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setShowPreview((current) => !current)}>
              {showPreview ? 'プレビューを閉じる' : 'プレビュー'}
            </Button>
            <SubmitButton pending={savePending} label="下書き保存" />
          </div>
        </div>
      </form>

      <form
        action={finalizeAction}
        onSubmit={(event) => {
          if (dirty) {
            event.preventDefault();
            window.alert('未保存の変更があります。先にDraftを保存してください。');
            return;
          }
          if (!window.confirm(`この内容を正式な${formalRevisionLabel}として発行しますか？発行後、この下書きは編集できません。`)) {
            event.preventDefault();
          }
        }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d3e0d8] bg-[#f5faf7] px-3 py-2"
      >
        <input type="hidden" name="draft_id" value={detail.draft.id} />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <Status state={finalizeState} />
        <div>
          <p className="text-sm font-semibold">正式見積を発行</p>
          <p className="mt-0.5 text-[10px] text-muted">発行すると、この下書きは編集できなくなり、発行済み見積として履歴に残ります。</p>
        </div>
        <Button
          type="submit"
          disabled={finalizePending || savePending || dirty || rows.length === 0 || !baseRevisionId}
        >
          {finalizePending ? '発行中…' : `この内容で第${targetRevision}版を発行`}
        </Button>
      </form>
    </div>
  );
}
