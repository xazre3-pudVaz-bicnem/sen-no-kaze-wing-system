'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  createVariantGroupWithFirstChoiceAction,
  type ProductVariantCreateState,
} from '@/lib/actions/product-registration-variants';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

const initialState: ProductVariantCreateState = { ok: false };

function refineProductImages() {
  const main = document.querySelector<HTMLElement>('.registration-step1-sections #product-main-media');
  const extra = document.querySelector<HTMLElement>('.registration-step1-sections #product-sub-images');
  if (!main || !extra) return;

  const wrapper = extra.parentElement?.parentElement;
  if (!(wrapper instanceof HTMLElement)) return;

  main.style.borderBottomLeftRadius = '0';
  main.style.borderBottomRightRadius = '0';
  main.style.borderBottomWidth = '0px';
  extra.style.borderTopLeftRadius = '0';
  extra.style.borderTopRightRadius = '0';

  const gap = extra.getBoundingClientRect().top - main.getBoundingClientRect().bottom;
  if (gap > 0.5) {
    const currentMargin = Number.parseFloat(window.getComputedStyle(wrapper).marginTop) || 0;
    wrapper.style.marginTop = `${currentMargin - gap}px`;
  }
}

function VariantCreatePortal({ target, optionId }: { target: HTMLElement; optionId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createVariantGroupWithFirstChoiceAction, initialState);

  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    setOpen(false);
    router.refresh();
  }, [router, state.ok]);

  return createPortal(
    <div className="space-y-3" data-combined-create-root="true">
      <div>
        <p className="text-sm font-semibold">選択項目を追加</p>
        <p className="mt-1 text-xs text-muted">例：床、カウンター、アクセントパネル、浴槽など</p>
      </div>

      {!open ? (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
          ＋ 選択項目を追加
        </button>
      ) : (
        <div className="rounded-xl border border-dashed border-line bg-ivory/20 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">選択項目を追加</p>
            <button
              type="button"
              className="text-xs text-muted underline underline-offset-4"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              閉じる
            </button>
          </div>

          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.fieldErrors?._form?.[0] && <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>}

          <form ref={formRef} action={action} className="space-y-4" noValidate>
            <input type="hidden" name="option_id" value={optionId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="選択項目名"
                htmlFor="registration-variant-group-name"
                hint="例：床／カウンター／アクセントパネル／浴槽"
                required
                errors={state.fieldErrors?.name}
              >
                <Input
                  id="registration-variant-group-name"
                  name="name"
                  placeholder="例：アクセントパネル"
                  required
                />
              </Field>
              <Field
                label="最初の選択肢"
                htmlFor="registration-first-choice-name"
                hint="最初の選択肢は標準として登録します"
                required
                errors={state.fieldErrors?.first_choice_name}
              >
                <Input
                  id="registration-first-choice-name"
                  name="first_choice_name"
                  placeholder="例：マルキーナグレー"
                  required
                />
              </Field>
            </div>
            <p className="text-xs text-muted">選択肢ごとの画像は登録しません。選択肢は作成後に追加できます。</p>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              この選択項目を作成
            </Button>
          </form>
        </div>
      )}
    </div>,
    target
  );
}

export function ProductRegistrationFinalRefinements() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [optionId, setOptionId] = useState('');

  useEffect(() => {
    let raf = 0;

    const enhance = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        refineProductImages();

        const target = document.querySelector<HTMLElement>(
          '.registration-step1-sections #customer-selection [data-testid="variant-quick-add"]'
        );
        const optionInput = document.querySelector<HTMLInputElement>(
          '.registration-step1-sections #option-main-form input[name="id"]'
        );
        if (!target || !optionInput?.value) {
          setPortalTarget(null);
          setOptionId('');
          return;
        }

        target.dataset.registrationCombinedCreate = 'true';
        setPortalTarget(target);
        setOptionId(optionInput.value);
      });
    };

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, []);

  if (!portalTarget || !optionId) return null;
  return <VariantCreatePortal target={portalTarget} optionId={optionId} />;
}
