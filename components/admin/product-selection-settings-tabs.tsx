'use client';

import { useState, type ReactNode } from 'react';

type SettingsTab = 'matrix' | 'categories';

export function ProductSelectionSettingsTabs({
  initialTab,
  matrix,
  categories,
}: {
  initialTab: SettingsTab;
  matrix: ReactNode;
  categories: ReactNode;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const tabs: { id: SettingsTab; label: string; caption: string }[] = [
    { id: 'matrix', label: '仕様別の選択可否', caption: '機種・仕様・サイズごと' },
    { id: 'categories', label: 'お客様への共通表示', caption: 'すべての機種・仕様に共通' },
  ];

  return (
    <div className="space-y-5" data-testid="product-selection-settings">
      <div role="tablist" aria-label="商品選択設定" className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-white p-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            id={'settings-tab-' + item.id}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={'settings-panel-' + item.id}
            onClick={() => setTab(item.id)}
            className={
              'min-w-0 rounded-lg px-2 py-3 text-center transition sm:px-4 ' +
              (tab === item.id
                ? 'bg-ink text-white'
                : 'text-ink-soft hover:bg-sand hover:text-ink')
            }
          >
            <span className="block text-sm font-semibold sm:text-base">{item.label}</span>
            <span className="mt-1 hidden text-xs opacity-80 sm:block">{item.caption}</span>
          </button>
        ))}
      </div>
      <section
        id="settings-panel-matrix"
        role="tabpanel"
        aria-labelledby="settings-tab-matrix"
        hidden={tab !== 'matrix'}
      >
        {matrix}
      </section>
      <section
        id="settings-panel-categories"
        role="tabpanel"
        aria-labelledby="settings-tab-categories"
        hidden={tab !== 'categories'}
      >
        {categories}
      </section>
    </div>
  );
}
