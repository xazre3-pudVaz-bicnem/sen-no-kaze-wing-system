'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveIncludedCategoriesAction } from '@/lib/actions/option-included-categories';
import { IncludedEquipmentCategoryFields } from '@/components/admin/included-equipment-category-fields';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';
import { sameCategoryIdSet } from '@/lib/domain/included-equipment-action-contract';
import type { IncludedEquipmentCategoryCandidate } from '@/lib/domain/included-equipment-category-input';
import { Alert, Button, Spinner } from '@/components/ui';

type Props = {
  optionId: string;
  ownCategoryId: string;
  candidates: IncludedEquipmentCategoryCandidate[];
  savedCategoryIds: string[];
  mode: 'draft' | 'published';
};

export function IncludedEquipmentCategoryEditor({
  optionId, ownCategoryId, candidates, savedCategoryIds, mode,
}: Props) {
  const router = useRouter();
  const { registerIndependentSaveHandler, markIndependentDirty } = useOptionRegistrationSave();
  const [savedIds, setSavedIds] = useState(savedCategoryIds);
  const [selectedIds, setSelectedIds] = useState(savedCategoryIds);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const savedRef = useRef(savedCategoryIds);
  const selectedRef = useRef(savedCategoryIds);
  const inFlightRef = useRef(false);
  const candidateIds = candidates.map((row) => row.id);
  const unexpectedIds = savedIds.filter((id) => !candidateIds.includes(id));
  const dirty = !sameCategoryIdSet(savedIds, selectedIds);
  const selectedNames = (ids: readonly string[]) =>
    candidates.filter((row) => ids.includes(row.id)).map((row) => row.name).join('・') || 'なし';

  const updateSelection = (ids: string[]) => {
    if (pending || reloadRequired || unexpectedIds.length > 0) return;
    selectedRef.current = ids;
    setSelectedIds(ids);
    setError(null);
    setSuccess(false);
    setReviewing(false);
    if (mode === 'draft') markIndependentDirty();
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current || reloadRequired) return false;
    const expected = savedRef.current;
    const next = selectedRef.current;
    if (sameCategoryIdSet(expected, next)) return true;
    inFlightRef.current = true;
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await saveIncludedCategoriesAction({
        optionId, expectedCategoryIds: [...expected], nextCategoryIds: [...next],
      });
      if (!result.ok) {
        setError(result.error);
        if (result.code === 'CONFLICT' || result.code === 'TIMEOUT' || result.code === 'FAILED') setReloadRequired(true);
        return false;
      }
      savedRef.current = result.savedIds;
      selectedRef.current = result.savedIds;
      setSavedIds(result.savedIds);
      setSelectedIds(result.savedIds);
      setReviewing(false);
      setSuccess(true);
      return true;
    } catch {
      setError('設備包含設定の保存結果を確認できません。再読み込みしてください。');
      setReloadRequired(true);
      return false;
    } finally {
      inFlightRef.current = false;
      setPending(false);
      if (mode === 'draft') markIndependentDirty();
    }
  }, [optionId, mode, markIndependentDirty, reloadRequired]);

  useEffect(() => {
    if (mode !== 'draft') return;
    return registerIndependentSaveHandler(save, () => !sameCategoryIdSet(savedRef.current, selectedRef.current) || inFlightRef.current || reloadRequired);
  }, [mode, registerIndependentSaveHandler, reloadRequired, save]);

  return (
    <section data-testid="included-equipment-editor" className="space-y-3" aria-label="設備包含設定">
      <IncludedEquipmentCategoryFields
        includedCategoryIds={selectedIds}
        candidates={candidates}
        ownCategoryId={ownCategoryId}
        onSelectionChange={updateSelection}
        disabled={pending || reloadRequired || unexpectedIds.length > 0}
      />
      <div className="rounded-xl border border-line bg-white px-4 py-3 text-xs space-y-3">
        <p className="text-muted">
          商品情報と設備包含設定は別々に保存されます。設備包含は商品ごとの事実だけを記録し、見積金額・部屋・数量は変更しません。
        </p>
        {unexpectedIds.length > 0 && <Alert tone="danger">候補外の既存関係があるため保存できません。管理者へ確認してください。</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        {success && !dirty && <Alert tone="success">設備包含設定をDBに保存しました。</Alert>}
        {reloadRequired && <p className="font-semibold text-danger">現在の保存状態を確認するまで再送信できません。ページを再読み込みしてください。</p>}
        <p className="font-semibold" aria-live="polite">
          {pending ? '設備包含設定を保存中…' : dirty ? '設備包含設定：未保存' : '設備包含設定：保存済み'}
        </p>
        {mode === 'draft' ? (
          <div className="flex justify-end">
            <Button type="button" disabled={!dirty || pending || reloadRequired || unexpectedIds.length > 0} onClick={() => { void save(); }}>
              {pending && <Spinner />}設備設定だけを保存
            </Button>
          </div>
        ) : (
          <>
            {!reviewing ? (
              <div className="flex justify-end">
                <Button type="button" disabled={!dirty || pending || reloadRequired || unexpectedIds.length > 0} onClick={() => setReviewing(true)}>
                  設備設定の変更内容を確認
                </Button>
              </div>
            ) : (
              <div data-testid="included-equipment-change-review" className="space-y-3 rounded-lg border border-line bg-ivory/30 p-3">
                <h4 className="text-sm font-semibold">設備包含設定の変更確認（商品情報とは別保存）</h4>
                <p>変更前：{selectedNames(savedIds)}</p>
                <p>変更後：{selectedNames(selectedIds)}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => setReviewing(false)}>編集に戻る</Button>
                  <Button type="button" disabled={!dirty || pending || reloadRequired} onClick={() => {
                    void save().then((ok) => { if (ok) router.refresh(); });
                  }}>
                    {pending && <Spinner />}設備包含設定だけを保存
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
