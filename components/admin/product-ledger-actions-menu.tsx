'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { deleteDraftProductFromLedgerAction } from '@/lib/actions/product-ledger';
import type { ProductOption } from '@/lib/domain/types';

type Props = {
  optionId: string;
  optionName: string;
  status: ProductOption['status'];
  canEdit: boolean;
  configurationUsageCount: number | null;
};

export function ProductLedgerActionsMenu({
  optionId,
  optionName,
  status,
  canEdit,
  configurationUsageCount,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) details.removeAttribute('open');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !details.open) return;
      details.removeAttribute('open');
      details.querySelector<HTMLElement>('summary')?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!canEdit) return null;

  const isDraft = status === 'draft';
  const canDelete = isDraft && configurationUsageCount === 0;
  const editHref = `/admin/options/${optionId}?return_to=%2Fadmin%2Fledger`;

  return (
    <details
      ref={detailsRef}
      className="group relative pointer-events-auto"
      data-product-ledger-actions
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      <summary
        className="inline-flex size-7 cursor-pointer list-none items-center justify-center rounded-md text-muted hover:bg-sand hover:text-ink [&::-webkit-details-marker]:hidden"
        aria-label={`${optionName}のその他の操作`}
        title="その他の操作"
      >
        <EllipsisVertical className="size-4" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-line bg-white p-1.5 text-left text-xs font-normal shadow-lg">
        <Link
          href={editHref}
          className="flex w-full items-center rounded-md px-2.5 py-2 text-ink-soft hover:bg-sand hover:text-ink"
        >
          商品情報を編集
        </Link>

        {isDraft && <div className="my-1 border-t border-line" />}

        {canDelete && (
          <form action={deleteDraftProductFromLedgerAction}>
            <input type="hidden" name="id" value={optionId} />
            <ConfirmSubmit
              message={`「${optionName}」の下書きを完全に削除しますか？この操作は元に戻せません。`}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-danger hover:bg-red-50"
            >
              下書きを削除
            </ConfirmSubmit>
          </form>
        )}

        {isDraft && configurationUsageCount !== null && configurationUsageCount > 0 && (
          <p className="rounded-md px-2.5 py-2 leading-5 text-muted" aria-disabled="true">
            削除できません（構成で使用中 {configurationUsageCount}件）
          </p>
        )}

        {isDraft && configurationUsageCount === null && (
          <p className="rounded-md px-2.5 py-2 leading-5 text-muted" aria-disabled="true">
            削除可否を確認できません
          </p>
        )}
      </div>
    </details>
  );
}
