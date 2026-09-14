'use client';

import { useActionState, useState } from 'react';
import {
  discardBaseMasterDraftAction,
  publishBaseMasterDraftAction,
  saveBaseMasterDraftAction,
  type BaseMasterActionState,
} from '@/lib/actions/base-masters';
import { Button, Field, Input, Select, Spinner } from '@/components/ui';
import { BaseMasterActionStatus, BaseMasterPendingButton } from './base-master-form';
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
  const [name, setName] = useState(master.name);
  const [fireSpec, setFireSpec] = useState(master.fire_spec_code);
  const [method, setMethod] = useState<BaseMasterRevisionView['expense_method']>(revision.expense_method);
  const [rate, setRate] = useState(revision.expense_rate == null ? 15 : Math.round(revision.expense_rate * 10000) / 100);
  const [fixed, setFixed] = useState(revision.expense_method === 'fixed' ? revision.expense_amount : 0);
  const [dirty, setDirty] = useState(false);

  return (
    <div className="space-y-5">
      <form action={saveAction} className="card space-y-5 p-6" noValidate>
        <input type="hidden" name="revision_id" value={revision.id} />
        <input type="hidden" name="master_id" value={master.id} />
        {identityLocked && <input type="hidden" name="fire_spec_code" value={fireSpec} />}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Draft v{revision.version}</h2>
            <p className="mt-1 text-sm text-muted">保存中は公開版に影響しません。公開した時点でこの版が現在版になります。</p>
          </div>
          {dirty && <span className="rounded-full bg-warn/10 px-3 py-1 text-xs font-semibold text-warn">未保存</span>}
        </div>
        <BaseMasterActionStatus state={saveState} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="本体名" htmlFor="bm-name" required errors={saveState.fieldErrors?.name}>
            <Input id="bm-name" name="name" value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} />
          </Field>
          <Field label="防火区分" htmlFor="bm-fire" required hint={identityLocked ? '公開履歴がある本体では変更できません。' : undefined}>
            <Select id="bm-fire" name="fire_spec_code" value={fireSpec} disabled={identityLocked}
              onChange={(event) => { setFireSpec(event.target.value as 'non_fire' | 'fire'); setDirty(true); }}>
              <option value="non_fire">非防火</option>
              <option value="fire">防火</option>
            </Select>
          </Field>
          <Field label="諸費用" htmlFor="bm-expense-method" required>
            <Select id="bm-expense-method" name="expense_method" value={method}
              onChange={(event) => { setMethod(event.target.value as BaseMasterRevisionView['expense_method']); setDirty(true); }}>
              <option value="rate">率で計算</option>
              <option value="fixed">固定金額</option>
              <option value="none">なし</option>
            </Select>
          </Field>
          {method === 'rate' ? (
            <Field label="諸費用率（%）" htmlFor="bm-rate" required>
              <Input id="bm-rate" name="expense_rate_percent" type="number" min={0} max={100} step={0.1}
                value={rate} onChange={(event) => { setRate(Number(event.target.value)); setDirty(true); }} />
            </Field>
          ) : <input type="hidden" name="expense_rate_percent" value={rate} />}
          {method === 'fixed' ? (
            <Field label="固定諸費用（円）" htmlFor="bm-fixed" required>
              <Input id="bm-fixed" name="expense_amount" type="number" min={0} step={1}
                value={fixed} onChange={(event) => { setFixed(Number(event.target.value)); setDirty(true); }} />
            </Field>
          ) : <input type="hidden" name="expense_amount" value={0} />}
        </div>
        <BaseMasterLinesEditor lines={lines} expenseMethod={method} expenseRatePercent={rate} fixedExpense={fixed} onDirty={() => setDirty(true)} />
        <BaseMasterPendingButton pending={saving}>Draftを保存</BaseMasterPendingButton>
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
                if (!window.confirm(`Draft v${revision.version}を公開します。公開後はこのRevisionを直接編集できません。よろしいですか？`)) {
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
