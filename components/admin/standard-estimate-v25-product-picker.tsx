'use client';

import { useMemo, useState } from 'react';
import type { V25WorkbenchCandidate } from '@/lib/domain/standard-estimate-v25-workbench';
import type { V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import { Button, Input, Select } from '@/components/ui';

type ProductPickerProps = {
  sectionLabel: string;
  candidates: V25WorkbenchCandidate[];
  currentSlot: Pick<V25SlotRow, 'option_id' | 'variant_choices'> | null;
  requireCategory?: boolean;
  replaceLineName?: string;
  onChoose: (candidate: V25WorkbenchCandidate, choices: Record<string, string>, confirmedCategoryId?: string) => void;
  onClose: () => void;
};

/** 画面側の確認。金額・商品可否・保存の正本は従来どおりDB。 */
export function v25PickerChoicesValid(
  candidate: Pick<V25WorkbenchCandidate, 'variantGroups'>,
  choices: Readonly<Record<string, string>>
): boolean {
  return candidate.variantGroups.every((group) =>
    !choices[group.id] || group.choices.some((choice) => choice.id === choices[group.id])
  );
}

/**
 * 「商品選択→仕様選択→明細へ反映」を既存のポップアップ内で行う。
 * 検索・選択中はローカルstateのみ。確定まで親の明細stateに触れない。
 */
export function StandardEstimateV25ProductPicker({
  sectionLabel, candidates, currentSlot, requireCategory = false, replaceLineName, onChoose, onClose,
}: ProductPickerProps) {
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});

  const categories = useMemo(() => {
    const found = new Map<string, string>();
    for (const candidate of candidates) found.set(candidate.categoryId, candidate.categoryName);
    return [...found.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [candidates]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP');
    return candidates.filter((candidate) =>
      (!requireCategory || Boolean(categoryId)) &&
      (!categoryId || candidate.categoryId === categoryId) &&
      (!normalized || [candidate.name, candidate.manufacturer, candidate.modelNo, candidate.categoryName].join(' ').toLocaleLowerCase('ja-JP').includes(normalized))
    );
  }, [candidates, categoryId, query, requireCategory]);

  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const current = currentSlot ? candidates.find((candidate) => candidate.id === currentSlot.option_id) ?? null : null;
  const choicesValid = selected ? v25PickerChoicesValid(selected, choices) : false;
  const hasUnselectedChoices = selected?.variantGroups.some((group) => !choices[group.id]) ?? false;

  const inspect = (candidate: V25WorkbenchCandidate) => {
    setSelectedId(candidate.id);
    // 同じ商品を選び直す場合は、設定済みの色・サイズなどを保持する。
    const previousChoices = candidate.id === currentSlot?.option_id ? currentSlot.variant_choices : candidate.defaultChoices;
    setChoices(Object.fromEntries(candidate.variantGroups.map((group) => [group.id, previousChoices[group.id] ?? ''])));
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="商品台帳から選ぶ"
      data-testid="v25-wb-product-picker"
      className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
      onClick={(event) => event.stopPropagation()}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{sectionLabel}：{requireCategory ? '旧明細を商品に置き換える' : currentSlot ? '商品を変更' : '商品を追加'}</h2>
          {requireCategory && <p className="text-xs text-muted">元の明細：{replaceLineName || '要確認'}。対応する商品カテゴリーを選んでください。</p>}
          {currentSlot && <p className="truncate text-xs text-muted" title={current?.name ?? ''}>現在：{current?.name ?? '登録中の商品'}</p>}
        </div>
        <button type="button" className="shrink-0 text-sm text-muted underline" onClick={onClose}>閉じる</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-line px-3 py-2">
            <Select aria-label="カテゴリー" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSelectedId(null); setChoices({}); }}
              className="h-8 text-xs">
              <option value="">{requireCategory ? '置換先カテゴリーを選択（必須）' : 'すべてのカテゴリー'}</option>
              {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
            <Input aria-label="商品を検索" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="商品名・メーカー・型番" className="h-8 min-w-[10rem] flex-1 text-xs" />
          </div>
          {requireCategory && !categoryId && (
            <p className="px-3 py-2 text-xs text-amber-800" data-testid="v25-wb-replacement-category-required">旧明細に対応する商品カテゴリーを選択してください。</p>
          )}
          <ul className="min-h-0 max-h-[32vh] flex-1 divide-y divide-line overflow-y-auto md:max-h-none" data-testid="v25-wb-picker">
            {visible.map((candidate) => (
              <li key={candidate.id}>
                <button type="button" data-testid="v25-wb-picker-candidate" aria-pressed={selectedId === candidate.id}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-sand/40 ${selectedId === candidate.id ? 'bg-emerald-50 ring-1 ring-inset ring-emerald-700' : ''}`}
                  onClick={() => inspect(candidate)}>
                  <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-sand text-[10px] text-muted">
                    {candidate.imageUrl ? (
                      /* 商品台帳のメーカー画像など外部URLをそのまま表示。next/imageのホスト制約は適用しない。 */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={candidate.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                    ) : '画像なし'}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium text-ink">{candidate.name}</span>
                    <span className="block text-xs text-muted">{[candidate.categoryName, candidate.manufacturer, candidate.modelNo].filter(Boolean).join(' ／ ')}</span>
                    {currentSlot?.option_id === candidate.id && <span className="mt-1 block text-xs font-semibold text-emerald-900">現在の商品</span>}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-navy">{selectedId === candidate.id ? '選択中' : '選ぶ'}</span>
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">条件に合う商品がありません。</li>
            )}
          </ul>
        </div>
        <div className="flex min-h-0 flex-col border-t border-line md:border-l md:border-t-0">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {selected ? (
              <>
                <div>
                  <p className="text-xs font-semibold text-muted">選んだ商品と標準仕様</p>
                  <p className="mt-1 font-semibold">{selected.name}</p>
                  <p className="text-xs text-muted">{[selected.manufacturer, selected.modelNo].filter(Boolean).join(' ／ ')}</p>
                </div>
                {selected.variantGroups.length === 0 ? (
                  <p className="rounded bg-slate-50 p-2 text-xs text-muted">選択する仕様はありません。</p>
                ) : selected.variantGroups.map((group) => (
                  <label key={group.id} className="block space-y-1 text-xs">
                    <span className="font-medium">{group.name}</span>
                    <Select aria-label={group.name} data-testid="v25-wb-picker-variant"
                      value={choices[group.id] ?? ''} className="h-9 w-full text-xs"
                      onChange={(event) => setChoices((currentChoices) => ({ ...currentChoices, [group.id]: event.target.value }))}>
                      <option value="">選択してください</option>
                      {group.choices.map((choice) => (
                        <option key={choice.id} value={choice.id}>{choice.name}</option>
                      ))}
                    </Select>
                  </label>
                ))}
                {!choicesValid && <p className="text-xs text-amber-800">選択肢が有効ではありません。仕様を選び直してください。</p>}
                {choicesValid && hasUnselectedChoices && <p className="text-xs text-muted">未選択の仕様があります。必要な場合は選択してください。</p>}
              </>
            ) : (
              <p className="text-sm text-muted">左の商品を選ぶと、ここで色・サイズなどの仕様を確認できます。</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-3">
        <p className="text-xs text-muted">反映後の金額は明細の試算で確認できます。この操作では下書きは保存されません。</p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button type="button" data-testid="v25-wb-picker-apply"
            disabled={!selected || !choicesValid || (requireCategory && (!categoryId || hasUnselectedChoices))}
            onClick={() => {
              if (selected && choicesValid && (!requireCategory || (categoryId && !hasUnselectedChoices))) {
                onChoose(selected, { ...choices }, requireCategory ? categoryId : undefined);
              }
            }}>
            明細に反映
          </Button>
        </div>
      </div>
    </div>
  );
}
