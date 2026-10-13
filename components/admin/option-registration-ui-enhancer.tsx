'use client';

import { useEffect, useRef } from 'react';

const GROUPED_SELECT_MARKER = 'registrationGroupedSelect';
const GROUPED_SELECT_SUFFIX = '-grouped';
const GROUP_LABEL_PATTERN = /^【([^】]+)】\s*(.+)$/;

function directGridChild(element: HTMLElement): HTMLElement | null {
  const grid = element.closest('.grid');
  if (!(grid instanceof HTMLElement)) return null;

  let current: HTMLElement | null = element;
  while (current && current.parentElement !== grid) current = current.parentElement;
  return current;
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

  const syncToOriginal = () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (setter) setter.call(original, grouped.value);
    else original.value = grouped.value;
    original.dispatchEvent(new Event('change', { bubbles: true }));
  };
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
    if (hideCreateSize) hideCreateSizeField();

    const observer = new MutationObserver(() => {
      enhanceCategorySelects();
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