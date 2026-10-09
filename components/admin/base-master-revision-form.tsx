'use client';

import { useActionState, useState } from 'react';
import {
  discardBaseMasterDraftAction,
  publishBaseMasterDraftAction,
  saveBaseMasterDraftAction,
  type BaseMasterActionState,
} from '@/lib/actions/base-masters';
import { formatBaseMasterRevision } from '@/lib/domain/base-master-ui';
import { Button, Field, Input, Select, Spinner } from '@/components/ui';
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
  modelName,
  ownerName,
  currentPublishedVersion,
}: {
  master: MasterIdentity;
  revision: BaseMasterRevisionView;
  lines: BaseMasterRevisionLine[];
  identityLocked: boolean;
  modelName: string;
  ownerName: string;
  currentPublishedVersion: number | null;
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

  const revisionNumber = formatBaseMasterRevision(revision.version);

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
    <div className="space-y-4">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">本体マスター編集</h2>
              <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">下書き {revisionNumber}</span>
              {dirty ? (
                <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn">未保存の変更あり</span>
              ) : (
                <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">保存済み</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">
              本体条件・明細・価格をこの画面で確認し、保存後に公開します。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={resetDraft}>保存時点に戻す</Button>
            <button
              type="submit"
              form="base-master-save-form"
              className="btn-secondary btn-sm inline-flex items-center gap-2"
              disabled={saving}
            >
              {saving && <Spinner />}
              下書きを保存
            </button>
            <form action={publishAction}>
              <input type="hidden" name="revision_id" value={revision.id} />
              <input type="hidden" name="master_id" value={master.id} />
              <Button
                type="submit"
                size="sm"
                disabled={publishing || dirty || lines.length === 0}
                onClick={(event) => {
                  if (!window.confirm(`下書き ${revisionNumber} を公開します。公開後、この版の内容は直接変更できません。よろしいですか？`)) {
                    event.preventDefault();
                  }
                }}
              >
                {publishing && <Spinner />}
                この内容で公開
              </Button>
            </form>
          </div>
        </div>

        <form id="base-master-save-form" action={saveAction} noValidate>
          <input type="hidden" name="revision_id" value={revision.id} />
          <input type="hidden" name="master_id" value={master.id} />
          {identityLocked && <input type="hidden" name="fire_spec_code" value={fireSpec} />}

          <div className="space-y-3 border-b border-line px-4 py-3">
            <BaseMasterActionStatus state={saveState} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Field label="本体名" htmlFor="bm-name" required errors={saveState.fieldErrors?.name}>
                <Input id="bm-name" name="name" value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} />
              </Field>
              <div>
                <p className="text-xs text-muted">商品モデル</p>
                <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-sand/40 px-3 text-sm font-semibold">
                  {modelName}
                </div>
              </div>
              <Field label="防火仕様" htmlFor="bm-fire" required hint={identityLocked ? '公開履歴がある本体では変更できません。' : undefined}>
                <Select id="bm-fire" name="fire_spec_code" value={fireSpec} disabled={identityLocked}
                  onChange={(event) => { setFireSpec(event.target.value as 'non_fire' | 'fire'); setDirty(true); }}>
                  <option value="non_fire">非防火</option>
                  <option value="fire">防火</option>
                </Select>
              </Field>
              <div>
                <p className="text-xs text-muted">本体管理元</p>
                <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-sand/40 px-3 text-sm font-semibold">
                  {ownerName}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">現在の公開版</p>
                <div className="mt-1 flex h-10 items-center rounded-lg border border-line bg-sand/40 px-3 text-sm font-semibold">
                  {currentPublishedVersion == null ? '未公開' : formatBaseMasterRevision(currentPublishedVersion)}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 border-b border-line px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          </div>

          <div className="p-4">
            <BaseMasterLinesEditor
              lines={lines}
              expenseMethod={method}
              expenseRatePercent={rate}
              fixedExpense={fixed}
              onDirty={() => setDirty(true)}
              resetVersion={resetVersion}
            />
          </div>
        </form>

        <div className="space-y-3 border-t border-line px-4 py-3">
          <BaseMasterActionStatus state={publishState} />
          <BaseMasterActionStatus state={discardState} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">公開前の確認</h2>
              <p className="mt-1 text-xs text-muted">
                公開すると、この内容が現在の公開版になります。公開操作は画面上部から行います。
              </p>
            </div>
            <form action={discardAction}>
              <input type="hidden" name="revision_id" value={revision.id} />
              <Button
                type="submit"
                variant="ghost"
                className="text-danger"
                disabled={discarding}
                onClick={(event) => {
                  if (!window.confirm('この下書きを破棄します。よろしいですか？')) event.preventDefault();
                }}
              >
                {discarding && <Spinner />}
                下書きを破棄
              </Button>
            </form>
          </div>
          {dirty && <p className="text-xs text-warn">未保存の変更があります。公開する前に下書きを保存してください。</p>}
        </div>
      </section>
    </div>
  );
}
