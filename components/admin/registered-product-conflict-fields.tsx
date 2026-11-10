'use client';

import { useState } from 'react';
import { Checkbox, Input, Select } from '@/components/ui';
import type { OptionConflict } from '@/lib/domain/types';

export type ProductConflictCandidate = {
  id: string;
  name: string;
  categoryCode: string;
  categoryName: string;
};

type Props = {
  conflicts: OptionConflict[];
  candidates: ProductConflictCandidate[];
  optionCategoryCode: string;
};

/**
 * Published-product STEP 1: edit existing option_conflicts relations.
 * Only checked candidates are submitted; relations not exposed by this editor
 * remain hidden and are preserved by saveOptionAction/setOptionRelations.
 */
export function RegisteredProductConflictFields({ conflicts, candidates, optionCategoryCode }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => conflicts.map((conflict) => conflict.conflicts_with_option_id)
  );
  const [categoryFilter, setCategoryFilter] = useState(
    optionCategoryCode === 'ub' && candidates.some((candidate) => candidate.categoryCode === 'toilet') ? 'toilet' : ''
  );
  const [search, setSearch] = useState('');
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const existingById = new Map(conflicts.map((conflict) => [conflict.conflicts_with_option_id, conflict]));
  const visibleCategories = new Map(candidates.map((candidate) => [candidate.categoryCode, candidate.categoryName]));
  const filtered = candidates.filter(
    (candidate) =>
      !selectedIds.includes(candidate.id) &&
      (!categoryFilter || candidate.categoryCode === categoryFilter) &&
      (!search.trim() || `${candidate.name} ${candidate.categoryName}`.toLocaleLowerCase('ja').includes(search.trim().toLocaleLowerCase('ja')))
  );
  const chosen = selectedIds.filter((id) => candidateById.has(id));

  return (
    <>
      {conflicts.filter((conflict) => !candidateById.has(conflict.conflicts_with_option_id)).map((conflict) => (
        <span key={conflict.conflicts_with_option_id} className="hidden">
          <input type="hidden" name="conflicts" value={conflict.conflicts_with_option_id} />
          <input type="hidden" name={`conflicts_message_${conflict.conflicts_with_option_id}`} value={conflict.message ?? ''} />
        </span>
      ))}
      {candidates.length > 0 && (
        <details
          className="card p-4 sm:p-5"
          defaultOpen={chosen.length > 0}
          data-testid="registered-product-conflicts"
        >
          <summary className="cursor-pointer text-sm" data-testid="registered-product-conflicts-summary">
            <span className="font-semibold">組合せ制限・設備の重複防止</span>
            <span className="ml-2 text-xs text-muted">設定中 {chosen.length}件</span>
            <span className="mt-1 block text-xs text-muted">
              {chosen.length > 0
                ? chosen.map((id) => candidateById.get(id)?.name).filter(Boolean).join('、')
                : '設定なし（必要なときだけ開く）'}
            </span>
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-xs leading-5 text-muted">
              この商品と同時に選べない商品を指定します。トイレや洗面器を含む一体型商品などの、個別の例外条件に使用します。
            </p>
            <p className="text-xs leading-5 text-muted">
            設定すると同時選択を制限します。既に選択中の単体設備を自動で外す機能ではありません。
            標準構成からの変更操作にも影響します。別室に追加する設備まで禁止しないよう、実際の用途を確認してください。
          </p>

          <div className="space-y-2" data-testid="registered-product-conflicts-selected">
            <p className="text-xs font-semibold text-ink">設定中の商品（{chosen.length}件）</p>
            {chosen.length ? chosen.map((id) => {
              const candidate = candidateById.get(id)!;
              return (
                <div key={id} className="rounded-lg border border-line bg-ivory/25 p-3">
                  <Checkbox
                    name="conflicts"
                    value={id}
                    checked
                    onChange={() => setSelectedIds((current) => current.filter((value) => value !== id))}
                    label={<span>{candidate.name}<span className="ml-2 text-xs text-muted">{candidate.categoryName}</span></span>}
                  />
                  <label className="mt-2 block pl-6 text-xs text-muted">
                    選択できない理由（任意）
                    <Input
                      name={`conflicts_message_${id}`}
                      defaultValue={existingById.get(id)?.message ?? ''}
                      placeholder="例：トイレが含まれるため、単体トイレとは同時に選べません。"
                      className="mt-1 text-xs"
                    />
                  </label>
                </div>
              );
            }) : <p className="text-xs text-muted">現在設定されていません。</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-ink">
              商品カテゴリー
              <Select className="mt-1 text-sm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">すべて</option>
                {[...visibleCategories.entries()].map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </Select>
            </label>
            <label className="text-xs font-semibold text-ink">
              商品名で検索
              <Input type="search" className="mt-1 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="商品名を入力" />
            </label>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-white p-2" data-testid="registered-product-conflicts-candidates">
            {filtered.length ? filtered.map((candidate) => (
              <div key={candidate.id} className="rounded-md px-2 py-2 hover:bg-sand/40">
                <Checkbox
                  checked={false}
                  onChange={() => setSelectedIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id])}
                  label={<span>{candidate.name}<span className="ml-2 text-xs text-muted">{candidate.categoryName}</span></span>}
                />
              </div>
            )) : <p className="p-3 text-xs text-muted">該当する商品はありません。</p>}
          </div>
          </div>
        </details>
      )}
    </>
  );
}
