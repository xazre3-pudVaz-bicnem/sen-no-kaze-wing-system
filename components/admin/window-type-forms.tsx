'use client';

import { useActionState } from 'react';
import { saveWindowTypeAction } from '@/lib/actions/admin';
import type { WindowType } from '@/lib/domain/types';
import { Input, Select } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

const fieldError = (errors: Record<string, string[] | undefined> | undefined, key: string) =>
  errors?.[key]?.[0] ? <p className="text-[0.7rem] text-danger">{errors[key]?.[0]}</p> : null;

/** 登録済みの窓タイプの名前・並び・使う／使わないを変える（コードは変えない。v2.5 PR-S2） */
export function WindowTypeRowForm({ windowType }: { windowType: WindowType }) {
  const [state, action, pending] = useActionState(saveWindowTypeAction, initial);
  return (
    <form action={action} className="space-y-1 border-b border-line py-2" data-testid={`window-type-${windowType.code}`}>
      <input type="hidden" name="is_new" value="0" />
      <input type="hidden" name="code" value={windowType.code} />
      <div className="grid items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_6rem_8rem_auto]">
        <code className="text-xs text-ink-soft">{windowType.code}</code>
        <Input name="label" defaultValue={windowType.label} aria-label={`${windowType.code} の名前`} maxLength={40} />
        <Input name="sort_order" defaultValue={windowType.sort_order} inputMode="numeric" aria-label={`${windowType.code} の並び順`} />
        <Select name="status" defaultValue={windowType.status} aria-label={`${windowType.code} を使うか`}>
          <option value="active">使う</option>
          <option value="retired">使わない</option>
        </Select>
        <SubmitButton pending={pending} label="保存" />
      </div>
      {fieldError(state.fieldErrors, 'label')}
      {fieldError(state.fieldErrors, 'sort_order')}
      <Status state={state} />
    </form>
  );
}

/** 窓タイプを足す（コードは足すときだけ決める。商品が参照するので後から変えない） */
export function WindowTypeCreateForm({ nextSortOrder }: { nextSortOrder: number }) {
  const [state, action, pending] = useActionState(saveWindowTypeAction, initial);
  return (
    <form action={action} className="space-y-2 rounded-xl border border-line bg-white p-4" data-testid="window-type-create">
      <input type="hidden" name="is_new" value="1" />
      <input type="hidden" name="status" value="active" />
      <h2 className="text-sm font-semibold">窓タイプを足す</h2>
      <div className="grid items-end gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_6rem_auto]">
        <label className="space-y-1 text-xs">
          <span className="text-ink-soft">コード（英小文字）</span>
          <Input name="code" placeholder="例：bay" aria-label="新しい窓タイプのコード" maxLength={40} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-ink-soft">名前</span>
          <Input name="label" placeholder="例：出窓" aria-label="新しい窓タイプの名前" maxLength={40} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-ink-soft">並び順</span>
          <Input name="sort_order" defaultValue={nextSortOrder} inputMode="numeric" aria-label="新しい窓タイプの並び順" />
        </label>
        <SubmitButton pending={pending} label="足す" />
      </div>
      {fieldError(state.fieldErrors, 'code')}
      {fieldError(state.fieldErrors, 'label')}
      <Status state={state} />
    </form>
  );
}
