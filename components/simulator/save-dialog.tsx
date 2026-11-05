'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { formatYen } from '@/lib/domain/pricing';
import type { PlanChangeSummary } from '@/lib/domain/plan-change-summary';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

interface Props {
  mode: 'save' | 'quote';
  initialName: string;
  saving: boolean;
  error: string | null;
  total: number;
  changeSummary: PlanChangeSummary;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

const CONFIGURATION_CONFLICT_MESSAGE = '他の画面でこのプランが更新されています';

export function SaveDialog({ mode, initialName, saving, error, total, changeSummary, onClose, onSubmit }: Props) {
  const [name, setName] = useState(initialName);
  const ref = useRef<HTMLDialogElement>(null);
  const isSaveConflict = Boolean(error?.includes(CONFIGURATION_CONFLICT_MESSAGE));
  const displayError = isSaveConflict ? error?.replace(/^LOCKED:\s*/, '') : error;

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
      className="m-auto max-h-[90dvh] w-[min(92vw,28rem)] overflow-y-auto rounded-2xl p-0 shadow-lift backdrop:bg-ink/40"
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
          <Field label="プラン名（変更できます）" htmlFor="config-name" required>
            <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required data-testid="config-name-input" />
          </Field>
          <p className="mt-1 text-xs text-muted">マイページでプランを見分けるための名前です。</p>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-sand/30 p-3 text-sm" data-testid="save-plan-changes">
          <p className="flex items-center justify-between gap-2 font-semibold text-ink">
            <span>現在の標準仕様からの変更</span>
            {changeSummary.complete && <span className="whitespace-nowrap text-xs">{changeSummary.items.length}項目</span>}
          </p>
          {changeSummary.items.length ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-ink-soft">
              {changeSummary.items.map((item) => (
                <li key={item.category} className="flex flex-wrap justify-between gap-x-2">
                  <span>{item.category}</span>
                  <span>{item.kind}{item.detail ? `（${item.detail}）` : ''}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-xs text-ink-soft">{changeSummary.complete ? '標準仕様のまま' : '現在の商品情報では比較できません'}</p>}
          {!changeSummary.complete && changeSummary.items.length > 0 && (
            <p className="mt-2 text-xs text-muted">現在の商品情報では一部比較できない項目があります。</p>
          )}
          <p className="mt-2 text-[0.7rem] text-muted">現在の標準選択と比較しています。保存時点の標準履歴ではありません。</p>
        </div>
        <p className="mt-4 flex items-baseline justify-between text-sm">
          <span className="text-muted">概算合計（税込）</span>
          <span className="font-serif text-2xl">{formatYen(total)}</span>
        </p>
        {isSaveConflict ? (
          <Alert tone="warn" className="mt-4">
            <div data-testid="save-conflict-message">
              <p className="font-semibold text-ink">ほかの画面でこのプランが更新されています。</p>
              {displayError && <p className="mt-1 text-sm">{displayError}</p>}
              <p className="mt-2 text-sm leading-relaxed">
                この画面からは上書きしていません。最新の内容を再読み込みして確認し、必要な変更をもう一度行ってください。
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => window.location.reload()}
                data-testid="save-conflict-reload"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                最新の内容を再読み込み
              </Button>
            </div>
          </Alert>
        ) : error ? (
          <Alert tone="danger" className="mt-4">{error}</Alert>
        ) : null}
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
