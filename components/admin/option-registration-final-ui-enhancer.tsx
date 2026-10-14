'use client';

import { useEffect } from 'react';

const IMAGE_URL_MARKER = 'registrationImageUrlToggle';

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

  Array.from(flow.querySelectorAll<HTMLElement>('p')).forEach((row) => {
    if (row.textContent?.trim().startsWith('現在：STEP')) row.style.display = 'none';
  });
}

function enhanceMainImageUrl() {
  const input = document.querySelector<HTMLInputElement>('#product-main-media input[name="image_url"]');
  if (!input || input.dataset[IMAGE_URL_MARKER] === 'true') return;

  const wrapper = directGridChild(input);
  if (!wrapper) return;

  const label = input.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`)
    : null;
  if (label) setTextIfChanged(label, '画像URL');

  const toggleRow = document.createElement('div');
  toggleRow.className = 'sm:col-span-2';
  toggleRow.dataset.registrationImageUrlToggle = 'true';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-ghost btn-sm px-0 text-xs';
  toggleRow.appendChild(button);
  wrapper.insertAdjacentElement('beforebegin', toggleRow);

  let open = Boolean(wrapper.querySelector('.text-danger, [role="alert"]'));
  const render = () => {
    wrapper.style.display = open ? '' : 'none';
    setTextIfChanged(button, open ? 'URL指定を閉じる' : 'URLで画像を指定');
    button.setAttribute('aria-expanded', String(open));
  };

  button.addEventListener('click', () => {
    open = !open;
    render();
    if (open) input.focus();
  });

  input.dataset[IMAGE_URL_MARKER] = 'true';
  render();
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
