'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui';
import {
  includedEquipmentCategoryCandidates,
  splitIncludedEquipmentCategoryIds,
  type IncludedEquipmentCategoryCandidate,
} from '@/lib/domain/included-equipment-category-input';

interface Props {
  /** 商品が実際に含んでいる設備カテゴリーID（商品IDではない） */
  includedCategoryIds: readonly string[];
  /** 管理者が選択できる設備カテゴリー。表示範囲・権限は呼出元で確定する */
  candidates: readonly IncludedEquipmentCategoryCandidate[];
  ownCategoryId: string;
  /** このコンポーネントはフォームの一部。単独でDB保存しない */
  disabled?: boolean;
}

/**
 * 商品登録STEP1のための小さな入力部品。
 *
 * 保存処理はここに含めない。DB保存の原子的RPCとSTEP2差分確認が整うまでは
 * 商品登録フォームへ組み込まないこと。既存Published Revision/見積は変更しない。
 */
export function IncludedEquipmentCategoryFields({
  includedCategoryIds,
  candidates,
  ownCategoryId,
  disabled = false,
}: Props) {
  const visibleCandidates = includedEquipmentCategoryCandidates(candidates, ownCategoryId);
  const { visibleIds, preservedIds } = splitIncludedEquipmentCategoryIds(includedCategoryIds, visibleCandidates);
  const [selectedIds, setSelectedIds] = useState<string[]>(visibleIds);
  const [expanded, setExpanded] = useState(false);
  const selectedNames = visibleCandidates.filter((category) => selectedIds.includes(category.id)).map((category) => category.name);
  const totalCount = selectedIds.length + preservedIds.length;

  return (
    <details
      className="card p-4 sm:p-5"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      data-testid="included-equipment-categories"
    >
      <summary className="cursor-pointer text-sm" data-testid="included-equipment-categories-summary">
        <span className="font-semibold">この商品に含まれる設備</span>
        <span className="ml-2 text-xs text-muted">設定中 {totalCount}件</span>
        <span className="mt-1 block text-xs text-muted">
          {totalCount === 0
            ? '設定なし（必要なときだけ開く）'
            : [selectedNames.join('・'), preservedIds.length ? `その他の既存設定 ${preservedIds.length}件` : '']
              .filter(Boolean)
              .join('・')}
        </span>
      </summary>

      <div className="mt-4 space-y-3">
        <p className="text-xs leading-5 text-muted">
          この商品に一体で含まれている設備カテゴリーを選択します。例えば、3点ユニットバスにはトイレ・洗面が含まれます。
          別室に追加する設備とは区別します。
        </p>
        {preservedIds.map((id) => (
          <input key={id} type="hidden" name="included_category_ids" value={id} />
        ))}
        {preservedIds.length > 0 && (
          <p className="text-xs text-muted">
            現在の候補にない既存設定が{preservedIds.length}件あります。この画面では変更せず保持します。
          </p>
        )}
        {visibleCandidates.length > 0 ? (
          <fieldset disabled={disabled} className="grid gap-2 sm:grid-cols-2" data-testid="included-equipment-categories-choices">
            <legend className="sr-only">含まれる設備カテゴリーを選択</legend>
            {visibleCandidates.map((category) => (
              <div key={category.id} className="rounded-md border border-line bg-white px-3 py-2">
                <Checkbox
                  name="included_category_ids"
                  value={category.id}
                  checked={selectedIds.includes(category.id)}
                  onChange={() => setSelectedIds((current) =>
                    current.includes(category.id)
                      ? current.filter((id) => id !== category.id)
                      : [...current, category.id]
                  )}
                  label={category.name}
                />
              </div>
            ))}
          </fieldset>
        ) : (
          <p className="text-xs text-muted">選択可能な設備カテゴリーはありません。</p>
        )}
      </div>
    </details>
  );
}
