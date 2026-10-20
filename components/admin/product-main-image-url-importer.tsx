'use client';

import { useEffect } from 'react';
import { uploadOptionMainImageFromUrlAction } from '@/lib/actions/product-media-url';
import type { AdminFormState } from '@/lib/actions/admin';

const initial: AdminFormState = { ok: false };

/**
 * STEP1の既存メイン画像URL欄へ「URLから取り込んで保存」を追加する。
 * 外部URLをそのまま正式値にせず、画像本体を取得して千の風側ストレージへ保存する。
 */
export function ProductMainImageUrlImporter({ optionId }: { optionId: string }) {
  useEffect(() => {
    const section = document.getElementById('product-main-media');
    const input = section?.querySelector<HTMLInputElement>('input[name="image_url"]') ?? null;
    if (!section || !input) return;

    const field = input.parentElement;
    if (!(field instanceof HTMLElement)) return;
    if (field.querySelector('[data-main-image-url-importer="true"]')) return;

    const wrapper = document.createElement('div');
    wrapper.dataset.mainImageUrlImporter = 'true';
    wrapper.className = 'mt-2 space-y-2';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-secondary btn-sm';
    button.textContent = 'URLから取り込んで保存';

    const hint = document.createElement('p');
    hint.className = 'text-xs leading-5 text-muted';
    hint.textContent = 'URL先の画像を取得し、千の風側のストレージへ保存します。外部画像URLをそのまま参照しません。';

    const status = document.createElement('p');
    status.className = 'hidden text-xs font-semibold';
    status.setAttribute('role', 'status');

    const syncDisabled = () => {
      button.disabled = !input.value.trim();
    };

    const showStatus = (ok: boolean, message: string) => {
      status.textContent = message;
      status.className = `text-xs font-semibold ${ok ? 'text-[#245a48]' : 'text-danger'}`;
      status.setAttribute('role', ok ? 'status' : 'alert');
    };

    const handleImport = async () => {
      const sourceUrl = input.value.trim();
      if (!sourceUrl || button.disabled) return;

      button.disabled = true;
      button.textContent = '保存中…';
      status.className = 'hidden text-xs font-semibold';

      try {
        const formData = new FormData();
        formData.set('option_id', optionId);
        formData.set('source_url', sourceUrl);
        const result = await uploadOptionMainImageFromUrlAction(initial, formData);
        if (!result.ok) {
          showStatus(false, result.error ?? result.fieldErrors?.source_url?.[0] ?? '画像URLから保存できませんでした。');
          return;
        }

        if (result.savedImageUrl) {
          input.value = result.savedImageUrl;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showStatus(true, result.message ?? 'URLからメイン画像を保存しました。');
      } catch {
        showStatus(false, '画像URLからの保存中にエラーが発生しました。');
      } finally {
        button.textContent = 'URLから取り込んで保存';
        syncDisabled();
      }
    };

    input.addEventListener('input', syncDisabled);
    button.addEventListener('click', handleImport);
    wrapper.append(button, hint, status);
    field.append(wrapper);
    syncDisabled();

    return () => {
      input.removeEventListener('input', syncDisabled);
      button.removeEventListener('click', handleImport);
      wrapper.remove();
    };
  }, [optionId]);

  return null;
}
