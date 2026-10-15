import type { ProductOption } from '@/lib/domain/types';
import {
  hasProductLifecycleColumns,
  isOptionArchived,
  type ProductLifecycleOption,
} from '@/lib/domain/product-lifecycle';
import {
  endOptionHandlingAction,
  resumeOptionHandlingAction,
  setOptionSimulatorVisibilityAction,
} from '@/lib/actions/product-lifecycle';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';

export function ProductLifecycleControls({
  option,
  canEdit,
}: {
  option: ProductOption;
  canEdit: boolean;
}) {
  const lifecycleOption = option as ProductLifecycleOption;
  const supported = hasProductLifecycleColumns(lifecycleOption);
  const registered = option.status === 'published';
  const archived = isOptionArchived(lifecycleOption);
  const simulatorVisible = lifecycleOption.simulator_visible !== false;

  if (!registered) {
    return (
      <section className="card p-4" data-testid="product-lifecycle-controls">
        <h2 className="font-semibold">商品状態</h2>
        <p className="mt-2 text-sm text-muted">
          下書きです。正式登録するまでは見積・シミュレーターの新規選択肢には表示されません。不要な下書きは削除できます。
        </p>
      </section>
    );
  }

  return (
    <section className="card p-4" data-testid="product-lifecycle-controls">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">商品状態・利用先</h2>
          <p className="mt-1 text-xs text-muted">
            登録済みの商品は見積で選択できます。シミュレーター表示だけを別に設定できます。
          </p>
        </div>
        <span
          className={
            'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' +
            (archived ? 'bg-sand text-muted' : 'bg-[#edf3f0] text-[#315745]')
          }
        >
          {archived ? '取扱終了' : '登録済み'}
        </span>
      </div>

      {!supported && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          商品状態のDB反映待ちです。migration適用後にこの画面から設定できます。
        </p>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <form action={setOptionSimulatorVisibilityAction} className="rounded-lg border border-line p-3">
          <input type="hidden" name="option_id" value={option.id} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="simulator_visible"
              defaultChecked={simulatorVisible}
              disabled={!canEdit || !supported || archived}
              className="mt-0.5"
            />
            <span>
              <strong className="block font-semibold">シミュレーターに表示する</strong>
              <span className="mt-0.5 block text-xs text-muted">
                OFFでも、登録済み・取扱中であれば見積の商品選択では利用できます。
              </span>
            </span>
          </label>
          <button
            type="submit"
            className="btn-secondary btn-sm mt-3"
            disabled={!canEdit || !supported || archived}
          >
            表示設定を保存
          </button>
        </form>

        <div className="rounded-lg border border-line p-3">
          <p className="text-sm font-semibold">取扱状態</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {archived
              ? '新しい見積・シミュレーターでは選べません。過去の案件・見積・履歴はそのまま残ります。'
              : '取扱終了にすると新規の見積・シミュレーターから外れます。過去履歴は削除しません。'}
          </p>
          {archived ? (
            <form action={resumeOptionHandlingAction} className="mt-3">
              <input type="hidden" name="option_id" value={option.id} />
              <button
                type="submit"
                className="btn-secondary btn-sm"
                disabled={!canEdit || !supported}
              >
                取扱を再開する
              </button>
            </form>
          ) : (
            <form action={endOptionHandlingAction} className="mt-3">
              <input type="hidden" name="option_id" value={option.id} />
              <ConfirmSubmit
                className="btn-secondary btn-sm"
                disabled={!canEdit || !supported}
                message="この商品を取扱終了にします。新しい見積・シミュレーターの候補から外れますが、過去履歴は残ります。よろしいですか？"
              >
                取扱を終了する
              </ConfirmSubmit>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
