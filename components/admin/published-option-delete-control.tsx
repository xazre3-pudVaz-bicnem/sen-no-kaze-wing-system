'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { deleteUnusedPublishedOptionAction } from '@/lib/actions/unused-published-product-delete';

type PortalTarget = {
  element: HTMLElement;
  optionId: string;
};

export function PublishedOptionDeleteControl({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const [target, setTarget] = useState<PortalTarget | null>(null);
  const match = /^\/admin\/options\/([^/]+)$/.exec(pathname);
  const optionId = match?.[1] ?? '';

  useEffect(() => {
    if (!enabled || !optionId) return;

    let host: HTMLDivElement | null = null;
    let raf = 0;

    const sync = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        const publishedStatus = document.querySelector<HTMLInputElement>(
          'form input[name="status"][value="published"]'
        );
        const form = publishedStatus?.form;
        const parent = form?.parentElement;

        if (!form || !parent) {
          if (host?.isConnected) host.remove();
          host = null;
          setTarget(null);
          return;
        }

        const existing = parent.querySelector<HTMLElement>('[data-published-option-delete-host="true"]');
        if (existing) {
          setTarget({ element: existing, optionId });
          return;
        }

        host = document.createElement('div');
        host.dataset.publishedOptionDeleteHost = 'true';
        parent.appendChild(host);
        setTarget({ element: host, optionId });
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
      if (host?.isConnected) host.remove();
    };
  }, [enabled, optionId]);

  if (!enabled || !optionId || !target || target.optionId !== optionId) return null;

  return createPortal(
    <details className="rounded-xl border border-line bg-white" data-testid="published-option-delete-control">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">その他の操作</summary>
      <div className="border-t border-line px-4 py-4">
        <p className="text-sm font-semibold text-ink">登録済み商品の削除（未使用のみ）</p>
        <p className="mt-2 text-xs leading-5 text-muted">
          誤って登録した商品など、保存済み仕様・見積・標準見積・履歴・商品ルールで一度も使われていない商品だけ削除できます。
          使用済みの商品は削除されません。
        </p>
        <form action={deleteUnusedPublishedOptionAction} className="mt-3">
          <input type="hidden" name="id" value={optionId} />
          <ConfirmSubmit
            message="この登録済み商品を完全に削除しますか？未使用と確認できた場合だけ削除されます。この操作は取り消せません。"
            className="btn-ghost btn-sm text-danger"
          >
            この商品を削除
          </ConfirmSubmit>
        </form>
      </div>
    </details>,
    target.element
  );
}
