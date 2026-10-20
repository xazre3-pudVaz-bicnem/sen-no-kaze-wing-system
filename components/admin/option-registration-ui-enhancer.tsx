'use client';

import { useEffect, useRef } from 'react';

const GROUPED_SELECT_MARKER = 'registrationGroupedSelect';
const GROUPED_SELECT_SUFFIX = '-grouped';
const GROUP_LABEL_PATTERN = /^【([^】]+)】\s*(.+)$/;
const TARGET_MODEL_MARKER = 'registrationTargetModel';
const DRAFT_STATUS_MARKER = 'registrationDraftStatus';

function directGridChild(element: HTMLElement): HTMLElement | null {
  const grid = element.closest('.grid');
  if (!(grid instanceof HTMLElement)) return null;

  let current: HTMLElement | null = element;
  while (current && current.parentElement !== grid) current = current.parentElement;
  return current;
}

function setNativeSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(select, value);
  else select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function setTextIfChanged(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}

function setLeadingTextIfChanged(element: HTMLElement, value: string) {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode && textNode.textContent?.trim() !== value) textNode.textContent = `${value} `;
}

function applyCompactCategoryTypography(element: HTMLOptionElement | HTMLOptGroupElement | HTMLSelectElement) {
  element.style.fontSize = '14px';
  element.style.lineHeight = '1.4';
}

function createGroupedCategorySelect(original: HTMLSelectElement) {
  if (original.dataset[GROUPED_SELECT_MARKER] === 'true') return;

  const rows = Array.from(original.options).map((option) => {
    const match = option.textContent?.match(GROUP_LABEL_PATTERN);
    return {
      value: option.value,
      label: match?.[2]?.trim() || option.textContent?.trim() || '',
      group: match?.[1]?.trim() || null,
      disabled: option.disabled,
    };
  });
  if (!rows.some((row) => row.group)) return;

  const grouped = document.createElement('select');
  grouped.id = `${original.id}${GROUPED_SELECT_SUFFIX}`;
  grouped.className = original.className;
  grouped.setAttribute('aria-label', original.getAttribute('aria-label') || 'カテゴリー');
  grouped.dataset.registrationCategoryGrouped = 'true';
  applyCompactCategoryTypography(grouped);

  const placeholderRows = rows.filter((row) => !row.group && !row.value);
  for (const row of placeholderRows) {
    const option = document.createElement('option');
    option.value = row.value;
    option.textContent = row.label;
    option.disabled = row.disabled;
    applyCompactCategoryTypography(option);
    grouped.appendChild(option);
  }

  const groupOrder: string[] = [];
  const groups = new Map<string, typeof rows>();
  const ungrouped: typeof rows = [];

  for (const row of rows) {
    if (!row.value && !row.group) continue;
    if (!row.group) {
      ungrouped.push(row);
      continue;
    }
    if (!groups.has(row.group)) {
      groups.set(row.group, []);
      groupOrder.push(row.group);
    }
    groups.get(row.group)?.push(row);
  }

  for (const groupLabel of groupOrder) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabel;
    applyCompactCategoryTypography(optgroup);
    for (const row of groups.get(groupLabel) ?? []) {
      const option = document.createElement('option');
      option.value = row.value;
      option.textContent = row.label;
      option.disabled = row.disabled;
      applyCompactCategoryTypography(option);
      optgroup.appendChild(option);
    }
    grouped.appendChild(optgroup);
  }

  if (ungrouped.length > 0) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = 'その他';
    applyCompactCategoryTypography(optgroup);
    for (const row of ungrouped) {
      const option = document.createElement('option');
      option.value = row.value;
      option.textContent = row.label;
      option.disabled = row.disabled;
      applyCompactCategoryTypography(option);
      optgroup.appendChild(option);
    }
    grouped.appendChild(optgroup);
  }

  grouped.value = original.value;

  const syncToOriginal = () => setNativeSelectValue(original, grouped.value);
  const syncFromOriginal = () => {
    grouped.value = original.value;
  };

  grouped.addEventListener('change', syncToOriginal);
  original.addEventListener('change', syncFromOriginal);

  const label = original.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(original.id)}"]`)
    : null;
  if (label) label.htmlFor = grouped.id;

  original.dataset[GROUPED_SELECT_MARKER] = 'true';
  original.setAttribute('aria-hidden', 'true');
  original.tabIndex = -1;
  original.style.display = 'none';
  original.insertAdjacentElement('afterend', grouped);
}

function enhanceCategorySelects() {
  document.querySelectorAll<HTMLSelectElement>('select[name="category_id"]').forEach(createGroupedCategorySelect);
}

function createTargetModelControls(original: HTMLSelectElement) {
  if (original.dataset[TARGET_MODEL_MARKER] === 'true') return;
  const wrapper = directGridChild(original);
  if (!wrapper) return;

  const controls = document.createElement('div');
  controls.className = 'space-y-3';
  controls.dataset.registrationTargetModelControls = 'true';

  const choices = document.createElement('div');
  choices.className = 'flex flex-wrap gap-2';

  const createChoice = (labelText: string, value: 'all' | 'specific') => {
    const label = document.createElement('label');
    label.className = 'inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `${original.id}-scope-ui`;
    radio.value = value;
    label.append(radio, document.createTextNode(labelText));
    choices.appendChild(label);
    return radio;
  };

  const allRadio = createChoice('全モデル共通', 'all');
  const specificRadio = createChoice('モデルを指定', 'specific');

  const specificSelect = document.createElement('select');
  specificSelect.className = original.className;
  specificSelect.id = `${original.id}-specific`;
  specificSelect.setAttribute('aria-label', '対象モデルを指定');

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'モデルを選択してください';
  placeholder.disabled = true;
  specificSelect.appendChild(placeholder);
  for (const source of Array.from(original.options).filter((option) => option.value)) {
    const option = document.createElement('option');
    option.value = source.value;
    option.textContent = source.textContent;
    option.disabled = source.disabled;
    specificSelect.appendChild(option);
  }

  const note = document.createElement('p');
  note.className = 'text-xs text-muted';
  note.textContent = '通常は「全モデル共通」。特定モデル専用の商品だけ指定します。';

  const syncVisibility = () => {
    const specific = Boolean(original.value);
    allRadio.checked = !specific;
    specificRadio.checked = specific;
    specificSelect.hidden = !specificRadio.checked;
    specificSelect.value = original.value || '';
  };

  allRadio.addEventListener('change', () => {
    if (!allRadio.checked) return;
    setNativeSelectValue(original, '');
    syncVisibility();
  });
  specificRadio.addEventListener('change', () => {
    if (!specificRadio.checked) return;
    specificSelect.hidden = false;
    if (original.value) specificSelect.value = original.value;
  });
  specificSelect.addEventListener('change', () => {
    setNativeSelectValue(original, specificSelect.value);
    syncVisibility();
  });
  original.addEventListener('change', syncVisibility);

  controls.append(choices, specificSelect, note);
  original.dataset[TARGET_MODEL_MARKER] = 'true';
  original.setAttribute('aria-hidden', 'true');
  original.tabIndex = -1;
  original.style.display = 'none';
  original.insertAdjacentElement('afterend', controls);
  syncVisibility();
}

function enhanceSalesSettings() {
  const section = document.getElementById('sales-settings');
  if (!section) return;

  const intro = section.querySelector<HTMLElement>(':scope > div:first-child > p:nth-child(2)');
  if (intro) setTextIfChanged(intro, '価格と対象モデルを設定します。公開はSTEP 2で行います。');

  const priceInput = section.querySelector<HTMLInputElement>('input[name="price"]');
  if (priceInput) {
    const wrapper = directGridChild(priceInput);
    const hint = wrapper
      ? Array.from(wrapper.querySelectorAll('p')).find((row) => row.textContent?.includes('価格未確認なら0円'))
      : null;
    if (hint) setTextIfChanged(hint, '0円のまま下書き保存できます。公開時に0円でよいか確認します。');
  }

  const normalSettings = section.querySelector<HTMLElement>('[data-testid="option-normal-settings"]');
  const normalHeading = normalSettings?.querySelector<HTMLElement>(':scope > div:first-child');
  if (normalHeading) normalHeading.style.display = 'none';

  const targetModel = section.querySelector<HTMLSelectElement>('select[name="base_model_id"]');
  if (targetModel) createTargetModelControls(targetModel);

  const draftStatus = section.querySelector<HTMLInputElement>('input[name="status"][value="draft"]');
  if (draftStatus && draftStatus.dataset[DRAFT_STATUS_MARKER] !== 'true') {
    const wrapper = directGridChild(draftStatus);
    const inputLike = wrapper?.querySelector<HTMLElement>('.input');
    if (wrapper && inputLike) {
      inputLike.style.display = 'none';
      const badge = document.createElement('span');
      badge.className = 'mt-2 inline-flex rounded-full bg-ivory px-3 py-1 text-sm font-semibold text-ink-soft';
      badge.textContent = '下書き';
      inputLike.insertAdjacentElement('beforebegin', badge);
      const hint = Array.from(wrapper.querySelectorAll('p')).find((row) => row !== wrapper.querySelector('.label'));
      if (hint && hint.textContent?.includes('STEP 2')) setTextIfChanged(hint, '公開はSTEP 2の確認画面から行います。');
      draftStatus.dataset[DRAFT_STATUS_MARKER] = 'true';
    }
  }
}

function simplifyRegistrationGuidance() {
  document.querySelectorAll<HTMLElement>('[data-testid="category-registration-guidance"]').forEach((guidance) => {
    guidance.style.display = 'none';
  });
}

function enhanceProductImages() {
  const mainMedia = document.getElementById('product-main-media');
  const subImages = document.getElementById('product-sub-images');

  if (mainMedia) {
    mainMedia.style.borderBottomLeftRadius = '0';
    mainMedia.style.borderBottomRightRadius = '0';
    const oldNote = Array.from(mainMedia.querySelectorAll<HTMLElement>('p')).find((row) =>
      row.textContent?.includes('サブ画像とメーカーPDF')
    );
    if (oldNote) oldNote.style.display = 'none';
  }

  if (!subImages) return;

  const mediaBlock = subImages.parentElement;
  const registrationWrapper = mediaBlock?.parentElement;
  if (registrationWrapper) registrationWrapper.style.marginTop = '-1.5rem';

  subImages.style.borderTopWidth = '0px';
  subImages.style.borderTopLeftRadius = '0';
  subImages.style.borderTopRightRadius = '0';

  const heading = subImages.querySelector<HTMLElement>('h2');
  if (heading) setLeadingTextIfChanged(heading, '追加画像');

  const emptyState = Array.from(subImages.querySelectorAll<HTMLElement>('div')).find(
    (row) => row.textContent?.trim() === 'サブ画像はまだ登録されていません。'
  );
  if (emptyState) emptyState.style.display = 'none';

  const uploadLabel = document.querySelector<HTMLLabelElement>('label[for="option-sub-image"]');
  if (uploadLabel) setTextIfChanged(uploadLabel, 'または画像ファイルから登録');

  Array.from(subImages.querySelectorAll<HTMLButtonElement>('button')).forEach((button) => {
    if (button.textContent?.trim() === 'このサブ画像を削除') {
      setTextIfChanged(button, 'この追加画像を削除');
    }
  });
}

function enhanceCustomerSelection() {
  const section = document.getElementById('customer-selection');
  if (!section) return;

  const intro = section.querySelector<HTMLElement>(':scope > div:first-child > p');
  if (intro) setTextIfChanged(intro, 'お客様が選べる部位・色・仕様などがある場合だけ設定します。');

  const quickAdd = section.querySelector<HTMLElement>('[data-testid="variant-quick-add"]');
  if (quickAdd) {
    quickAdd.setAttribute('aria-label', '選択項目を追加');
    const directParagraphs = Array.from(quickAdd.children).filter(
      (child): child is HTMLParagraphElement => child instanceof HTMLParagraphElement
    );
    if (directParagraphs[0]) setTextIfChanged(directParagraphs[0], '選択項目を追加');
    if (directParagraphs[1]) {
      setTextIfChanged(directParagraphs[1], '例：床、カウンター、アクセントパネル、浴槽など');
    }

    const actionRow = Array.from(quickAdd.children).find((child) =>
      child instanceof HTMLElement && child.querySelectorAll(':scope > button').length >= 4
    );
    if (actionRow instanceof HTMLElement) {
      const buttons = Array.from(actionRow.querySelectorAll<HTMLButtonElement>(':scope > button'));
      buttons.slice(0, -1).forEach((button) => {
        button.style.display = 'none';
      });
      const addButton = buttons.at(-1);
      if (addButton) {
        addButton.style.display = '';
        setTextIfChanged(addButton, '＋ 選択項目を追加');
      }
    }
  }

  section.querySelectorAll<HTMLInputElement>('input[id^="variant-group-name-"]').forEach((input) => {
    input.placeholder = '例：床／カウンター／アクセントパネル／浴槽';
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (!label) return;
    setTextIfChanged(label, '選択項目名');
    const field = label.parentElement;
    const hint = field
      ? Array.from(field.querySelectorAll<HTMLElement>('p')).find((row) => row.textContent?.includes('例：'))
      : null;
    if (hint) setTextIfChanged(hint, '例：床／カウンター／アクセントパネル／浴槽');
  });
}

function hideCreateSizeField() {
  const input = document.getElementById('size_note-create');
  if (!(input instanceof HTMLElement)) return;
  const wrapper = directGridChild(input);
  if (wrapper) wrapper.style.display = 'none';
}

export function OptionRegistrationUiEnhancer({
  hideCreateSize = false,
  scrollAfterCreate = false,
}: {
  hideCreateSize?: boolean;
  scrollAfterCreate?: boolean;
}) {
  const scrolledRef = useRef(false);

  useEffect(() => {
    const enhance = () => {
      enhanceCategorySelects();
      enhanceSalesSettings();
      simplifyRegistrationGuidance();
      enhanceProductImages();
      enhanceCustomerSelection();
      if (hideCreateSize) hideCreateSizeField();
    };

    enhance();

    const observer = new MutationObserver(() => {
      observer.disconnect();
      enhance();
      observer.observe(document.body, { childList: true, subtree: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hideCreateSize]);

  useEffect(() => {
    if (!scrollAfterCreate || scrolledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('created')) return;
    scrolledRef.current = true;

    const timer = window.setTimeout(() => {
      const target = document.getElementById('basic-info-saved') ?? document.getElementById('product-details');
      if (!target) return;
      target.style.scrollMarginTop = '96px';
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [scrollAfterCreate]);

  return null;
}