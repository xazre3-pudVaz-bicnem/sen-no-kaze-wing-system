'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import { deleteDraftProductFromLedgerAction } from '@/lib/actions/product-ledger';
import { deleteUnusedPublishedOptionAction } from '@/lib/actions/unused-published-product-delete';
import { setProductLifecycleAction } from '@/lib/actions/product-lifecycle';
import { productSalesState } from '@/lib/domain/product-lifecycle';
import type { ProductOption } from '@/lib/domain/types';

type Props = {
  optionId: string;
  optionName: string;
  status: ProductOption['status'];
  canEdit: boolean;
  configurationUsageCount: number | null;
  lifecycleEnabled: boolean;
  archivedAt: string | null | undefined;
  discontinuedAt: string | null | undefined;
  expectedUpdatedAt: string;
};

export function ProductLedgerActionsMenu({
  optionId,
  optionName,
  status,
  canEdit,
  configurationUsageCount,
  lifecycleEnabled,
  archivedAt,
  discontinuedAt,
  expectedUpdatedAt,
}: Props) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [lifecycleDialog, setLifecycleDialog] = useState<'retire' | 'resume' | null>(null);

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    queueMicrotask(() => detailsRef.current?.querySelector<HTMLElement>('summary')?.focus());
  };
  const closeLifecycleDialog = () => {
    setLifecycleDialog(null);
    queueMicrotask(() => detailsRef.current?.querySelector<HTMLElement>('summary')?.focus());
  };

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) details.removeAttribute('open');
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (deleteDialogOpen) {
        closeDeleteDialog();
        return;
      }
      if (lifecycleDialog) {
        closeLifecycleDialog();
        return;
      }
      if (!details.open) return;
      details.removeAttribute('open');
      details.querySelector<HTMLElement>('summary')?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [deleteDialogOpen, lifecycleDialog]);

  useEffect(() => {
    if (!deleteDialogOpen && !lifecycleDialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [deleteDialogOpen, lifecycleDialog]);

  if (!canEdit) return null;

  const isDraft = status === 'draft';
  const isPublished = status === 'published';
  const salesState = productSalesState({ status, archived_at: archivedAt, discontinued_at: discontinuedAt });
  const canStop = isPublished && lifecycleEnabled && salesState === 'registered';
  const canResume = isPublished && lifecycleEnabled && salesState === 'stopped';
  const canDeleteDraft = isDraft && configurationUsageCount === 0;
  const deleteAction = isDraft ? deleteDraftProductFromLedgerAction : deleteUnusedPublishedOptionAction;
  const editHref = `/admin/options/${optionId}?return_to=%2Fadmin%2Fledger`;
  const duplicateHref = `/admin/options/new?copy_from=${encodeURIComponent(optionId)}&return_to=%2Fadmin%2Fledger`;

  return (
    <>
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
          className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border border-line bg-white text-ink-soft shadow-sm transition hover:border-brown/50 hover:bg-sand hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brown/40 focus-visible:ring-offset-1 [&::-webkit-details-marker]:hidden"
          aria-label={`${optionName}のその他の操作`}
          title="その他の操作"
        >
          <EllipsisVertical className="size-5" strokeWidth={2.25} aria-hidden="true" />
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-line bg-white p-1.5 text-left text-xs font-normal shadow-lg">
          <Link
            href={editHref}
            className="flex w-full items-center rounded-md px-2.5 py-2 text-ink-soft hover:bg-sand hover:text-ink"
          >
            商品情報を編集
          </Link>
          <Link
            href={duplicateHref}
            className="flex w-full items-center rounded-md px-2.5 py-2 text-ink-soft hover:bg-sand hover:text-ink"
          >
            この商品をもとに新規登録
          </Link>

          {(canStop || canResume) && (
            <button
              type="button"
              data-testid="ledger-row-lifecycle-action"
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-ink-soft hover:bg-sand hover:text-ink"
              onClick={() => {
                detailsRef.current?.removeAttribute('open');
                setLifecycleDialog(canStop ? 'retire' : 'resume');
              }}
            >
              {canStop ? '販売を停止する' : '販売を再開する'}
            </button>
          )}

          {(isDraft || isPublished) && <div className="my-1 border-t border-line" />}

          {canDeleteDraft && (
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-danger hover:bg-red-50"
              onClick={() => {
                detailsRef.current?.removeAttribute('open');
                setDeleteDialogOpen(true);
              }}
            >
              下書きを削除
            </button>
          )}

          {isPublished && (
            <button
              type="button"
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-danger hover:bg-red-50"
              onClick={() => {
                detailsRef.current?.removeAttribute('open');
                setDeleteDialogOpen(true);
              }}
            >
              この商品を削除（未使用のみ）
            </button>
          )}

          {isDraft && configurationUsageCount !== null && configurationUsageCount > 0 && (
            <p className="rounded-md px-2.5 py-2 leading-5 text-muted" aria-disabled="true">
              削除できません（保存プラン {configurationUsageCount}件）
            </p>
          )}

          {isDraft && configurationUsageCount === null && (
            <p className="rounded-md px-2.5 py-2 leading-5 text-muted" aria-disabled="true">
              削除可否を確認できません
            </p>
          )}
        </div>
      </details>

      {lifecycleDialog && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeLifecycleDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`lifecycle-product-title-${optionId}`}
            aria-describedby={`lifecycle-product-description-${optionId}`}
            className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id={`lifecycle-product-title-${optionId}`} className="text-lg font-semibold text-ink">
              {lifecycleDialog === 'retire' ? '販売を停止しますか' : '販売を再開しますか'}
            </h2>
            <p id={`lifecycle-product-description-${optionId}`} className="mt-3 text-sm leading-6 text-ink-soft">
              {lifecycleDialog === 'retire'
                ? <>「{optionName}」を新しい見積・シミュレーターの選択候補から外します。標準構成に含まれる場合は、その仕様の新しい受付が停止します。保存済みの内容や発行済み見積は変更されません。</>
                : <>「{optionName}」を新しい見積で再び選択可能にします。仕様・供給・価格を確認してから再開してください。</>}
            </p>
            <form action={setProductLifecycleAction} className="mt-5 space-y-4">
              <input type="hidden" name="id" value={optionId} />
              <input type="hidden" name="action" value={lifecycleDialog} />
              <input type="hidden" name="expected_updated_at" value={expectedUpdatedAt} />
              {lifecycleDialog === 'resume' && (
                <label className="flex items-start gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" name="resume_confirmed" value="1" required className="mt-1" />
                  仕様・供給・価格を確認しました
                </label>
              )}
              <div className="flex justify-end gap-2">
                <button ref={cancelButtonRef} type="button" className="btn-secondary btn-sm min-w-24" onClick={closeLifecycleDialog}>キャンセル</button>
                <button type="submit" className="btn-primary btn-sm min-w-24">
                  {lifecycleDialog === 'retire' ? '販売を停止する' : '販売を再開する'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {deleteDialogOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteDialog();
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-product-title-${optionId}`}
            aria-describedby={`delete-product-description-${optionId}`}
            className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-danger">
                <Trash2 className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h2 id={`delete-product-title-${optionId}`} className="text-lg font-semibold text-ink">
                  {isDraft ? '下書きを削除しますか' : '登録済み商品を削除しますか'}
                </h2>
                <p id={`delete-product-description-${optionId}`} className="mt-2 text-sm leading-6 text-ink-soft">
                  {isDraft
                    ? <>「{optionName}」を完全に削除します。この操作は元に戻せません。</>
                    : <>「{optionName}」が保存済み仕様・見積・標準見積・履歴・商品ルールなどで一度も使われていない場合だけ完全に削除します。使用済みの場合は削除されません。この操作は元に戻せません。</>}
                </p>
              </div>
            </div>

            <form action={deleteAction} className="mt-6 flex justify-end gap-2">
              <input type="hidden" name="id" value={optionId} />
              {isPublished && <input type="hidden" name="return_to" value="/admin/ledger" />}
              <button
                ref={cancelButtonRef}
                type="button"
                className="btn-secondary btn-sm min-w-24"
                onClick={closeDeleteDialog}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="inline-flex min-h-9 min-w-24 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
              >
                削除する
              </button>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
