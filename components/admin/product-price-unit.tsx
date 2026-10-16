'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getCategoryPriceUnitDefaultsAction,
  getOptionPriceUnitState,
  saveOptionPriceUnitsAction,
  type ProductPriceUnitState,
} from '@/lib/actions/product-price-unit';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';
import {
  isProductPriceUnitPreset,
  PRODUCT_PRICE_UNIT_OTHER,
  PRODUCT_PRICE_UNIT_PRESETS,
} from '@/lib/domain/product-price-unit';

type EditorState = {
  choice: string;
  custom: string;
};

const EMPTY_EDITOR: EditorState = { choice: '', custom: '' };

function editorFromUnit(unit: string | null | undefined): EditorState {
  const value = unit?.trim() ?? '';
  if (!value) return EMPTY_EDITOR;
  return isProductPriceUnitPreset(value)
    ? { choice: value, custom: '' }
    : { choice: PRODUCT_PRICE_UNIT_OTHER, custom: value };
}

function editorValue(editor: EditorState): string {
  return editor.choice === PRODUCT_PRICE_UNIT_OTHER ? editor.custom.trim() : editor.choice;
}

function UnitEditor({
  id,
  label,
  hint,
  editor,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  editor: EditorState;
  disabled?: boolean;
  onChange: (next: EditorState) => void;
}) {
  return (
    <div data-testid={`${id}-field`}>
      <label className="label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="input"
        value={editor.choice}
        disabled={disabled}
        onChange={(event) => {
          const choice = event.target.value;
          onChange({
            choice,
            custom: choice === PRODUCT_PRICE_UNIT_OTHER ? editor.custom : '',
          });
        }}
      >
        <option value="">未選択</option>
        {PRODUCT_PRICE_UNIT_PRESETS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        <option value={PRODUCT_PRICE_UNIT_OTHER}>その他（自由入力）</option>
      </select>
      {editor.choice === PRODUCT_PRICE_UNIT_OTHER && (
        <input
          className="input mt-2"
          value={editor.custom}
          disabled={disabled}
          maxLength={40}
          placeholder="例：箱、束、ロール"
          aria-label={`${label} その他`}
          onChange={(event) => onChange({ ...editor, custom: event.target.value })}
        />
      )}
      <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>
    </div>
  );
}

/**
 * STEP1の価格欄へ専用の価格単位UIを差し込む。
 * カテゴリー既定値は保存済み単位が無い場合だけ初期表示し、利用者が一度変更した後はカテゴリー変更で上書きしない。
 */
export function ProductPriceUnitRegistrationField({ optionId }: { optionId: string }) {
  const { registerSaveHandler, markDirty } = useOptionRegistrationSave();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [priceEditor, setPriceEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [listEditor, setListEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const priceEditorRef = useRef(priceEditor);
  const listEditorRef = useRef(listEditor);
  const priceTouchedRef = useRef(false);
  const listTouchedRef = useRef(false);

  useEffect(() => { priceEditorRef.current = priceEditor; }, [priceEditor]);
  useEffect(() => { listEditorRef.current = listEditor; }, [listEditor]);

  useEffect(() => {
    let active = true;
    void getOptionPriceUnitState(optionId).then((state) => {
      if (!active) return;
      if (!state.ok) {
        setError(state.error ?? '価格単位を読み込めませんでした。');
        return;
      }
      const savedPrice = state.priceUnit?.trim() || null;
      const savedList = state.listPriceUnit?.trim() || null;
      setPriceEditor(editorFromUnit(savedPrice ?? state.defaultPriceUnit ?? null));
      setListEditor(editorFromUnit(savedList ?? state.defaultListPriceUnit ?? null));
      priceTouchedRef.current = Boolean(savedPrice);
      listTouchedRef.current = Boolean(savedList);
      loadedRef.current = true;
    });
    return () => { active = false; };
  }, [optionId]);

  useEffect(() => {
    const form = document.getElementById('option-main-form');
    const priceInput = form?.querySelector<HTMLInputElement>('input[name="price"]') ?? null;
    const grid = priceInput?.closest<HTMLElement>('.grid') ?? null;
    const frameId = window.requestAnimationFrame(() => setTarget(grid));
    const category = form?.querySelector<HTMLSelectElement>('select[name="category_id"]') ?? null;
    if (!category) {
      return () => window.cancelAnimationFrame(frameId);
    }

    let requestId = 0;
    const onCategoryChange = () => {
      const categoryId = category.value;
      const currentRequest = ++requestId;
      void getCategoryPriceUnitDefaultsAction(categoryId).then((result) => {
        if (currentRequest !== requestId || category.value !== categoryId || !result.ok) return;
        if (!priceTouchedRef.current) setPriceEditor(editorFromUnit(result.priceUnit ?? null));
        if (!listTouchedRef.current) setListEditor(editorFromUnit(result.listPriceUnit ?? null));
      });
    };
    category.addEventListener('change', onCategoryChange);
    return () => {
      window.cancelAnimationFrame(frameId);
      category.removeEventListener('change', onCategoryChange);
    };
  }, []);

  useEffect(() =>
    registerSaveHandler(async () => {
      if (!loadedRef.current) {
        setError('価格単位を読み込んでいます。少し待ってからもう一度お試しください。');
        return false;
      }
      const result = await saveOptionPriceUnitsAction({
        optionId,
        priceUnit: editorValue(priceEditorRef.current),
        listPriceUnit: editorValue(listEditorRef.current),
      });
      setError(result.ok ? null : result.error ?? '価格単位を保存できませんでした。');
      return result.ok;
    }),
  [optionId, registerSaveHandler]);

  if (!target) return null;

  return createPortal(
    <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2" data-testid="product-price-unit-registration">
      <UnitEditor
        id="product-price-unit"
        label="商品価格の単位"
        hint="商品価格は、選択した単位1つあたりの税別価格として扱います。カテゴリーに応じた初期値は変更できます。"
        editor={priceEditor}
        onChange={(next) => {
          priceTouchedRef.current = true;
          setPriceEditor(next);
          setError(null);
          markDirty();
        }}
      />
      <UnitEditor
        id="manufacturer-list-price-unit"
        label="メーカー参考価格の単位"
        hint="メーカー資料の表記に合わせて選択してください。商品価格の単位と同じでなくても構いません。"
        editor={listEditor}
        onChange={(next) => {
          listTouchedRef.current = true;
          setListEditor(next);
          setError(null);
          markDirty();
        }}
      />
      {error && <p className="text-xs font-semibold text-danger sm:col-span-2" role="alert">{error}</p>}
    </div>,
    target
  );
}

/** 登録済み商品でも、保存済み単位をカテゴリー既定値で上書きせず個別に編集できる。 */
export function ProductPriceUnitPublishedCard({ optionId }: { optionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<ProductPriceUnitState | null>(null);
  const [priceEditor, setPriceEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [listEditor, setListEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getOptionPriceUnitState(optionId).then((next) => {
      if (!active) return;
      setState(next);
      setPriceEditor(editorFromUnit(next.priceUnit));
      setListEditor(editorFromUnit(next.listPriceUnit));
      if (!next.ok) setError(next.error ?? '価格単位を読み込めませんでした。');
    });
    return () => { active = false; };
  }, [optionId]);

  if (!state) {
    return <section className="card p-4 text-sm text-muted" data-testid="product-price-unit-loading">価格単位を読み込んでいます…</section>;
  }

  const editable = Boolean(state.ok && state.editable);
  return (
    <section className="card space-y-4 p-4 sm:p-5" data-testid="product-price-unit-published-editor">
      <div>
        <h2 className="font-semibold">価格単位</h2>
        <p className="mt-1 text-xs leading-5 text-muted">商品価格とメーカー参考価格は別々の単位を持てます。既存の保存値をカテゴリー既定値で自動上書きしません。</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <UnitEditor
          id="published-product-price-unit"
          label="商品価格の単位"
          hint="例：台、ケース、㎡。未設定の既存商品はそのまま保持できます。"
          editor={priceEditor}
          disabled={!editable}
          onChange={(next) => { setPriceEditor(next); setMessage(null); setError(null); }}
        />
        <UnitEditor
          id="published-manufacturer-list-price-unit"
          label="メーカー参考価格の単位"
          hint="メーカー資料の価格表記に合わせます。"
          editor={listEditor}
          disabled={!editable}
          onChange={(next) => { setListEditor(next); setMessage(null); setError(null); }}
        />
      </div>
      {message && <p className="text-xs font-semibold text-[#245a48]">{message}</p>}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
      {editable && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              setMessage(null);
              setError(null);
              void saveOptionPriceUnitsAction({
                optionId,
                priceUnit: editorValue(priceEditor),
                listPriceUnit: editorValue(listEditor),
              }).then((result) => {
                setSaving(false);
                if (!result.ok) {
                  setError(result.error ?? '価格単位を保存できませんでした。');
                  return;
                }
                setState(result);
                setPriceEditor(editorFromUnit(result.priceUnit));
                setListEditor(editorFromUnit(result.listPriceUnit));
                setMessage('価格単位を保存しました。');
                router.refresh();
              });
            }}
          >
            {saving ? '保存中…' : '価格単位を保存'}
          </button>
        </div>
      )}
    </section>
  );
}

/** STEP2では保存済みの価格単位だけを確認表示する。 */
export function ProductPriceUnitRouteSummary() {
  const params = useParams<{ id?: string }>();
  const optionId = typeof params?.id === 'string' ? params.id : '';
  const [state, setState] = useState<ProductPriceUnitState | null>(null);

  useEffect(() => {
    if (!optionId) return;
    let active = true;
    void getOptionPriceUnitState(optionId).then((next) => {
      if (active) setState(next);
    });
    return () => { active = false; };
  }, [optionId]);

  if (!state?.ok) return null;
  const priceUnit = state.priceUnit?.trim() || '未選択';
  const listPriceUnit = state.listPriceUnit?.trim() || '未選択';
  return (
    <section className="card p-4 sm:p-5" data-testid="product-price-unit-summary">
      <dl className="grid gap-2 text-sm sm:grid-cols-[11rem_1fr]">
        <dt className="font-semibold text-muted">商品価格の単位</dt>
        <dd className="font-semibold text-ink">{priceUnit}</dd>
        <dt className="font-semibold text-muted">メーカー参考価格の単位</dt>
        <dd className="font-semibold text-ink">{listPriceUnit}</dd>
      </dl>
    </section>
  );
}
