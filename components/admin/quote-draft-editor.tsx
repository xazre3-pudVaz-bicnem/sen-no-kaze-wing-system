'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  finalizeQuoteDraftAction,
  saveQuoteDraftAction,
  type QuoteDraftFormState,
} from '@/lib/actions/admin';
import type { QuoteDraftDetail, QuoteDraftSaveItem } from '@/lib/data/store';
import type { QuoteItemKind } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initialState: QuoteDraftFormState = { ok: false };

const KIND_LABELS: Record<QuoteItemKind, string> = {
  base: '本体',
  base_expense: '本体諸費用',
  interior_exterior: '内外装工事',
  interior_exterior_expense: '内外装工事経費',
  option: 'オプション',
  option_expense: 'オプション諸費用',
  installation: '別途工事',
  free: 'フリー商品',
  discount: '値引き',
};

const KINDS = (Object.keys(KIND_LABELS) as QuoteItemKind[]).filter((kind) => kind !== 'discount');
const roundLikePostgres = (value: number) => value < 0 ? -Math.round(-value) : Math.round(value);

type EditorRow = QuoteDraftSaveItem & { key: string };

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
}: {
  detail: QuoteDraftDetail;
  modelName: string;
  canEditBase: boolean;
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

  const isRevisionDraft = detail.draft.parent_quote_id !== null;
  const baseLocked = isRevisionDraft && !canEditBase;
  const formalRevisionLabel = isRevisionDraft ? '次のRevision' : 'Revision 1';
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

  const updateRow = (key: string, patch: Partial<EditorRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    markDirty();
  };

  const addRow = () => {
    setRows((current) => [...current, newRow()]);
    markDirty();
  };

  const removeRow = (key: string) => {
    setRows((current) => current.filter((row) => row.key !== key));
    markDirty();
  };

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

  const customer = detail.request.contact;

  return (
    <div className="space-y-4" data-testid="quote-draft-editor">
      <section className="rounded-lg border border-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted">案件情報・編集中Draft</p>
            <h1 className="mt-1 text-xl font-semibold">{detail.request.case_name || `${customer.full_name} 様`}</h1>
            <p className="mt-1 text-sm text-muted">
              お客様 {customer.full_name} 様 ／ {modelName} ／ {detail.draft.spec_code} ／ {isRevisionDraft ? '既存Revisionから編集中' : 'Revision未発行'}
            </p>
          </div>
          <div className="rounded-lg bg-[#eef4f1] px-3 py-2 text-xs font-semibold text-[#315745]">
            lock_version {lockVersion}
          </div>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted">会社名</dt>
            <dd className="mt-0.5 font-semibold">{customer.company_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">設置予定地</dt>
            <dd className="mt-0.5 font-semibold">{customer.site_address || '未登録'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">注文範囲</dt>
            <dd className="mt-0.5 font-semibold">{detail.draft.finish_level}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">見積状態</dt>
            <dd className="mt-0.5 font-semibold">Draft（正式Revisionではありません）</dd>
          </div>
        </dl>
      </section>

      <form
        action={saveAction}
        onSubmit={() => {
          submittedGeneration.current = editGeneration;
        }}
        className="space-y-4"
        noValidate
      >
        <input type="hidden" name="draft_id" value={detail.draft.id} />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <input type="hidden" name="items_json" value={itemsJson} />

        <Status state={saveState} />

        <section className="rounded-lg border border-line bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold">見積Draft</h2>
              <p className="mt-1 text-xs text-muted">
                保存してもRevision番号は増えません。正式保存した時だけ{formalRevisionLabel}を作成します。
              </p>
            </div>
            <div className="min-w-[18rem]">
              <label className="text-xs font-semibold text-muted" htmlFor="draft-base-revision">
                基準本体Revision
              </label>
              {baseLocked && (
                <input type="hidden" name="base_master_revision_id" value={baseRevisionId} />
              )}
              <Select
                id="draft-base-revision"
                name={baseLocked ? undefined : 'base_master_revision_id'}
                value={baseRevisionId}
                disabled={baseLocked}
                onChange={(event) => {
                  setBaseRevisionId(event.target.value);
                  markDirty();
                }}
              >
                <option value="">選択してください</option>
                {detail.baseRevisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.master_name} ／ {revision.fire_spec_code === 'fire' ? '防火' : '非防火'} ／ v{revision.version}
                  </option>
                ))}
              </Select>
              {baseLocked && (
                <p className="mt-1 text-[0.7rem] text-muted">
                  代理店は改訂時の本体Revisionを変更できません。
                </p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[72rem] w-full border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="w-12 border-b border-r border-slate-300 px-2 py-2 text-center">#</th>
                  <th className="w-40 border-b border-r border-slate-300 px-2 py-2 text-left">区分</th>
                  <th className="min-w-64 border-b border-r border-slate-300 px-2 py-2 text-left">品名</th>
                  <th className="w-24 border-b border-r border-slate-300 px-2 py-2 text-right">数量</th>
                  <th className="w-20 border-b border-r border-slate-300 px-2 py-2 text-left">単位</th>
                  <th className="w-32 border-b border-r border-slate-300 px-2 py-2 text-right">単価</th>
                  <th className="w-32 border-b border-r border-slate-300 px-2 py-2 text-right">金額</th>
                  <th className="min-w-56 border-b border-r border-slate-300 px-2 py-2 text-left">備考</th>
                  <th className="w-14 border-b border-slate-300 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const amount = amountForRow(row);
                  const rowBaseLocked = baseLocked && (row.kind === 'base' || row.kind === 'base_expense');
                  const selectableKinds = baseLocked && !rowBaseLocked
                    ? KINDS.filter((kind) => kind !== 'base' && kind !== 'base_expense')
                    : KINDS;
                  return (
                    <tr key={row.key} className="border-b border-slate-200">
                      <td className="border-r border-slate-200 px-2 py-1 text-center text-muted">{index + 1}</td>
                      <td className="border-r border-slate-200 p-1">
                        <Select
                          value={row.kind}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { kind: event.target.value as QuoteItemKind })}
                          className="h-8 text-xs"
                          aria-label={`区分 ${index + 1}`}
                        >
                          {selectableKinds.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
                        </Select>
                      </td>
                      <td className="border-r border-slate-200 p-1">
                        <Input
                          value={row.name}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { name: event.target.value })}
                          className="h-8 text-xs"
                          aria-label={`品名 ${index + 1}`}
                        />
                      </td>
                      <td className="border-r border-slate-200 p-1">
                        <Input
                          type="number"
                          min="0.01"
                          max="99999"
                          step="0.0001"
                          value={row.quantity}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { quantity: Number(event.target.value) || 0 })}
                          className="h-8 text-right text-xs"
                          aria-label={`数量 ${index + 1}`}
                        />
                      </td>
                      <td className="border-r border-slate-200 p-1">
                        <Input
                          value={row.unit ?? ''}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { unit: event.target.value })}
                          className="h-8 text-xs"
                          aria-label={`単位 ${index + 1}`}
                        />
                      </td>
                      <td className="border-r border-slate-200 p-1">
                        <Input
                          type="number"
                          step="1"
                          value={row.unit_price}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { unit_price: Number(event.target.value) || 0 })}
                          className="h-8 text-right text-xs"
                          aria-label={`単価 ${index + 1}`}
                        />
                      </td>
                      <td className="border-r border-slate-200 bg-slate-50 px-2 py-1 text-right font-semibold tabular-nums">
                        {formatYen(amount)}
                      </td>
                      <td className="border-r border-slate-200 p-1">
                        <Input
                          value={row.remark ?? ''}
                          disabled={rowBaseLocked}
                          onChange={(event) => updateRow(row.key, { remark: event.target.value })}
                          className="h-8 text-xs"
                          aria-label={`備考 ${index + 1}`}
                        />
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          disabled={rowBaseLocked}
                          onClick={() => removeRow(row.key)}
                          className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-30"
                          aria-label={`${index + 1}行目を削除`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted">
                      空のDraftです。「明細を追加」から見積内容を入力してください。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <Button type="button" variant="secondary" size="sm" onClick={addRow}>
              <Plus className="mr-1 size-4" />
              明細を追加
            </Button>
            <p className="text-xs text-muted">
              画面の金額は確認用です。保存時にDBが数量×単価・税額・合計を再計算します。
            </p>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-line bg-white p-4 shadow-sm lg:grid-cols-[1fr_22rem]">
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-muted">案件メモ</span>
              <Textarea
                name="notes"
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  markDirty();
                }}
                rows={3}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-muted">担当者申し送り</span>
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
          </div>

          <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex justify-between gap-3"><span>明細合計</span><strong>{formatYen(totals.subtotalRaw)}</strong></div>
            <label className="flex items-center justify-between gap-3">
              <span>調整額</span>
              <Input
                type="number"
                name="adjustment"
                step="1"
                value={adjustment}
                onChange={(event) => {
                  setAdjustment(Number(event.target.value) || 0);
                  markDirty();
                }}
                className="h-8 w-32 text-right"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">調整理由</span>
              <Input
                name="adjustment_reason"
                value={adjustmentReason}
                onChange={(event) => {
                  setAdjustmentReason(event.target.value);
                  markDirty();
                }}
                placeholder={adjustment === 0 ? '調整なし' : '必須'}
                className="mt-1 h-8"
              />
            </label>
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2"><span>税抜</span><strong>{formatYen(totals.subtotal)}</strong></div>
            <div className="flex justify-between gap-3"><span>消費税</span><strong>{formatYen(totals.tax)}</strong></div>
            <div className="flex justify-between gap-3 border-t-2 border-slate-500 pt-2 text-base"><span>税込合計</span><strong>{formatYen(totals.total)}</strong></div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 shadow-sm">
          <div>
            <p className="text-sm font-semibold">{dirty ? '未保存の変更があります' : 'Draftは保存済みです'}</p>
            <p className="mt-1 text-xs text-muted">
              先にDraftを保存し、内容確認後に正式保存してください。
            </p>
          </div>
          <SubmitButton pending={savePending} label="Draftを保存" />
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
          if (!window.confirm(`この内容を正式な${formalRevisionLabel}として保存しますか？保存後、このDraftは編集できません。`)) {
            event.preventDefault();
          }
        }}
        className="rounded-lg border border-[#d3e0d8] bg-[#f5faf7] p-4"
      >
        <input type="hidden" name="draft_id" value={detail.draft.id} />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <Status state={finalizeState} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">正式保存</h2>
            <p className="mt-1 text-xs text-muted">
              {isRevisionDraft
                ? '親Revisionをsupersededにし、次のformal Revisionへcurrent pointerを原子的に切り替えます。'
                : 'Revision 1をformalとして作成します。parent_quote_idはNULLで、発行後のsnapshot属性・金額はDB側で保護されます。'}
            </p>
          </div>
          <Button
            type="submit"
            disabled={finalizePending || savePending || dirty || rows.length === 0 || !baseRevisionId}
          >
            {finalizePending
              ? '正式保存中…'
              : isRevisionDraft
                ? '正式保存（次のRevision）'
                : '正式保存（Revision 1）'}
          </Button>
        </div>
      </form>
    </div>
  );
}
