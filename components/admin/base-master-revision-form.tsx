'use client';

import { useActionState, useState } from 'react';
import {
  discardBaseMasterDraftAction,
  publishBaseMasterDraftAction,
  saveBaseMasterDraftAction,
  type BaseMasterActionState,
} from '@/lib/actions/base-masters';
import { Button, Spinner } from '@/components/ui';
import { BaseMasterActionStatus } from './base-master-form';
import { BaseMasterLinesEditor, type BaseMasterRevisionLine } from './base-master-lines';

const initial: BaseMasterActionState = { ok: false };

export interface BaseMasterRevisionView {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  expense_method: 'rate' | 'fixed' | 'none';
  expense_rate: number | null;
  expense_amount: number;
  line_subtotal: number;
  total: number;
  published_at: string | null;
}

interface MasterIdentity {
  id: string;
  name: string;
  fire_spec_code: 'non_fire' | 'fire';
}

export function BaseMasterDraftEditor({
  master,
  revision,
  lines,
  identityLocked,
}: {
  master: MasterIdentity;
  revision: BaseMasterRevisionView;
  lines: BaseMasterRevisionLine[];
  identityLocked: boolean;
}) {
  const [saveState, saveAction, saving] = useActionState(saveBaseMasterDraftAction, initial);
  const [publishState, publishAction, publishing] = useActionState(publishBaseMasterDraftAction, initial);
  const [discardState, discardAction, discarding] = useActionState(discardBaseMasterDraftAction, initial);
  const initialRate = revision.expense_rate == null ? 15 : Math.round(revision.expense_rate * 10000) / 100;
  const initialFixed = revision.expense_method === 'fixed' ? revision.expense_amount : 0;

  const [name, setName] = useState(master.name);
  const [fireSpec, setFireSpec] = useState(master.fire_spec_code);
  const [method, setMethod] = useState<BaseMasterRevisionView['expense_method']>(revision.expense_method);
  const [rate, setRate] = useState(initialRate);
  const [fixed, setFixed] = useState(initialFixed);
  const [dirty, setDirty] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);

  const resetDraft = () => {
    if (dirty && !window.confirm('未保存の変更を破棄して、保存時点の内容に戻しますか？')) return;
    setName(master.name);
    setFireSpec(master.fire_spec_code);
    setMethod(revision.expense_method);
    setRate(initialRate);
    setFixed(initialFixed);
    setDirty(false);
    setResetVersion((current) => current + 1);
  };

  return (
    <div className="space-y-5">
      <form action={saveAction} className="space-y-4" noValidate>
        <input type="hidden" name="revision_id" value={revision.id} />
        <input type="hidden" name="master_id" value={master.id} />
        {identityLocked && <input type="hidden" name="fire_spec_code" value={fireSpec} />}

        <section className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Draft v{revision.version}</h2>
                <span className={dirty
                  ? 'rounded-full border border-amber-400 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900'
                  : 'rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800'}
                >
                  {dirty ? '未保存の変更あり' : '保存時点と同じ'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">保存中は公開版に影響しません。公開した時点でこの版が現在版になります。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={resetDraft}>保存時点に戻す</Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving && <Spinner />}
                Draftを保存
              </Button>
            </div>
          </div>

          <BaseMasterActionStatus state={saveState} />

          <div className="flex flex-wrap divide-x divide-slate-200 border-b border-slate-200 text-sm">
            <label className="flex min-w-[22rem] flex-1 items-center gap-2 px-4 py-2">
              <span className="whitespace-nowrap text-xs text-slate-500">本体名</span>
              <input
                id="bm-name"
                name="name"
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setDirty(true);
                }}
                className="h-8 min-w-48 flex-1 rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
              />
            </label>

            <label className="flex items-center gap-2 px-4 py-2">
              <span className="whitespace-nowrap text-xs text-slate-500">防火仕様</span>
              <select
                id="bm-fire"
                name={identityLocked ? undefined : 'fire_spec_code'}
                value={fireSpec}
                disabled={identityLocked}
                onChange={(event) => {
                  setFireSpec(event.target.value as 'non_fire' | 'fire');
                  setDirty(true);
                }}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700/30 disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="non_fire">非防火</option>
                <option value="fire">防火</option>
              </select>
              {identityLocked && <span className="text-[10px] text-slate-400">公開履歴のため固定</span>}
            </label>

            <label className="flex items-center gap-2 px-4 py-2">
              <span className="whitespace-nowrap text-xs text-slate-500">諸費用</span>
              <select
                id="bm-expense-method"
                name="expense_method"
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as BaseMasterRevisionView['expense_method']);
                  setDirty(true);
                }}
                className="h-8 rounded border border-slate-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
              >
                <option value="rate">率で計算</option>
                <option value="fixed">固定金額</option>
                <option value="none">なし</option>
              </select>
            </label>

            {method === 'rate' ? (
              <label className="flex items-center gap-2 px-4 py-2">
                <input
                  id="bm-rate"
                  name="expense_rate_percent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={rate}
                  onChange={(event) => {
                    setRate(Number(event.target.value));
                    setDirty(true);
                  }}
                  className="h-8 w-24 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
                />
                <span>%</span>
              </label>
            ) : (
              <input type="hidden" name="expense_rate_percent" value={rate} />
            )}

            {method === 'fixed' ? (
              <label className="flex items-center gap-2 px-4 py-2">
                <input
                  id="bm-fixed"
                  name="expense_amount"
                  type="number"
                  min={0}
                  step={1}
                  value={fixed}
                  onChange={(event) => {
                    setFixed(Number(event.target.value));
                    setDirty(true);
                  }}
                  className="h-8 w-32 rounded border border-amber-300 bg-amber-50 px-2 text-right text-sm outline-none focus:ring-2 focus:ring-emerald-700/30"
                />
                <span>円</span>
              </label>
            ) : (
              <input type="hidden" name="expense_amount" value={0} />
            )}
          </div>
        </section>

        <BaseMasterLinesEditor
          lines={lines}
          expenseMethod={method}
          expenseRatePercent={rate}
          fixedExpense={fixed}
          onDirty={() => setDirty(true)}
          resetVersion={resetVersion}
        />

        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving}>
            {saving && <Spinner />}
            Draftを保存
          </Button>
        </div>
      </form>

      <section className="card space-y-4 p-6">
        <div>
          <h2 className="font-semibold">Draftの操作</h2>
          <p className="mt-1 text-sm text-muted">公開すると旧公開版は履歴として残り、このDraftが現在の公開版になります。</p>
        </div>
        <BaseMasterActionStatus state={publishState} />
        <BaseMasterActionStatus state={discardState} />
        <div className="flex flex-wrap gap-3">
          <form action={publishAction}>
            <input type="hidden" name="revision_id" value={revision.id} />
            <input type="hidden" name="master_id" value={master.id} />
            <Button
              type="submit"
              disabled={publishing || dirty || lines.length === 0}
              onClick={(event) => {
                if (!window.confirm('Draft v' + revision.version + 'を公開します。公開後はこのRevisionを直接編集できません。よろしいですか？')) {
                  event.preventDefault();
                }
              }}
            >
              {publishing && <Spinner />}
              このDraftを公開
            </Button>
          </form>
          <form action={discardAction}>
            <input type="hidden" name="revision_id" value={revision.id} />
            <Button
              type="submit"
              variant="ghost"
              className="text-danger"
              disabled={discarding}
              onClick={(event) => {
                if (!window.confirm('このDraftを破棄します。よろしいですか？')) event.preventDefault();
              }}
            >
              {discarding && <Spinner />}
              Draftを破棄
            </Button>
          </form>
        </div>
        {dirty && <p className="text-xs text-warn">未保存の変更があります。公開する前にDraftを保存してください。</p>}
      </section>
    </div>
  );
}
