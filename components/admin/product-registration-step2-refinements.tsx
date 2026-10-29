'use client';

import { useEffect } from 'react';

const PREVIEW_NOTICE = '表示確認のみです。ここで仕様を選択しても、下書きの登録内容は変更されません。変更する場合はSTEP1へ戻ってください。';

function setTextIfChanged(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function exactTextElement(root: HTMLElement, selector: string, value: string) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
    (element) => element.textContent?.trim() === value
  ) ?? null;
}

function ensureCheckRow(
  container: HTMLElement,
  key: string,
  label: string,
  value: string,
  tone: 'normal' | 'danger' | 'warning' = 'normal'
) {
  let row = container.querySelector<HTMLElement>(`[data-step2-check-row="${key}"]`);
  if (!row) {
    row = document.createElement('div');
    row.dataset.step2CheckRow = key;
    row.className = 'flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2 text-xs';
    const name = document.createElement('span');
    name.className = 'font-semibold text-ink-soft';
    name.dataset.step2CheckLabel = 'true';
    const status = document.createElement('span');
    status.className = 'text-right';
    status.dataset.step2CheckValue = 'true';
    row.append(name, status);
    container.append(row);
  }

  setTextIfChanged(row.querySelector<HTMLElement>('[data-step2-check-label]'), label);
  const status = row.querySelector<HTMLElement>('[data-step2-check-value]');
  setTextIfChanged(status, value);
  if (status) {
    status.className =
      tone === 'danger'
        ? 'text-right font-semibold text-danger'
        : tone === 'warning'
          ? 'text-right font-semibold text-[#7c5a18]'
          : 'text-right font-semibold text-[#245a48]';
  }
}

function enhanceStep2() {
  const preview = document.querySelector<HTMLElement>('[data-testid="option-customer-preview"]');
  if (!preview) return;

  const backLink = exactTextElement(preview, 'a', '商品情報に戻る');
  setTextIfChanged(backLink, 'STEP1 商品情報に戻る');

  const notice = exactTextElement(
    preview,
    'div',
    'この画面での仕様選択は表示確認用です。下書きの登録内容は変更されません。'
  );
  setTextIfChanged(notice, PREVIEW_NOTICE);
  if (notice) {
    notice.setAttribute('role', 'note');
    notice.setAttribute('aria-label', 'STEP2は表示確認のみ');
  }

  const registration = preview.querySelector<HTMLElement>('section[aria-label="商品登録"]');
  if (!registration) return;

  const heading = exactTextElement(registration, 'h3', '登録状態') ??
    exactTextElement(registration, 'h3', '登録前の最終チェック');
  setTextIfChanged(heading, '登録前の最終チェック');

  const intro = heading?.parentElement?.querySelector<HTMLElement>('p') ?? null;
  setTextIfChanged(
    intro,
    'メイン画像・金額・メーカー・型番・お客様選択をここで最終確認し、問題がなければ登録してください。'
  );

  const summaryHost = heading?.parentElement;
  if (!summaryHost) return;

  let checklist = summaryHost.querySelector<HTMLElement>('[data-step2-final-check-list]');
  if (!checklist) {
    checklist = document.createElement('div');
    checklist.dataset.step2FinalCheckList = 'true';
    checklist.className = 'mt-3 space-y-2';
    summaryHost.append(checklist);
  }

  const productPreview = preview.querySelector<HTMLElement>('[data-testid="simulator-product-detail-preview"]');
  const imageMissing = Array.from(preview.querySelectorAll<HTMLElement>('*')).some(
    (element) => element.children.length === 0 && element.textContent?.trim() === '画像なし'
  );
  const zeroPriceNeedsConfirmation = /(商品標準原価|商品価格)が0円です/.test(registration.textContent ?? '');
  const priceDisplay = productPreview?.dataset.registrationPriceDisplay ?? '未確認';
  // 本部商品は「商品標準原価（税別）」、本部商品の外（旧フリー商品）は「商品価格（税別）」
  const priceLabel = productPreview?.dataset.registrationPriceLabel ?? '商品価格（税別）';
  const manufacturer = productPreview?.dataset.registrationManufacturer ?? '未設定';
  const modelNo = productPreview?.dataset.registrationModelNo ?? '未設定';
  const customerChoices = productPreview?.dataset.registrationCustomerChoices ?? 'なし';

  ensureCheckRow(
    checklist,
    'image',
    'メイン画像',
    imageMissing ? '未登録（STEP1で登録してください）' : '登録済み',
    imageMissing ? 'danger' : 'normal'
  );
  ensureCheckRow(
    checklist,
    'price',
    priceLabel,
    zeroPriceNeedsConfirmation ? `${priceDisplay}／0円の確認が必要` : priceDisplay,
    zeroPriceNeedsConfirmation ? 'warning' : 'normal'
  );
  ensureCheckRow(checklist, 'manufacturer', 'メーカー', manufacturer);
  ensureCheckRow(checklist, 'model', 'シリーズ・型番', modelNo);
  ensureCheckRow(checklist, 'choices', 'お客様選択', customerChoices);
}

export function ProductRegistrationStep2Refinements() {
  useEffect(() => {
    let raf = 0;
    const observer = new MutationObserver(() => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        enhanceStep2();
        observer.observe(document.body, { childList: true, subtree: true });
      });
    });

    enhanceStep2();
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
