'use client';

import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { deleteUnusedPublishedOptionAction } from '@/lib/actions/unused-published-product-delete';

/** 登録済み商品だけの操作。選択項目・選択肢の編集欄には表示しない。 */
export function PublishedOptionDeleteControl({ optionId }: { optionId: string }) {
  return (
    <details className="mt-6 rounded-xl border border-line bg-white" data-testid="published-option-delete-control">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">商品全体の操作</summary>
      <div className="border-t border-line px-4 py-4">
        <p className="text-sm font-semibold text-ink">登録済み商品の削除（未使用のみ）</p>
        <p className="mt-2 text-xs leading-5 text-muted">
          これは色・柄などの選択肢ではなく、商品全体を削除する操作です。
          保存済み仕様・見積・標準見積・履歴・商品ルールで一度も使われていない商品だけ削除できます。
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
    </details>
  );
}
