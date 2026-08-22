'use client';

import { Trash2 } from 'lucide-react';
import { deleteConfigurationAction } from '@/lib/actions/configurations';

export function DeleteConfigurationButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteConfigurationAction}
      onSubmit={(e) => {
        if (!window.confirm(`「${name}」を削除しますか？この操作は取り消せません。`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="btn-ghost btn-sm w-full text-danger hover:bg-danger/5" data-testid="delete-button">
        <Trash2 className="size-4" aria-hidden="true" />
        削除
      </button>
    </form>
  );
}
