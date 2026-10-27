import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/session';
import { importOptionCostsAction } from '@/lib/actions/option-cost-import';
import {
  loadCostImportCandidates,
  type CostImportChoice,
  type CostImportProduct,
  type CostImportProductState,
} from '@/lib/data/option-cost-import';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Field, Textarea } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';

export const metadata: Metadata = { title: '原価 Version の取り込み | 管理画面', robots: { index: false } };

const STATE_LABEL: Record<CostImportProductState, string> = {
  import: '取り込む',
  no_model: 'メーカー・型番なし',
  archived: '取扱終了',
  same: '記録済み',
  zero: '0円・未設定',
  por: '別途見積',
};

const SELECTABLE: CostImportProductState[] = ['import', 'no_model', 'archived'];
const DEFAULT_REASON = '既存の商品価格・追加金額を初期の原価 Version へ取り込み（2026-10-27 方針）';

function yen(value: number | null) {
  return value === null ? '—' : formatYen(value);
}

function ChoiceRows({ product }: { product: CostImportProduct }) {
  const productSelectable = SELECTABLE.includes(product.state) || product.state === 'same';
  return (
    <>
      {product.choices.map((choice: CostImportChoice) => {
        const selectable = productSelectable && choice.state === 'import';
        return (
          <tr key={choice.id} className="border-t border-line/60 bg-ivory/20 text-xs">
            <td className="px-2 py-1.5 text-center">
              {selectable ? (
                <input
                  type="checkbox"
                  name="item"
                  value={`choice:${choice.id}:${choice.amount}`}
                  defaultChecked={product.state === 'import' || product.state === 'same'}
                  aria-label={`${product.name} ${choice.groupName} ${choice.name} を取り込む`}
                />
              ) : null}
            </td>
            <td className="px-2 py-1.5 pl-6 text-ink-soft">
              └ {choice.groupName}：{choice.name}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums">{choice.state === 'por' ? '別途見積' : `差額 ${formatYen(choice.amount)}`}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">{choice.currentAmount === null ? '—' : `差額 ${formatYen(choice.currentAmount)}`}</td>
            <td className="px-2 py-1.5">{choice.state === 'import' ? '取り込む' : choice.state === 'same' ? '記録済み' : '別途見積'}</td>
          </tr>
        );
      })}
    </>
  );
}

export default async function OptionCostImportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin('/admin/options/cost-import');
  const sp = await searchParams;
  const candidates = await loadCostImportCandidates();

  if (!candidates.available) {
    return (
      <AdminPage title="原価 Version の取り込み">
        <BackLink href="/admin/ledger" label="商品台帳へ戻る" />
        <Alert tone="warn">
          {candidates.reason === 'forbidden'
            ? '原価の取り込みは本部だけが行えます。'
            : candidates.reason === 'error'
              ? '原価の権限を確認できませんでした。時間をおいて開き直してください。'
              : '原価 Version の DB 機能が未反映です（ローカル検証モード、または v2.5 の migration が未適用）。'}
        </Alert>
      </AdminPage>
    );
  }

  const products = candidates.products;
  const count = (state: CostImportProductState) => products.filter((product) => product.state === state).length;
  const choiceCount = products.reduce((sum, product) => sum + product.choices.filter((choice) => choice.state === 'import').length, 0);

  return (
    <AdminPage
      title="原価 Version の取り込み"
      lead="登録済みの商品の商品価格・選択肢の追加金額を、初期の商品標準原価・原価差額の Version へ取り込みます（本部だけ）。"
    >
      <BackLink href="/admin/ledger" label="商品台帳へ戻る" />
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.imported !== undefined && (
        <Alert tone="success">
          取り込みました（新しく記録 {sp.imported} 件・同じ金額で記録済み {sp.unchanged ?? 0} 件）。
        </Alert>
      )}

      <section className="card space-y-2 p-4 text-sm leading-6 sm:p-5">
        <h2 className="font-semibold">取り込みの決まり</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>今の商品価格・追加金額の値と列はそのまま残します（旧シミュレーターは今までどおり）。</li>
          <li>対象は登録済みの商品とその選択肢です。下書きの商品は、登録（公開）のときに記録します。</li>
          <li>0円・未設定と別途見積の商品は取り込みません（価格未確認の0円と区別できないため）。</li>
          <li>メーカー・型番が未登録の商品（8月の初期データの「エアコン」など総称の仮の商品を含む）と取扱終了の商品は、初期値では選んでいません（2026-10-13 の「メーカー・型番が入っていて商品が確定しているものだけ原価として扱う」と同じ基準）。必要なものだけ選んでください。</li>
          <li>選択肢の0円は「標準と同じ（差額0円）」として取り込みます。別途見積の選択肢は取り込みません。</li>
          <li>この画面を開いた後に金額が変わった商品・選択肢があると、取り込みは止まります（何も記録しません）。開き直してから実行してください。</li>
        </ul>
      </section>

      <section className="card p-4 sm:p-5" data-testid="cost-import-summary">
        <h2 className="font-semibold">件数</h2>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(['import', 'no_model', 'archived', 'same', 'zero', 'por'] as CostImportProductState[]).map((state) => (
            <div key={state} className="rounded-lg border border-line px-3 py-2">
              <dt className="text-xs text-muted">{STATE_LABEL[state]}</dt>
              <dd className="font-semibold tabular-nums">{count(state)} 件</dd>
            </div>
          ))}
          <div className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">選択肢（取り込む）</dt>
            <dd className="font-semibold tabular-nums">{choiceCount} 件</dd>
          </div>
        </dl>
      </section>

      <form action={importOptionCostsAction} className="card space-y-4 p-4 sm:p-5" data-testid="cost-import-form">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="w-12 px-2 py-1.5 text-center">選ぶ</th>
                <th className="px-2 py-1.5">商品</th>
                <th className="w-32 px-2 py-1.5 text-right">今の金額（税別）</th>
                <th className="w-32 px-2 py-1.5 text-right">記録（現在の版）</th>
                <th className="w-28 px-2 py-1.5">状態</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <ProductRows key={product.id} product={product} />
              ))}
            </tbody>
          </table>
        </div>
        <Field label="取り込みの理由" htmlFor="cost-import-reason" required hint="原価の Version の履歴に残ります（1〜500文字）。">
          <Textarea id="cost-import-reason" name="change_reason" defaultValue={DEFAULT_REASON} minLength={1} maxLength={500} required />
        </Field>
        <div className="flex justify-end">
          <ConfirmSubmit
            message="選んだ商品・選択肢の金額を、原価の Version として記録します。記録した版は書き換えられません（変更は新しい版を作ります）。取り込みますか？"
            dialogTitle="原価 Version へ取り込みますか？"
            confirmLabel="取り込む"
          >
            選んだ商品・選択肢を取り込む
          </ConfirmSubmit>
        </div>
      </form>
    </AdminPage>
  );
}

function ProductRows({ product }: { product: CostImportProduct }) {
  const selectable = SELECTABLE.includes(product.state);
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="px-2 py-2 text-center">
          {selectable && product.amount !== null ? (
            <input
              type="checkbox"
              name="item"
              value={`option:${product.id}:${product.amount}`}
              defaultChecked={product.state === 'import'}
              aria-label={`${product.name} を取り込む`}
            />
          ) : null}
        </td>
        <td className="px-2 py-2">
          <p className="font-semibold">{product.name}</p>
          <p className="text-xs text-muted">{[product.productNo, product.categoryName, product.maker ?? 'メーカー・型番 未登録'].filter(Boolean).join(' ／ ')}</p>
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{product.state === 'por' ? '別途見積' : yen(product.amount)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{yen(product.currentAmount)}</td>
        <td className="px-2 py-2 text-xs font-semibold">{STATE_LABEL[product.state]}</td>
      </tr>
      <ChoiceRows product={product} />
    </>
  );
}
