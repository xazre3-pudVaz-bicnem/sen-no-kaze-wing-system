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
  if (intro) intro.textContent = '価格と対象モデルを設定します。公開はSTEP 2で行います。';

  const priceInput = section.querySelector<HTMLInputElement>('input[name="price"]');
  if (priceInput) {
    const wrapper = directGridChild(priceInput);
    const hint = wrapper
      ? Array.from(wrapper.querySelectorAll('p')).find((row) => row.textContent?.includes('価格未確認なら0円'))
      : null;
    if (hint) hint.textContent = '0円のまま下書き保存できます。公開時に0円でよいか確認します。';
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
      if (hint && hint.textContent?.includes('STEP 2')) hint.textContent = '公開はSTEP 2の確認画面から行います。';
      draftStatus.dataset[DRAFT_STATUS_MARKER] = 'true';
    }
  }
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
    enhanceCategorySelects();
    enhanceSalesSettings();
    if (hideCreateSize) hideCreateSizeField();

    const observer = new MutationObserver(() => {
      enhanceCategorySelects();
      enhanceSalesSettings();
      if (hideCreateSize) hideCreateSizeField();
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
