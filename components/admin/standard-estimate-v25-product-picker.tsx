'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatYen } from '@/lib/domain/pricing';
import type { V25WorkbenchCandidate, V25WorkbenchCosts } from '@/lib/domain/standard-estimate-v25-workbench';
import type { V25SlotRow } from '@/lib/domain/standard-estimate-v25-view';
import type { StandardLineSectionCode } from '@/lib/domain/standard-estimate-view';
import { Button, Input, Select } from '@/components/ui';

type ProductPickerProps = {
  sectionLabel: string;
  section: StandardLineSectionCode;
  candidates: V25WorkbenchCandidate[];
  /** DBで記録された現在の商品の標準原価Version。原価が無い場合はマップに載せない。 */
  productCosts: V25WorkbenchCosts['currentProduct'];
  currentSlot: Pick<V25SlotRow, 'option_id' | 'variant_choices'> | null;
  /** 廃番・取扱終了でもカテゴリーが残っていれば、同じカテゴリーへの変更だけを許可する。 */
  originalProduct?: V25WorkbenchCandidate | null;
  onChoose: (candidate: V25WorkbenchCandidate, choices: Record<string, string>) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

/** 見積売価・メーカー参考価格とは区別し、Version未登録は0円にせず明示する。 */
export function v25PickerStandardCostLabel(cost: number | null | undefined): string {
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    ? formatYen(cost)
    : '原価未設定';
}

/** 画面側の確認。金額・商品可否・保存の正本は従来どおりDB。 */
export function v25PickerChoicesValid(
  candidate: Pick<V25WorkbenchCandidate, 'variantGroups'>,
  choices: Readonly<Record<string, string>>
): boolean {
  return candidate.variantGroups.every((group) =>
    !choices[group.id] || group.choices.some((choice) => choice.id === choices[group.id])
  );
}

/** 商品追加は区分内の販売可能品、変更は元商品と同じカテゴリーの販売可能品だけ。カテゴリー不明は安全側で拒否。 */
export function v25PickerEligibleCandidates(
  candidates: readonly V25WorkbenchCandidate[],
  section: StandardLineSectionCode,
  currentSlot: Pick<V25SlotRow, 'option_id'> | null,
  originalProduct?: V25WorkbenchCandidate | null,
): V25WorkbenchCandidate[] {
  const original = currentSlot
    ? (originalProduct?.id === currentSlot.option_id
        ? originalProduct
        : candidates.find((candidate) => candidate.id === currentSlot.option_id))
    : null;
  const originalCategory = currentSlot && original?.section === section ? original.categoryId.trim() : '';
  if (currentSlot && !originalCategory) return [];

  return candidates.filter((candidate) =>
    candidate.section === section &&
    Boolean(candidate.categoryId.trim()) &&
    !candidate.retired &&
    !candidate.unavailable &&
    (!currentSlot || candidate.categoryId === originalCategory)
  );
}

/** 固定した現在の商品をスクロール候補から除外する（新規追加では候補を変えない）。 */
export function v25PickerReplacementCandidates(
  eligibleCandidates: readonly V25WorkbenchCandidate[],
  currentSlot: Pick<V25SlotRow, 'option_id'> | null,
): V25WorkbenchCandidate[] {
  return eligibleCandidates.filter((candidate) => !currentSlot || candidate.id !== currentSlot.option_id);
}

/**
 * 「商品選択→仕様選択→明細へ反映」を既存のポップアップ内で行う。
 * 検索・選択中はローカルstateのみ。確定まで親の明細stateに触れない。
 */
export function StandardEstimateV25ProductPicker({
  sectionLabel, section, candidates, productCosts, currentSlot, originalProduct, onChoose, onClose, onDirtyChange,
}: ProductPickerProps) {
  const [categoryId, setCategoryId] = useState('');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});

  // 検索や商品・仕様選択を変更したまま閉じる際は、親ダイアログで破棄確認する。
  const inputDirty = Boolean(categoryId || query || selectedId || Object.values(choices).some(Boolean));
  useEffect(() => { onDirtyChange?.(inputDirty); }, [inputDirty, onDirtyChange]);

  const current = currentSlot
    ? (originalProduct?.id === currentSlot.option_id
        ? originalProduct
        : candidates.find((candidate) => candidate.id === currentSlot.option_id)) ?? null
    : null;
  const categoryUnknown = Boolean(currentSlot && (!current?.categoryId?.trim() || current.section !== section));
  const eligibleCandidates = useMemo(
    () => v25PickerEligibleCandidates(candidates, section, currentSlot, originalProduct),
    [candidates, section, currentSlot, originalProduct]
  );
  // 固定欄の元商品を、右側の仕様選択の対象としては引き続き利用可能にする。
  const currentSelectable = currentSlot
    ? eligibleCandidates.find((candidate) => candidate.id === currentSlot.option_id) ?? null
    : null;
  const replacements = useMemo(
    () => v25PickerReplacementCandidates(eligibleCandidates, currentSlot),
    [eligibleCandidates, currentSlot]
  );
  const categories = useMemo(() => {
    const found = new Map<string, string>();
    for (const candidate of replacements) found.set(candidate.categoryId, candidate.categoryName);
    return [...found.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ja'));
  }, [replacements]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja-JP');
    return replacements.filter((candidate) =>
      (!categoryId || candidate.categoryId === categoryId) &&
      (!normalized || [candidate.name, candidate.manufacturer, candidate.modelNo, candidate.categoryName].join(' ').toLocaleLowerCase('ja-JP').includes(normalized))
    );
  }, [replacements, categoryId, query]);

  // 選択済みIDも許可候補の中だけで解決し、無関係な商品を明細へ反映させない。
  const selected = eligibleCandidates.find((candidate) => candidate.id === selectedId) ?? null;
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
          <h2 className="font-semibold">{sectionLabel}：{currentSlot ? '商品を変更' : '商品を追加'}</h2>
          {currentSlot && <p className="truncate text-xs text-muted" title={current?.name ?? ''}>現在：{current?.name ?? '登録中の商品'}</p>}
        </div>
        <button type="button" data-v25-dialog-close aria-label="商品選択を閉じる" title="閉じる" className="shrink-0 text-xl text-muted" onClick={onClose}>×</button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          {currentSlot && (
            <div data-testid="v25-wb-current-product" aria-label="現在の商品"
              className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-3 py-3">
              <p className="mb-2 text-xs font-semibold text-emerald-900">現在の商品 <span className="font-normal">（見積明細に登録中）</span></p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded bg-white text-[10px] text-muted">
                  {current?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={current.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                  ) : '画像なし'}
                </span>
                <div className="min-w-0 flex-[1_1_12rem] text-sm">
                  <p className="font-semibold text-ink">{current?.name ?? '登録中の商品（詳細不明）'}</p>
                  <p className="text-xs text-muted">{[current?.categoryName, current?.manufacturer, current?.modelNo].filter(Boolean).join(' ／ ')}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-soft">
                    商品標準原価（税別） <span className="font-semibold">{v25PickerStandardCostLabel(productCosts[currentSlot.option_id])}</span>
                  </p>
                </div>
                <Button type="button" variant="secondary" data-testid="v25-wb-current-variant"
                  disabled={!currentSelectable}
                  onClick={() => { if (currentSelectable) inspect(currentSelectable); }}>
                  仕様を変更
                </Button>
              </div>
              {!currentSelectable && !categoryUnknown && (
                <p className="mt-2 text-xs text-amber-900">現在の商品は廃番・取扱終了などのため仕様変更できません。下の変更候補から選んでください。</p>
              )}
            </div>
          )}
          {categoryUnknown && (
            <p role="alert" className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              現在の商品のカテゴリーを確認できないため変更できません。商品台帳の登録状態を確認してください。
            </p>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            {currentSlot && <span className="text-xs font-semibold text-muted">変更候補</span>}
            {!currentSlot && (
              <Select aria-label="カテゴリー" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}
                className="h-8 text-xs">
                <option value="">すべてのカテゴリー</option>
                {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </Select>
            )}
            <Input aria-label="商品を検索" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="商品名・メーカー・型番" className="h-8 min-w-[10rem] flex-1 text-xs" />
          </div>
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
                    <span className="mt-0.5 block text-xs tabular-nums text-ink-soft" data-testid="v25-wb-picker-list-cost">
                      商品標準原価（税別） <span className="font-semibold">{v25PickerStandardCostLabel(productCosts[candidate.id])}</span>
                    </span>
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
                  <p className="text-xs font-semibold text-muted">{selected.id === currentSlot?.option_id ? '現在の商品の仕様を確認' : '選んだ商品と標準仕様'}</p>
                  <p className="mt-1 font-semibold">{selected.name}</p>
                  <p className="text-xs text-muted">{[selected.manufacturer, selected.modelNo].filter(Boolean).join(' ／ ')}</p>
                </div>
                <div className="rounded-lg border border-line bg-ivory/30 px-3 py-2" data-testid="v25-wb-picker-detail-cost">
                  <p className="text-xs text-muted">商品標準原価（現在のVersion・税別）</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{v25PickerStandardCostLabel(productCosts[selected.id])}</p>
                  <p className="mt-1 text-xs text-muted">選択肢の原価差額・見積売価は含みません。</p>
                </div>
                <div className="space-y-1">
                  <Link href={`/admin/options/${encodeURIComponent(selected.id)}`}
                    target="_blank" rel="noopener noreferrer" prefetch={false}
                    data-testid="v25-wb-picker-edit-product"
                    className="inline-block text-xs font-semibold text-navy underline underline-offset-2">
                    商品台帳で編集（別タブ）
                  </Link>
                  <p className="text-xs text-muted">商品台帳で変更した原価は自動反映されません。標準見積の未保存入力を保存してから画面を再読込し、最新原価を取り込んでください。</p>
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
              <p className="text-sm text-muted">左の{currentSlot ? '「仕様を変更」または変更候補の「選ぶ」' : '商品'}から、色・サイズなどの仕様を確認できます。</p>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-4 py-3">
        <p className="text-xs text-muted">反映後の金額は明細の試算で確認できます。この操作では下書きは保存されません。</p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button type="button" data-testid="v25-wb-picker-apply"
            disabled={!selected || !choicesValid}
            onClick={() => { if (selected && choicesValid) onChoose(selected, { ...choices }); }}>
            明細に反映
          </Button>
        </div>
      </div>
    </div>
  );
}
