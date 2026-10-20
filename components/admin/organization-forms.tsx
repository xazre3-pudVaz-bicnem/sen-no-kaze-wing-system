'use client';

import { useActionState, useState } from 'react';
import {
  createOrganizationAction,
  inviteMemberAction,
  updateOrganizationAction,
  type OrganizationFormState,
} from '@/lib/actions/organizations';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import type { OrganizationDetail, OrganizationStatus } from '@/lib/domain/organizations';

const initial: OrganizationFormState = { ok: false };

type ParentOption = { id: string; name: string; status: OrganizationStatus };

function ParentSelect({ id, parents, defaultValue }: { id: string; parents: ParentOption[]; defaultValue?: string | null }) {
  return (
    <Select id={id} name="parent_organization_id" defaultValue={defaultValue ?? ''}>
      <option value="">（未設定）</option>
      {parents.map((parent) => (
        <option key={parent.id} value={parent.id} disabled={parent.status !== 'active' && parent.id !== defaultValue}>
          {parent.name}
          {parent.status !== 'active' ? '（停止中）' : ''}
        </option>
      ))}
    </Select>
  );
}

/** 本部：総代理店・代理店を登録する */
export function CreateOrganizationForm({ parents }: { parents: ParentOption[] }) {
  const [state, action, pending] = useActionState(createOrganizationAction, initial);
  const [type, setType] = useState<'master_dealer' | 'dealer'>('dealer');
  return (
    <form action={action} className="card space-y-4 p-5" data-testid="organization-create-form">
      <h2 className="text-lg font-semibold">組織を登録する</h2>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="種類" htmlFor="org-type" required>
          <Select id="org-type" name="organization_type" value={type} onChange={(e) => setType(e.target.value as 'master_dealer' | 'dealer')}>
            <option value="dealer">代理店</option>
            <option value="master_dealer">総代理店</option>
          </Select>
        </Field>
        <Field label="組織名" htmlFor="org-name" required>
          <Input id="org-name" name="name" maxLength={100} required placeholder="例：〇〇ホーム株式会社" />
        </Field>
        {type === 'dealer' && (
          <Field label="直属の総代理店" htmlFor="org-parent" hint="製造依頼の送り先の初期値になります。あとから変えられます。">
            <ParentSelect id="org-parent" parents={parents} />
          </Field>
        )}
      </div>
      <p className="text-xs leading-5 text-muted">登録したあと、組織の画面から最初の管理者を招待します。管理者は、自分の組織の担当者を追加できます。</p>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} data-testid="organization-create-submit">
          {pending ? '登録中…' : '登録する'}
        </Button>
      </div>
    </form>
  );
}

/** 本部：組織の名前・直属の総代理店・状態を変える */
export function UpdateOrganizationForm({ organization, parents }: { organization: OrganizationDetail; parents: ParentOption[] }) {
  const [state, action, pending] = useActionState(updateOrganizationAction, initial);
  return (
    <form action={action} className="card space-y-4 p-5" data-testid="organization-update-form">
      <input type="hidden" name="organization_id" value={organization.id} />
      <h2 className="text-lg font-semibold">組織の情報</h2>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="組織名" htmlFor="org-edit-name" required>
          <Input id="org-edit-name" name="name" maxLength={100} required defaultValue={organization.name} />
        </Field>
        {organization.organization_type === 'dealer' ? (
          <Field label="直属の総代理店" htmlFor="org-edit-parent">
            <ParentSelect id="org-edit-parent" parents={parents.filter((p) => p.id !== organization.id)} defaultValue={organization.parent_organization_id} />
          </Field>
        ) : (
          <input type="hidden" name="parent_organization_id" value="" />
        )}
        <Field label="状態" htmlFor="org-edit-status" required hint="停止すると、招待やメンバーの変更ができなくなります。">
          <Select id="org-edit-status" name="status" defaultValue={organization.status}>
            <option value="active">有効</option>
            <option value="inactive">停止</option>
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? '保存中…' : '保存する'}
        </Button>
      </div>
    </form>
  );
}

/** 本部・その組織の管理者：メールアドレスと役割を決めて招待する */
export function InviteMemberForm({ organizationId, firstManager }: { organizationId: string; firstManager: boolean }) {
  const [state, action, pending] = useActionState(inviteMemberAction, initial);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!state.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(state.inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <form action={action} className="space-y-3" data-testid="organization-invite-form">
      <input type="hidden" name="organization_id" value={organizationId} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && state.message && (
        <Alert tone="success">
          <p>{state.message}</p>
          {state.inviteUrl && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-white px-2 py-1 text-xs text-ink" data-testid="organization-invite-url">
                {state.inviteUrl}
              </code>
              <Button type="button" size="sm" variant="secondary" onClick={copy}>
                {copied ? 'コピーしました' : 'リンクをコピー'}
              </Button>
            </div>
          )}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <Field label="メールアドレス" htmlFor="invite-email" required>
          <Input id="invite-email" name="email" type="email" required autoComplete="off" placeholder="例：tanaka@example.com" />
        </Field>
        <Field label="役割" htmlFor="invite-role" required>
          <Select id="invite-role" name="member_role" defaultValue={firstManager ? 'admin' : 'editor'}>
            <option value="editor">担当者</option>
            <option value="admin">管理者</option>
          </Select>
        </Field>
        <Button type="submit" disabled={pending} data-testid="organization-invite-submit">
          {pending ? '発行中…' : '招待する'}
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted">
        招待した方は、このメールアドレスでログイン（まだの方は会員登録）してからリンクを開き、「参加する」を押すと参加できます。リンクの有効期限は 7 日です。
      </p>
    </form>
  );
}
