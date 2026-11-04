import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';

type CostRow = {
  standard_cost: number;
  lock_version: number;
};

type VersionRow = {
  id: string;
  version_no: number;
  standard_cost: number;
  change_reason: string;
  created_at: string;
  superseded_at: string | null;
};

type Props = {
  optionId: string;
  canManage: boolean;
  cost: CostRow | null;
  /** 標準原価の Version（新しい順）。Version の表がまだ DB に無い間は null */
  versions?: VersionRow[] | null;
  /** 商品台帳の商品標準原価（options.price）。別途見積なら null。記録とのずれの確認に使う */
  ledgerCost?: number | null;
  /** 登録済み（公開中）の商品か。下書きは登録のときに記録する */
  isPublished?: boolean;
};

const VERSION_HISTORY_LIMIT = 20;

/**
 * 商品標準原価の記録（本部だけ）。v2.5 PR-A3 で入力欄は「6. 価格・対象モデル」の商品標準原価にひとつにした
 * （同じ金額を二重に入力しない）。ここは今の版と変更履歴を見るだけ。
 */
export function OptionHqStandardCostCard({ optionId, canManage, cost, versions = null, ledgerCost, isPublished = false }: Props) {
  const currentCost = cost?.standard_cost;
  const currentCostVersion = versions?.find((version) => version.superseded_at === null) ?? null;
  const mismatch =
    isPublished && ledgerCost !== undefined && ledgerCost !== null && ledgerCost > 0 && versions !== null && ledgerCost !== currentCost;

  return (
    <section className="card space-y-3 p-4 sm:p-5" data-testid="option-hq-standard-cost-card" data-option-id={optionId}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-brown">本部内部情報</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">商品標準原価の記録（税別）</h2>
            <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${
              currentCost === undefined
                ? 'bg-[#fff1cf] text-[#7c5a18]'
                : 'bg-[#eaf6f1] text-[#245a48]'
            }`}>
              {currentCost === undefined ? '未記録' : '記録済み'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            金額は「6. 価格・対象モデル」の商品標準原価（税別）で入力します。登録済みの商品は、本部が保存・登録すると同じ金額で新しい版を作ります（下書きは登録のときに作ります）。
            実仕入価格・案件実原価ではありません。既存の見積・発行済みQuoteには自動反映されません。
            {versions !== null && ' 過去の版は書き換えません。'}
          </p>
        </div>

        <div className="shrink-0 rounded-xl border border-line bg-sand/20 px-3 py-2 sm:min-w-56">
          <p className="text-[0.7rem] text-muted">現在の版</p>
          <p className="mt-0.5 font-semibold tabular-nums">
            {currentCost === undefined ? '未記録' : formatYen(currentCost)}
          </p>
          {currentCostVersion && (
            <p className="mt-0.5 text-[0.7rem] text-muted" data-testid="option-hq-standard-cost-version">
              第{currentCostVersion.version_no}版（{formatDate(currentCostVersion.created_at)}）
            </p>
          )}
        </div>
      </div>

      {mismatch && (
        <p className="rounded-lg border border-[#e6c97a] bg-[#fff8e6] px-3 py-2 text-xs leading-5 text-[#7c5a18]" data-testid="option-hq-standard-cost-mismatch">
          商品台帳の商品標準原価（{formatYen(ledgerCost)}）と記録が違います。{canManage ? '「原価 Version の取り込み」の画面から記録できます。' : '本部が記録します。'}
        </p>
      )}

      {!canManage && (
        <p className="border-t border-line pt-3 text-xs text-muted">
          この権限では閲覧のみです。
        </p>
      )}

      {versions !== null && versions.length > 0 && (
        <details className="border-t border-line pt-3" data-testid="option-hq-standard-cost-history">
          <summary className="cursor-pointer text-xs font-semibold text-brown">
            変更履歴（{versions.length >= VERSION_HISTORY_LIMIT ? `新しい${VERSION_HISTORY_LIMIT}件` : `${versions.length}件`}）
          </summary>
          <ol className="mt-2 space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="grid gap-1 rounded-lg border border-line px-3 py-2 text-sm sm:grid-cols-[6rem_8rem_8rem_minmax(0,1fr)] sm:items-baseline sm:gap-3"
              >
                <span className="text-xs font-semibold">
                  第{version.version_no}版{version.superseded_at === null ? '（現在）' : ''}
                </span>
                <span className="font-semibold tabular-nums">{formatYen(version.standard_cost)}</span>
                <span className="text-xs text-muted tabular-nums">{formatDate(version.created_at, true)}</span>
                <span className="min-w-0 break-words text-xs text-muted">{version.change_reason}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
