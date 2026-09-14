'use client';

import { useActionState } from 'react';
import {
  createBaseMasterDraftAction,
  startBaseMasterDraftAction,
  type BaseMasterActionState,
} from '@/lib/actions/base-masters';
import { Alert, Button, Field, Input, Select, Spinner } from '@/components/ui';

const initial: BaseMasterActionState = { ok: false };

export function BaseMasterActionStatus({ state }: { state: BaseMasterActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  const firstFieldError = Object.values(state.fieldErrors ?? {}).flat().find(Boolean);
  if (firstFieldError) return <Alert tone="danger">{firstFieldError}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function BaseMasterPendingButton({
  pending,
  children,
  variant = 'primary',
}: {
  pending: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending && <Spinner />}
      {children}
    </Button>
  );
}

export function BaseMasterCreateForm({
  models,
  organizations,
}: {
  models: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createBaseMasterDraftAction, initial);
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} className="card space-y-5 p-6" noValidate>
      <div>
        <h2 className="text-lg font-semibold">新しい本体を作成</h2>
        <p className="mt-1 text-sm text-muted">
          まずDraftとして作成します。明細と金額を確認した後に公開します。
        </p>
      </div>
      <BaseMasterActionStatus state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ベースモデル" htmlFor="base_model_id" required errors={e.base_model_id}>
          <Select id="base_model_id" name="base_model_id" required defaultValue={models[0]?.id ?? ''}>
            {models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="所有組織" htmlFor="owner_organization_id" required errors={e.owner_organization_id}>
          <Select id="owner_organization_id" name="owner_organization_id" required defaultValue={organizations[0]?.id ?? ''}>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>{org.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="本体名" htmlFor="name" required errors={e.name}>
          <Input id="name" name="name" required placeholder="例：本部 Wing ホテル非防火" />
        </Field>
        <Field label="防火区分" htmlFor="fire_spec_code" required errors={e.fire_spec_code}>
          <Select id="fire_spec_code" name="fire_spec_code" defaultValue="non_fire">
            <option value="non_fire">非防火</option>
            <option value="fire">防火</option>
          </Select>
        </Field>
      </div>
      <BaseMasterPendingButton pending={pending}>Draftを作成</BaseMasterPendingButton>
    </form>
  );
}

export function StartBaseMasterDraftForm({ masterId }: { masterId: string }) {
  const [state, action, pending] = useActionState(startBaseMasterDraftAction, initial);
  return (
    <div className="space-y-3">
      <BaseMasterActionStatus state={state} />
      <form action={action}>
        <input type="hidden" name="master_id" value={masterId} />
        <BaseMasterPendingButton pending={pending}>新しいDraftを作る</BaseMasterPendingButton>
      </form>
    </div>
  );
}
