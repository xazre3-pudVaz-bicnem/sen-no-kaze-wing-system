import { formatYen } from '@/lib/domain/pricing';
import type { PricingResult, PricingSectionCode } from '@/lib/domain/pricing-v25';

type Props = {
  /** 保存前は画面の参考試算。正式値は保存先DB/RPCが決める。 */
  result: PricingResult | null;
  savedTotal: number | null;
  unpricedCount: number;
  incompleteCostCount: number;
  /** 下書きの調整額。金額計算は親の既存試算だけが行う。 */
  adjustmentValue?: string;
  onAdjustmentChange?: (value: string) => void;
  readOnly?: boolean;
};

const SECTION_LABELS: Record<PricingSectionCode, string> = {
  base: '本体',
  interior_exterior: '内外装工事',
  option: 'オプション',
  sitework: '別途工事',
};

const formatAmount = (amount: number | null | undefined) =>
  amount === null || amount === undefined ? '未確定' : formatYen(amount);

/**
 * 旧画面で見やすかった金額内訳を、v2.5 の計算「結果」だけで表示する。
 * 金額の再計算、原価・粗利の推定、保存payloadの変更はしない。
 */
export function StandardEstimateV25AmountBreakdown({
  result,
  savedTotal,
  unpricedCount,
  incompleteCostCount,
  adjustmentValue,
  onAdjustmentChange,
  readOnly = true,
}: Props) {
  const omitted = unpricedCount + incompleteCostCount;
  const partiallyUnknown = omitted > 0 || Boolean(result?.has_por);

  return (
    <section
      aria-labelledby="v25-amount-breakdown-title"
      className="rounded-lg border border-slate-200 bg-white p-3 text-xs"
      data-testid="v25-amount-breakdown"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <h3 id="v25-amount-breakdown-title" className="text-sm font-semibold text-slate-900">
          金額内訳
        </h3>
        <span className="text-slate-500">画面の試算（参考）と保存済み金額（DB）を区別して表示</span>
      </div>

      {partiallyUnknown && (
        <p role="status" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900" data-testid="v25-amount-breakdown-incomplete">
          {result?.has_por ? '別途見積が含まれています。' : ''}
          {omitted > 0 ? `売価未入力 ${unpricedCount} 件、商品原価未設定 ${incompleteCostCount} 件は試算から除外されています。` : ''}
          金額がすべて確定した状態ではありません。
        </p>
      )}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[27rem] border-collapse text-right tabular-nums leading-5" data-testid="v25-amount-breakdown-table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">区分</th>
              <th scope="col" className="px-2 py-1.5 font-medium">明細売価（税別）</th>
              <th scope="col" className="px-2 py-1.5 font-medium">経費</th>
              <th scope="col" className="px-2 py-1.5 font-medium">区分計（税別）</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(SECTION_LABELS) as PricingSectionCode[]).map((code) => {
              const section = result?.sections.find((item) => item.code === code);
              return (
                <tr key={code} className="border-b border-slate-100" data-testid={`v25-amount-breakdown-${code}`}>
                  <th scope="row" className="px-2 py-1 text-left font-medium text-slate-800">
                    {SECTION_LABELS[code]}
                    {section?.has_por && <span className="ml-1 font-normal text-amber-800">（未確定あり）</span>}
                  </th>
                  <td className="px-2 py-1">
                    {section ? formatYen(section.priced_subtotal) : '—'}
                    {section?.has_por && <span className="ml-1 text-amber-800">＋未確定</span>}
                  </td>
                  <td className="px-2 py-1">{section ? formatAmount(section.expense) : '—'}</td>
                  <td className="px-2 py-1 font-medium text-slate-900">{section ? formatAmount(section.total) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <th scope="row" colSpan={3} className="px-2 py-2 text-right font-medium">税別小計（経費込み）</th>
              <td className="px-2 py-1.5 font-medium">{result ? formatAmount(result.subtotal) : '—'}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3} className="px-2 py-1.5 text-right font-medium">調整額（税別）</th>
              <td className="px-2 py-1.5">
                {!readOnly && onAdjustmentChange && adjustmentValue !== undefined ? (
                  <input type="text" inputMode="numeric" value={adjustmentValue} aria-label="金額内訳の調整額（税別・円）"
                    data-testid="v25-amount-breakdown-adjustment"
                    className="h-7 w-full max-w-[9rem] rounded border border-slate-300 bg-white px-2 text-right text-xs tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    onChange={(event) => onAdjustmentChange(event.target.value)} />
                ) : (result ? formatAmount(result.adjustment) : '—')}
              </td>
            </tr>
            <tr>
              <th scope="row" colSpan={3} className="px-2 py-1.5 text-right font-medium">調整後税別額</th>
              <td className="px-2 py-1.5">{result ? formatAmount(result.adjusted_subtotal) : '—'}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3} className="px-2 py-1.5 text-right font-medium">消費税</th>
              <td className="px-2 py-1.5">{result ? formatAmount(result.tax) : '—'}</td>
            </tr>
            <tr className="border-t-2 border-emerald-700 bg-emerald-50" data-testid="v25-amount-breakdown-trial-row">
              <th scope="row" colSpan={3} className="px-2 py-2 text-right text-sm font-semibold text-emerald-950">税込合計（画面の試算）</th>
              <td className="px-2 py-2 text-base font-bold text-emerald-950" data-testid="v25-amount-breakdown-total">
                {result ? formatAmount(result.total) : '—'}
                {omitted > 0 && result?.total !== null && result?.total !== undefined &&
                  <span className="block text-[10px] font-normal text-amber-800">一部明細を除く</span>}
              </td>
            </tr>
            <tr className="border-b border-slate-200 bg-slate-50" data-testid="v25-amount-breakdown-saved-row">
              <th scope="row" colSpan={3} className="px-2 py-2 text-right font-medium text-slate-700">保存済み税込合計（DB）</th>
              <td className="px-2 py-2 font-semibold text-slate-900" data-testid="v25-amount-breakdown-saved-total">
                {savedTotal === null ? '未確定' : formatYen(savedTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5" data-testid="v25-amount-breakdown-profit-pending">
        <span className="font-medium text-slate-700">原価合計・粗利・粗利率</span>
        <span className="font-semibold text-slate-700">未算定</span>
      </div>
      <p className="mt-1 text-[10px] leading-5 text-slate-500">
        v2.5の試算結果では、手動売価の明細などに正式な原価がありません。
        原価・粗利を推測表示せず、金額正本と粗利定義の確認後に対応します。
      </p>
    </section>
  );
}
