'use client';

import { useEffect } from 'react';

function directGridChild(element: HTMLElement): HTMLElement | null {
  const grid = element.closest('.grid');
  if (!(grid instanceof HTMLElement)) return null;

  let current: HTMLElement | null = element;
  while (current && current.parentElement !== grid) current = current.parentElement;
  return current;
}

function setTextIfChanged(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

function simplifyStepProgress() {
  const flow = document.querySelector<HTMLElement>('section[aria-label="商品登録の2ステップ"]');
  if (!flow) return;
  flow.classList.add('registration-compact-step-flow');

  // このページは基本情報が保存された下書き商品の編集画面。
  const title = document.querySelector<HTMLElement>('h1');
  if (title?.textContent?.trim() === '商品を追加') setTextIfChanged(title, '商品を編集中');

  Array.from(flow.querySelectorAll<HTMLElement>('p')).forEach((row) => {
    if (row.textContent?.trim().startsWith('現在：STEP')) row.style.display = 'none';
  });
}

function enhanceMainImageUrl() {
  const input = document.querySelector<HTMLInputElement>('#product-main-media input[name="image_url"]');
  if (!input) return;

  const wrapper = directGridChild(input);
  if (!wrapper) return;

  const label = input.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`)
    : null;
  if (label) setTextIfChanged(label, '画像URL');

  // URL取り込みは通常の入力手段なので、折りたたまず常に表示する。
  document.querySelector('#product-main-media [data-registration-image-url-toggle="true"]')?.remove();
  if (wrapper.style.display === 'none') wrapper.style.removeProperty('display');
}

/** STEP1見出しと保存案内だけを簡潔にする。ジャンプ用ナビは設置しない。 */
function simplifyRegistrationInfoHeading() {
  const info = document.querySelector<HTMLElement>('[data-testid="option-registration-info"]');
  if (!info) return;
  const heading = info.querySelector<HTMLElement>(':scope > div:first-child > h2');
  if (heading) setTextIfChanged(heading, '商品情報を入力');
  const guidance = info.querySelector<HTMLElement>(':scope > div:first-child > p');
  if (guidance) {
    setTextIfChanged(guidance, '変更はSTEP 2へ進むときと、画像・資料の登録前に保存されます。');
  }
}

/** 要確認メッセージを読んだ直後に、該当する入力欄へ移動できるようにする。 */
function enhanceRegistrationCheckLinks() {
  const check = document.querySelector<HTMLElement>('[data-testid="option-registration-check"]');
  if (!check) return;

  check.querySelectorAll<HTMLLIElement>('li').forEach((item) => {
    if (item.querySelector('[data-registration-check-link="true"]')) return;
    const message = item.textContent ?? '';
    const target = message.includes('メイン画像') ? 'product-main-media'
      : message.includes('メーカー資料') ? 'manufacturer-documents'
      : message.includes('商品価格') ? 'sales-settings'
      : message.includes('選択肢') ? 'customer-selection'
      : message.includes('重複候補') ? 'product-identify'
      : null;
    if (!target || !document.getElementById(target)) return;
    const link = document.createElement('a');
    link.href = `#${target}`;
    link.textContent = '入力欄へ';
    link.dataset.registrationCheckLink = 'true';
    link.className = 'registration-check-jump';
    item.append(' ', link);
  });
}

function simplifyCustomerSelectionEmptyState() {
  const section = document.getElementById('customer-selection');
  if (!section) return;

  Array.from(section.querySelectorAll<HTMLElement>('p, div')).forEach((row) => {
    const text = row.textContent?.trim() ?? '';
    if (text.startsWith('お客様が選ぶ項目はまだありません') || text.startsWith('選択項目はまだありません')) {
      setTextIfChanged(row, '現在、選択項目はありません。');
    }
  });
}

function simplifyPreviewGuidance() {
  const preview = document.querySelector<HTMLElement>('[data-testid="option-customer-preview"]');
  if (!preview) return;

  Array.from(preview.querySelectorAll<HTMLElement>('p, span, dd')).forEach((row) => {
    const text = row.textContent?.trim() ?? '';
    if (text === '実際のシミュレーターの商品詳細表示と同じ本文・レイアウトで、登録する内容を確認します。') {
      setTextIfChanged(row, 'お客様に表示される商品内容を確認します。');
    } else if (text === 'この画面での仕様選択は表示確認用です。下書きの登録内容は変更されません。') {
      setTextIfChanged(row, 'この画面での操作は確認用です。登録内容を変更する場合はSTEP 1へ戻ってください。');
    } else if (text === '0円の確認が必要') {
      setTextIfChanged(row, '0円');
    } else if (text === '選択項目なし') {
      setTextIfChanged(row, 'なし');
    }
  });
}

export function OptionRegistrationFinalUiEnhancer() {
  useEffect(() => {
    const enhance = () => {
      simplifyStepProgress();
      enhanceMainImageUrl();
      simplifyRegistrationInfoHeading();
      enhanceRegistrationCheckLinks();
      simplifyCustomerSelectionEmptyState();
      simplifyPreviewGuidance();
    };

    enhance();

    const observer = new MutationObserver(() => {
      observer.disconnect();
      enhance();
      observer.observe(document.body, { childList: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
