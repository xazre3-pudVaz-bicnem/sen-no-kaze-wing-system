'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setStandardEstimateBaselineAction } from '@/lib/actions/standard-estimates';
import { formatYen } from '@/lib/domain/pricing';
import { STANDARD_SECTION_LABEL, type StandardSectionCode } from '@/lib/domain/standard-estimate-view';
import { Alert, Button, Input, Select } from '@/components/ui';

export type BaselineCandidate = {
  id: string;
  name: string;
  categoryName: string;
  section: Exclude<StandardSectionCode, 'base'>;
  price: number;
  priceOnRequest: boolean;
  /** 標準で選ばれる選択肢（壁色など）。登録時に一緒に送る */
  defaultVariantChoiceIds: string[];
  /** 取扱終了。この Revision に保存済みの明細だけを表示・保持のために渡す（新しい行では選べない。DB でも拒否される） */
  retired?: boolean;
};

export type BaselineItemView = {
  option_id: string;
  quantity: string;
  /** 公開時に確定した価格（下書きでは保存時点の価格） */
  unit_price_snapshot: number;
  price_on_request: boolean;
  option_name: string;
  category_name: string;
  section_code: Exclude<StandardSectionCode, 'base'>;
};

type Row = { key: string; option_id: string; quantity: string };

/**
 * 標準状態の商品：シミュレーターで「標準の選択」とみなす商品。お客様が商品を変えたときの差額の基準になる。
 * 価格・区分は DB が商品台帳から決め、公開時に商品台帳の現在の価格で確定する（公開後は変わらない）。
 */
export function StandardEstimateBaselineEditor({
  revisionId,
  lockVersion,
  readOnly,
  items,
  candidates,
  suggestedOptionIds,
}: {
  revisionId: string;
  lockVersion: number;
  readOnly: boolean;
  items: BaselineItemView[];
  candidates: BaselineCandidate[];
  suggestedOptionIds: string[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => items.map((item, index) => ({ key: `${item.option_id}-${index}`, option_id: item.option_id, quantity: item.quantity })));
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const grouped = useMemo(() => {
    const map = new Map<string, BaselineCandidate[]>();
    for (const candidate of candidates.filter((row) => !row.retired)) map.set(candidate.categoryName, [...(map.get(candidate.categoryName) ?? []), candidate]);
    return [...map.entries()];
  }, [candidates]);

  const totals = (['interior_exterior', 'option', 'sitework'] as const).map((section) => ({
    section,
    amount: rows.reduce((sum, row) => {
      const candidate = candidateById.get(row.option_id);
      if (!candidate || candidate.section !== section || candidate.priceOnRequest) return sum;
      const quantity = Number(row.quantity);
      return sum + (Number.isFinite(quantity) ? Math.trunc(candidate.price * quantity) : 0);
    }, 0),
  }));

  const loadSuggested = () =>
    setRows(suggestedOptionIds.filter((id) => candidateById.has(id)).map((id, index) => ({ key: `suggested-${id}-${index}`, option_id: id, quantity: '1' })));
  const save = () =>
    startTransition(async () => {
      const result = await setStandardEstimateBaselineAction({
        revision_id: revisionId,
        expected_lock_version: lockVersion,
        items: rows
          .filter((row) => row.option_id)
          .map((row) => ({
            option_id: row.option_id,
            quantity: row.quantity,
            variant_choice_ids: candidateById.get(row.option_id)?.defaultVariantChoiceIds ?? [],
          })),
      });
      setNotice(result.ok ? { tone: 'success', text: result.message } : { tone: 'danger', text: result.error });
      if (result.ok) router.refresh();
    });

  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4" data-testid="standard-estimate-baseline">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">標準状態の商品（シミュレーターの差額の基準）</h3>
          <p className="text-xs text-muted">
            お客様がシミュレーターで商品を変えたとき、「選んだ商品の価格 − ここに登録した商品の価格」を差額にします。
            その仕様でお客様が選べる公開中の商品だけを登録できます。価格は公開時に商品台帳の価格で確定します。
          </p>
        </div>
        {!readOnly && (
          <Button type="button" variant="secondary" size="sm" onClick={loadSuggested} data-testid="standard-estimate-baseline-suggest">
            シミュレーターの標準選択を読み込む
          </Button>
        )}
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {readOnly && items.length === 0 && <Alert tone="warn">標準状態の商品が登録されていません。この標準見積はシミュレーターの価格に使われません。</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="px-2 py-1">商品</th>
              <th className="px-2 py-1">区分</th>
              <th className="px-2 py-1 text-right">数量</th>
              <th className="px-2 py-1 text-right">{readOnly ? '確定した価格' : '商品台帳の価格'}</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {readOnly
              ? items.map((item, index) => (
                  <tr key={`${item.option_id}-${index}`} className="border-t border-line">
                    <td className="px-2 py-1">
                      <span className="text-muted">{item.category_name}</span> {item.option_name}
                    </td>
                    <td className="px-2 py-1">{STANDARD_SECTION_LABEL[item.section_code]}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{item.quantity}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{item.price_on_request ? '別途お見積り' : formatYen(item.unit_price_snapshot)}</td>
                  </tr>
                ))
              : rows.map((row, index) => {
                  const candidate = candidateById.get(row.option_id);
                  return (
                    <tr key={row.key} className="border-t border-line" data-testid="standard-estimate-baseline-row">
                      <td className="px-2 py-1">
                        <Select
                          value={row.option_id}
                          aria-label="商品"
                          onChange={(e) => setRows((current) => current.map((r, i) => (i === index ? { ...r, option_id: e.target.value } : r)))}
                        >
                          <option value="">選んでください</option>
                          {candidate?.retired && (
                            <option value={candidate.id} disabled>
                              {candidate.name}（取扱終了）
                            </option>
                          )}
                          {grouped.map(([category, list]) => (
                            <optgroup key={category} label={category}>
                              {list.map((option) => (
                                <option key={option.id} value={option.id}>{option.name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-1">{candidate ? STANDARD_SECTION_LABEL[candidate.section] : '—'}</td>
                      <td className="px-2 py-1">
                        <Input
                          value={row.quantity}
                          aria-label="数量"
                          className="w-20 text-right"
                          onChange={(e) => setRows((current) => current.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r)))}
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {candidate ? (candidate.priceOnRequest ? '別途お見積り' : formatYen(candidate.price)) : '—'}
                      </td>
                      <td className="px-2 py-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
                          削除
                        </Button>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        {!readOnly ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setRows((current) => [...current, { key: `new-${current.length}-${Date.now()}`, option_id: '', quantity: '1' }])}
          >
            行を追加
          </Button>
        ) : (
          <span />
        )}
        <span className="tabular-nums text-muted">
          {totals.map((total) => `${STANDARD_SECTION_LABEL[total.section]} ${formatYen(total.amount)}`).join(' ／ ')}（参考：商品台帳の価格）
        </span>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">保存すると Revision の版が進みます。明細を編集中のときは、先に明細を保存してください。</p>
          <Button type="button" disabled={pending} onClick={save} data-testid="standard-estimate-baseline-save">
            標準状態を保存
          </Button>
        </div>
      )}
    </section>
  );
}
