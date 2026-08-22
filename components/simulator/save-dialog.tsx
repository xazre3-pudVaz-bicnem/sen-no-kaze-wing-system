'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

interface Props {
  mode: 'save' | 'quote';
  initialName: string;
  saving: boolean;
  error: string | null;
  total: number;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function SaveDialog({ mode, initialName, saving, error, total, onClose, onSubmit }: Props) {
  const [name, setName] = useState(initialName);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // クリーンアップで close() しない: close イベント → onClose → 親が state を消す連鎖が
    // 開発モードの effect 二重実行で起き、ダイアログが即座に閉じてしまうため。
    // アンマウント時は要素ごと消えるので明示的に閉じる必要はない。
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
      aria-labelledby="save-dialog-title"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit(name.trim());
        }}
        className="p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="save-dialog-title" className="text-xl">
            {mode === 'quote' ? '保存して見積依頼へ進む' : 'この仕様を保存'}
          </h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-sand" aria-label="閉じる">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          {mode === 'quote'
            ? '仕様をマイページに保存したうえで、お客様情報の入力画面へ進みます。'
            : 'マイページに保存すると、後から再編集・複製・見積依頼ができます。'}
        </p>
        <div className="mt-5">
          <Field label="保存名" htmlFor="config-name" required>
            <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required data-testid="config-name-input" />
          </Field>
        </div>
        <p className="mt-4 flex items-baseline justify-between text-sm">
          <span className="text-muted">概算合計（税込）</span>
          <span className="font-serif text-2xl">{formatYen(total)}</span>
        </p>
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button type="submit" disabled={saving || !name.trim()} data-testid="save-confirm">
            {saving && <Spinner />}
            {saving ? '保存中…' : mode === 'quote' ? '保存して進む' : '保存する'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
