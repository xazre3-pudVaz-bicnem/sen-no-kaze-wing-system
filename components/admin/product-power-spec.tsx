'use client';

import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveOptionPowerSpecAction } from '@/lib/actions/product-power-spec';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';
import { productRequiresPowerSpec } from '@/lib/domain/product-power-spec';

const AIRCON_CAPACITY_LABEL = '能力クラス・容量';
const AIRCON_CAPACITY_PLACEHOLDER = '例：2.5kW（8畳程度）';
const POWER_SPEC_PLACEHOLDER = '単相100V・15A（専用回路）';
const POWER_SPEC_HINT = 'メーカー公式資料に記載された電源仕様を入力してください。';

function syncCapacityField(root: ParentNode, airconActive: boolean) {
  const input = root.querySelector<HTMLInputElement>('input[name="size_note"]');
  if (!input) return;
  const label = input.id ? root.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`) : null;

  if (label && !label.dataset.powerSpecOriginalLabel) {
    label.dataset.powerSpecOriginalLabel = label.textContent?.trim() ?? '';
  }
  if (input.dataset.powerSpecOriginalPlaceholder === undefined) {
    input.dataset.powerSpecOriginalPlaceholder = input.placeholder;
  }

  const labelText = airconActive ? AIRCON_CAPACITY_LABEL : label?.dataset.powerSpecOriginalLabel ?? '';
  const placeholder = airconActive
    ? AIRCON_CAPACITY_PLACEHOLDER
    : input.dataset.powerSpecOriginalPlaceholder ?? '';

  if (label && labelText && label.textContent?.trim() !== labelText) label.textContent = labelText;
  if (input.placeholder !== placeholder) input.placeholder = placeholder;
}

function PowerSpecInput({
  value,
  onChange,
  required,
  form,
}: {
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  form?: string;
}) {
  return (
    <div data-testid="product-power-spec-field">
      <label className="label" htmlFor="product-power-spec">
        電源仕様 {required && <span className="text-danger">必須</span>}
      </label>
      <input
        id="product-power-spec"
        name="power_spec"
        form={form}
        className="input"
        value={value}
        required={required}
        placeholder={POWER_SPEC_PLACEHOLDER}
        onChange={(event) => {
          event.currentTarget.setCustomValidity('');
          onChange(event.target.value);
        }}
        onInvalid={(event) => {
          if (required && !event.currentTarget.value.trim()) {
            event.currentTarget.setCustomValidity('電源仕様を入力してください');
          }
        }}
      />
      <p className="mt-1 text-xs text-muted">{POWER_SPEC_HINT}</p>
    </div>
  );
}

/**
 * STEP1のOptionFormへ電源仕様を追加する補助UI。
 * 既存の大きな商品フォームを複製せず、商品の詳細グリッドへportalし、
 * 同じ保存境界に専用列の保存処理だけを参加させる。
 */
export function ProductPowerSpecRegistrationField({
  optionId,
  initialValue,
  airconCategoryId,
}: {
  optionId: string;
  initialValue: string;
  airconCategoryId: string | null;
}) {
  const { registerSaveHandler, markDirty } = useOptionRegistrationSave();
  const [value, setValue] = useState(initialValue);
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  const activeRef = useRef(active);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const sync = () => {
      const form = document.getElementById('option-main-form');
      const category = form?.querySelector<HTMLSelectElement>('select[name="category_id"]') ?? null;
      const detailsGrid = form?.querySelector<HTMLElement>('#product-details .grid') ?? null;
      const isAircon = Boolean(airconCategoryId && category?.value === airconCategoryId);
      setActive((current) => current === isAircon ? current : isAircon);
      setTarget((current) => current === detailsGrid ? current : detailsGrid);
      if (form) syncCapacityField(form, isAircon);
    };

    sync();
    const form = document.getElementById('option-main-form');
    const category = form?.querySelector<HTMLSelectElement>('select[name="category_id"]') ?? null;
    category?.addEventListener('change', sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      category?.removeEventListener('change', sync);
      observer.disconnect();
    };
  }, [airconCategoryId]);

  useEffect(() =>
    registerSaveHandler(async () => {
      if (!activeRef.current) return true;
      const result = await saveOptionPowerSpecAction({
        optionId,
        powerSpec: valueRef.current,
        requireComplete: false,
      });
      setError(result.ok ? null : result.error ?? '電源仕様を保存できませんでした。');
      return result.ok;
    }),
  [optionId, registerSaveHandler]);

  if (!active || !target) return null;

  return createPortal(
    <div>
      <PowerSpecInput
        value={value}
        required
        onChange={(next) => {
          setValue(next);
          setError(null);
          markDirty();
        }}
      />
      {error && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{error}</p>}
    </div>,
    target
  );
}

/** 登録済み商品の電源仕様を独立して安全に再編集する。 */
export function ProductPowerSpecPublishedCard({
  optionId,
  categoryCode,
  initialValue,
  editable,
}: {
  optionId: string;
  categoryCode: string | null;
  initialValue: string;
  editable: boolean;
}) {
  const router = useRouter();
  const required = productRequiresPowerSpec(categoryCode);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const form = document.querySelector<HTMLElement>('[data-testid="registered-option-edit-flow"]');
      if (form) syncCapacityField(form, required);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [required]);

  if (!required && !initialValue.trim()) return null;

  if (!editable) {
    return (
      <section className="card p-4 sm:p-5" data-testid="product-power-spec-readonly">
        <p className="text-xs font-semibold text-muted">電源仕様</p>
        <p className="mt-1 text-sm font-semibold text-ink">{value.trim() || '未設定'}</p>
      </section>
    );
  }

  return (
    <section className="card space-y-4 p-4 sm:p-5" data-testid="product-power-spec-published-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">電源仕様</h2>
          <p className="mt-1 text-xs text-muted">電気配線・専用回路・ブレーカー確認に使う商品固有情報です。</p>
        </div>
        {!value.trim() && required && (
          <span className="rounded-full bg-[#fff1cf] px-3 py-1 text-xs font-semibold text-[#7c5a18]">未設定</span>
        )}
      </div>
      <PowerSpecInput value={value} required={required} onChange={(next) => { setValue(next); setMessage(null); setError(null); }} />
      {message && <p className="text-xs font-semibold text-[#245a48]">{message}</p>}
      {error && <p className="text-xs font-semibold text-danger" role="alert">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={saving}
          onClick={() => {
            if (required && !value.trim()) {
              setError('電源仕様を入力してください');
              return;
            }
            setSaving(true);
            setError(null);
            void saveOptionPowerSpecAction({ optionId, powerSpec: value, requireComplete: true }).then((result) => {
              setSaving(false);
              if (!result.ok) {
                setError(result.error ?? '電源仕様を保存できませんでした。');
                return;
              }
              setValue(result.value ?? '');
              setMessage('電源仕様を保存しました。');
              router.refresh();
            });
          }}
        >
          {saving ? '保存中…' : '電源仕様を保存'}
        </button>
      </div>
    </section>
  );
}

export function ProductPowerSpecSummary({ value }: { value: string }) {
  if (!value.trim()) return null;
  return (
    <section className="card p-4 sm:p-5" data-testid="product-power-spec-summary">
      <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold text-muted">電源仕様</dt>
        <dd className="font-semibold text-ink">{value}</dd>
      </dl>
    </section>
  );
}
