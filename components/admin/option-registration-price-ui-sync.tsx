'use client';

import { useEffect } from 'react';
import { PRODUCT_PRICE_UNIT_OTHER } from '@/lib/domain/product-price-unit';

const ZERO_PRICE_WARNING_TEXT = '商品価格が0円です。正式な0円の場合はSTEP 2で確認が必要です';
const PRODUCT_UNIT_REQUIRED_TEXT = '商品価格の単位を選択してください';
const LIST_PRICE_UNIT_REQUIRED_TEXT = 'メーカー参考価格を入力した場合は、メーカー参考価格の単位を選択してください';
const PRICE_UNIT_STATE_EVENT = 'product-price-unit-state-change';
const OK_TEXT = '現在の入力内容に、公開前の要確認事項はありません。';

function issueBox(section: HTMLElement, heading: string) {
  return Array.from(section.querySelectorAll<HTMLElement>('div.rounded-xl')).find(
    (box) => box.querySelector(':scope > p')?.textContent?.trim() === heading
  ) ?? null;
}

function visibleIssueCount(box: HTMLElement | null) {
  if (!box) return 0;
  return Array.from(box.querySelectorAll<HTMLLIElement>('li')).filter((item) => item.style.display !== 'none').length;
}

function ensureIssueBox(section: HTMLElement, headingText: '公開に必要' | '確認してください') {
  const existing = issueBox(section, headingText);
  if (existing) return existing;

  const blocking = headingText === '公開に必要';
  const box = document.createElement('div');
  box.className = blocking
    ? 'rounded-xl border border-[#e7b9b9] bg-[#fff4f4] px-4 py-3 text-xs leading-5 text-ink-soft'
    : 'rounded-xl border border-[#ead6a7] bg-[#fff8e8] px-4 py-3 text-xs leading-5 text-ink-soft';
  box.dataset.registrationDynamicIssueBox = headingText;

  const heading = document.createElement('p');
  heading.className = blocking ? 'font-semibold text-[#8b2e2e]' : 'font-semibold text-[#7c5a18]';
  heading.textContent = headingText;

  const list = document.createElement('ul');
  list.className = 'mt-1 space-y-1';
  box.append(heading, list);

  const actionRow = section.lastElementChild;
  if (actionRow) section.insertBefore(box, actionRow);
  else section.appendChild(box);
  return box;
}

function ensureIssueItem(box: HTMLElement, key: string, text: string) {
  const existing = box.querySelector<HTMLLIElement>(`li[data-registration-dynamic-issue="${key}"]`);
  if (existing) return existing;
  const list = box.querySelector('ul');
  if (!list) return null;
  const item = document.createElement('li');
  item.dataset.registrationDynamicIssue = key;
  item.textContent = `・${text}`;
  list.appendChild(item);
  return item;
}

function ensureOkMessage(section: HTMLElement) {
  const existing = Array.from(section.querySelectorAll<HTMLParagraphElement>('p')).find((row) =>
    row.textContent?.includes('公開前の要確認事項はありません')
  );
  if (existing) return existing;

  const row = document.createElement('p');
  row.className = 'rounded-xl border border-line bg-ivory/30 px-4 py-3 text-xs leading-5 text-muted';
  row.dataset.registrationCheckOk = 'true';
  row.textContent = OK_TEXT;
  const actionRow = section.lastElementChild;
  if (actionRow) section.insertBefore(row, actionRow);
  else section.appendChild(row);
  return row;
}

function unitValue(select: HTMLSelectElement | null, custom: HTMLInputElement | null) {
  if (!select?.value) return '';
  return select.value === PRODUCT_PRICE_UNIT_OTHER ? custom?.value.trim() ?? '' : select.value;
}

function syncRegistrationCheck(priceInput: HTMLInputElement) {
  const section = document.querySelector<HTMLElement>('[data-testid="option-registration-check"]');
  if (!section) return;

  const priceOnRequest = document.querySelector<HTMLInputElement>('input[name="price_on_request"]');
  const listPriceInput = document.querySelector<HTMLInputElement>('input[name="list_price"]');
  const productUnit = document.getElementById('product-price-unit') as HTMLSelectElement | null;
  const manufacturerUnit = document.getElementById('manufacturer-list-price-unit') as HTMLSelectElement | null;
  const productUnitCustom = document.querySelector<HTMLInputElement>('input[aria-label="商品価格の単位 その他"]');
  const manufacturerUnitCustom = document.querySelector<HTMLInputElement>('input[aria-label="メーカー参考価格の単位 その他"]');

  const price = Number(priceInput.value);
  const shouldWarnZeroPrice = !priceOnRequest?.checked && Number.isFinite(price) && price === 0;
  const requiresProductUnit = !priceOnRequest?.checked;
  const requiresManufacturerUnit = Boolean(listPriceInput?.value.trim());
  const shouldBlockProductUnit = requiresProductUnit && !unitValue(productUnit, productUnitCustom);
  const shouldBlockManufacturerUnit = requiresManufacturerUnit && !unitValue(manufacturerUnit, manufacturerUnitCustom);

  if (productUnit) productUnit.required = requiresProductUnit;
  if (manufacturerUnit) manufacturerUnit.required = requiresManufacturerUnit;
  if (productUnitCustom) productUnitCustom.required = requiresProductUnit && productUnit?.value === PRODUCT_PRICE_UNIT_OTHER;
  if (manufacturerUnitCustom) {
    manufacturerUnitCustom.required = requiresManufacturerUnit && manufacturerUnit?.value === PRODUCT_PRICE_UNIT_OTHER;
  }

  let warningBox = issueBox(section, '確認してください');
  let zeroPriceItem = warningBox
    ? Array.from(warningBox.querySelectorAll<HTMLLIElement>('li')).find((item) =>
        item.textContent?.includes('商品価格が0円です')
      ) ?? null
    : null;

  if (shouldWarnZeroPrice && !zeroPriceItem) {
    warningBox = ensureIssueBox(section, '確認してください');
    const list = warningBox.querySelector('ul');
    if (list) {
      zeroPriceItem = document.createElement('li');
      zeroPriceItem.dataset.registrationZeroPriceWarning = 'true';
      zeroPriceItem.textContent = `・${ZERO_PRICE_WARNING_TEXT}`;
      list.appendChild(zeroPriceItem);
    }
  }
  if (zeroPriceItem) zeroPriceItem.style.display = shouldWarnZeroPrice ? '' : 'none';

  let blockingBox = issueBox(section, '公開に必要');
  if (shouldBlockProductUnit || shouldBlockManufacturerUnit) {
    blockingBox = ensureIssueBox(section, '公開に必要');
  }
  if (blockingBox) {
    const productItem = ensureIssueItem(blockingBox, 'product-price-unit', PRODUCT_UNIT_REQUIRED_TEXT);
    const manufacturerItem = ensureIssueItem(blockingBox, 'manufacturer-list-price-unit', LIST_PRICE_UNIT_REQUIRED_TEXT);
    if (productItem) productItem.style.display = shouldBlockProductUnit ? '' : 'none';
    if (manufacturerItem) manufacturerItem.style.display = shouldBlockManufacturerUnit ? '' : 'none';
  }

  if (warningBox) warningBox.style.display = visibleIssueCount(warningBox) > 0 ? '' : 'none';
  if (blockingBox) blockingBox.style.display = visibleIssueCount(blockingBox) > 0 ? '' : 'none';

  const blockingCount = visibleIssueCount(blockingBox);
  const warningCount = visibleIssueCount(warningBox);
  const badge = section.querySelector<HTMLElement>(':scope > div:first-child > span');

  if (badge) {
    if (blockingCount > 0) {
      badge.textContent = `公開に必要：${blockingCount}件`;
      badge.className = 'inline-flex w-fit rounded-full bg-[#fdecec] px-3 py-1 text-xs font-semibold text-[#8b2e2e]';
    } else if (warningCount > 0) {
      badge.textContent = `確認：${warningCount}件`;
      badge.className = 'inline-flex w-fit rounded-full bg-[#fff1cf] px-3 py-1 text-xs font-semibold text-[#7c5a18]';
    } else {
      badge.textContent = '基本チェックOK';
      badge.className = 'inline-flex w-fit rounded-full bg-[#eaf6f1] px-3 py-1 text-xs font-semibold text-[#245a48]';
    }
  }

  const okMessage = ensureOkMessage(section);
  okMessage.textContent = OK_TEXT;
  okMessage.style.display = blockingCount === 0 && warningCount === 0 ? '' : 'none';
}

export function OptionRegistrationPriceUiSync() {
  useEffect(() => {
    const priceInput = document.querySelector<HTMLInputElement>('[data-testid="option-price"]');
    if (!priceInput) return;

    // 商品価格は1円単位で登録できる。8,800円などをHTML5のstepMismatchにしない。
    priceInput.step = '1';

    const priceOnRequest = document.querySelector<HTMLInputElement>('input[name="price_on_request"]');
    const listPriceInput = document.querySelector<HTMLInputElement>('input[name="list_price"]');
    const sync = () => syncRegistrationCheck(priceInput);

    priceInput.addEventListener('input', sync);
    priceInput.addEventListener('change', sync);
    listPriceInput?.addEventListener('input', sync);
    listPriceInput?.addEventListener('change', sync);
    priceOnRequest?.addEventListener('change', sync);
    window.addEventListener(PRICE_UNIT_STATE_EVENT, sync);
    sync();

    return () => {
      priceInput.removeEventListener('input', sync);
      priceInput.removeEventListener('change', sync);
      listPriceInput?.removeEventListener('input', sync);
      listPriceInput?.removeEventListener('change', sync);
      priceOnRequest?.removeEventListener('change', sync);
      window.removeEventListener(PRICE_UNIT_STATE_EVENT, sync);
    };
  }, []);

  return null;
}
