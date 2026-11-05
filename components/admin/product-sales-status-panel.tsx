'use client';

import { setProductDiscontinuedAction, setProductLifecycleAction } from '@/lib/actions/product-lifecycle';
import { productLedgerStateLabel, productSalesState } from '@/lib/domain/product-lifecycle';
import type { ProductOption } from '@/lib/domain/types';
import { Badge } from '@/components/ui';

/**
 * 商品台帳の「商品状態」：販売停止・販売の再開・廃番・廃番の取り消し（2026-10-19 の先方回答）。
 * 判定・権限は DB（options_lifecycle_guard・set_option_discontinued）が行い、ここは操作の入口と案内だけ。
 */
export function ProductSalesStatusPanel({
  option,
  canEdit,
  lifecycleEnabled,
  discontinueEnabled,
  canRestoreDiscontinued,
}: {
  option: ProductOption;
  canEdit: boolean;
  /** 販売停止・シミュレーター表示の操作を出してよいか（20261015110000・113000 が適用済みか） */
  lifecycleEnabled: boolean;
  /** 廃番の操作を出してよいか（20261016112000 が適用済みか） */
  discontinueEnabled: boolean;
  /** 廃番を取り消せるのは本部の管理者だけ */
  canRestoreDiscontinued: boolean;
}) {
  const state = productSalesState(option);
  const operable = canEdit && lifecycleEnabled && option.status === 'published';

  return (
    <section className="card p-4" aria-labelledby="ledger-handling-status-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ledger-handling-status-title" className="font-semibold">商品状態</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            下書き・登録済み・販売停止・廃番の4状態で管理します。販売停止は再開でき、廃番は原則再開しません。販売停止・廃番の商品も商品台帳では編集・確認できます。
          </p>
        </div>
        <Badge tone={state === 'registered' ? 'success' : 'neutral'}>{productLedgerStateLabel(option)}</Badge>
      </div>

      {operable && state === 'registered' && (
        <form action={setProductLifecycleAction} className="mt-3 border-t border-line pt-3">
          <input type="hidden" name="id" value={option.id} />
          <input type="hidden" name="action" value="retire" />
          <input type="hidden" name="expected_updated_at" value={option.updated_at} />
          <button type="submit" className="btn-secondary btn-sm" data-testid="ledger-retire-product">販売を停止する</button>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            新しい見積・シミュレーターの候補から外します。公開中の標準見積や本体の仕様（標準の商品構成）で使っていても止められます。
            その場合、その仕様は新しい受付を止め、別の商品に自動で差し替えません（確認済みの構成で標準見積・仕様を直すと受付を再開できます）。過去の保存内容や発行済み見積は変更しません。
          </p>
        </form>
      )}

      {operable && state === 'stopped' && (
        <div className="mt-3 space-y-4 border-t border-line pt-3">
          <form action={setProductLifecycleAction} className="space-y-2">
            <input type="hidden" name="id" value={option.id} />
            <input type="hidden" name="action" value="resume" />
            <input type="hidden" name="expected_updated_at" value={option.updated_at} />
            <label className="flex items-start gap-2 text-xs font-semibold text-ink">
              <input type="checkbox" name="resume_confirmed" value="1" required className="mt-0.5" data-testid="ledger-resume-confirm" />
              仕様・供給・価格を確認しました
            </label>
            <button type="submit" className="btn-primary btn-sm" data-testid="ledger-resume-product">販売を再開する</button>
            <p className="text-xs text-muted">再開すると、新しい見積で再び選択できるようになります。シミュレーター表示設定は以前の値を保持します。</p>
          </form>
          {discontinueEnabled && (
            <form action={setProductDiscontinuedAction} className="space-y-2 rounded-lg border border-line bg-sand/40 p-3">
              <input type="hidden" name="id" value={option.id} />
              <input type="hidden" name="mode" value="discontinue" />
              <input type="hidden" name="expected_updated_at" value={option.updated_at} />
              <label className="block text-xs font-semibold text-ink" htmlFor="ledger-discontinue-reason">廃番にする理由（必須）</label>
              <textarea
                id="ledger-discontinue-reason"
                name="reason"
                required
                maxLength={500}
                rows={2}
                className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
                placeholder="例：メーカーの生産終了"
                data-testid="ledger-discontinue-reason"
              />
              <button type="submit" className="btn-secondary btn-sm" data-testid="ledger-discontinue-product">廃番にする</button>
              <p className="text-xs text-muted">廃番は原則再開しません。誤って廃番にした場合は、本部の管理者が理由を記録して取り消せます（取り消すと販売停止に戻ります）。</p>
            </form>
          )}
        </div>
      )}

      {state === 'discontinued' && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-xs text-muted">廃番の商品は販売を再開できません。</p>
          {operable && discontinueEnabled && canRestoreDiscontinued && (
            <form action={setProductDiscontinuedAction} className="space-y-2 rounded-lg border border-line bg-sand/40 p-3">
              <input type="hidden" name="id" value={option.id} />
              <input type="hidden" name="mode" value="restore" />
              <input type="hidden" name="expected_updated_at" value={option.updated_at} />
              <label className="block text-xs font-semibold text-ink" htmlFor="ledger-restore-reason">廃番を取り消す理由（必須・本部の管理者だけ）</label>
              <textarea
                id="ledger-restore-reason"
                name="reason"
                required
                maxLength={500}
                rows={2}
                className="w-full rounded-md border border-line px-2 py-1.5 text-xs"
                placeholder="例：誤って廃番にした"
                data-testid="ledger-restore-reason"
              />
              <button type="submit" className="btn-secondary btn-sm" data-testid="ledger-restore-product">廃番を取り消す（販売停止に戻す）</button>
              <p className="text-xs text-muted">取り消しても販売は再開しません。販売を再開するときは、仕様・供給・価格を確認してから「販売を再開する」を行います。</p>
            </form>
          )}
        </div>
      )}

      {option.status === 'draft' && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">下書きは販売停止にしません。不要なら参照状況を確認して削除します。</p>
      )}
    </section>
  );
}
