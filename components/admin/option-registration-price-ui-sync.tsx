'use client';

import { useEffect } from 'react';

const ZERO_PRICE_WARNING_TEXT = '商品価格が0円です。正式な0円の場合はSTEP 2で確認が必要です';
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

function ensureWarningBox(section: HTMLElement) {
  const existing = issueBox(section, '確認してください');
  if (existing) return existing;

  const box = document.createElement('div');
  box.className = 'rounded-xl border border-[#ead6a7] bg-[#fff8e8] px-4 py-3 text-xs leading-5 text-ink-soft';
  box.dataset.registrationWarningBox = 'true';

  const heading = document.createElement('p');
  heading.className = 'font-semibold text-[#7c5a18]';
  heading.textContent = '確認してください';

  const list = document.createElement('ul');
  list.className = 'mt-1 space-y-1';
  box.append(heading, list);

  const actionRow = section.lastElementChild;
  if (actionRow) section.insertBefore(box, actionRow);
  else section.appendChild(box);
  return box;
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

function syncRegistrationCheck(priceInput: HTMLInputElement) {
  const section = document.querySelector<HTMLElement>('[data-testid="option-registration-check"]');
  if (!section) return;

  const priceOnRequest = document.querySelector<HTMLInputElement>('input[name="price_on_request"]');
  const price = Number(priceInput.value);
  const shouldWarnZeroPrice = !priceOnRequest?.checked && Number.isFinite(price) && price === 0;

  let warningBox = issueBox(section, '確認してください');
  let zeroPriceItem = warningBox
    ? Array.from(warningBox.querySelectorAll<HTMLLIElement>('li')).find((item) =>
        item.textContent?.includes('商品価格が0円です')
      ) ?? null
    : null;

  if (shouldWarnZeroPrice && !zeroPriceItem) {
    warningBox = ensureWarningBox(section);
    const list = warningBox.querySelector('ul');
    if (list) {
      zeroPriceItem = document.createElement('li');
      zeroPriceItem.dataset.registrationZeroPriceWarning = 'true';
      zeroPriceItem.textContent = `・${ZERO_PRICE_WARNING_TEXT}`;
      list.appendChild(zeroPriceItem);
    }
  }

  if (zeroPriceItem) zeroPriceItem.style.display = shouldWarnZeroPrice ? '' : 'none';

  if (warningBox) {
    warningBox.style.display = visibleIssueCount(warningBox) > 0 ? '' : 'none';
  }

  const blockingBox = issueBox(section, '公開に必要');
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
    const sync = () => syncRegistrationCheck(priceInput);

    priceInput.addEventListener('input', sync);
    priceInput.addEventListener('change', sync);
    priceOnRequest?.addEventListener('change', sync);
    sync();

    return () => {
      priceInput.removeEventListener('input', sync);
      priceInput.removeEventListener('change', sync);
      priceOnRequest?.removeEventListener('change', sync);
    };
  }, []);

  return null;
}
