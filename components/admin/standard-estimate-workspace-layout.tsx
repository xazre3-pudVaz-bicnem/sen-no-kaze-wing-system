'use client';

import { useState, type ReactNode } from 'react';

type StandardEstimateWorkspaceLayoutProps = {
  sidebar: ReactNode;
  children?: ReactNode;
  selectedName?: string;
};

/**
 * 標準見積の編集スペースを優先するレイアウト。
 * 仕様一覧は編集欄の上部に展開し、横幅を奪わない。編集状態・保存処理には触れない。
 */
export function StandardEstimateWorkspaceLayout({ sidebar, children, selectedName }: StandardEstimateWorkspaceLayoutProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);

  return (
    <div className="min-w-0 space-y-2" data-testid="standard-estimate-workspace-layout">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm border-emerald-700 text-emerald-900"
          aria-controls="standard-estimate-selector-panel"
          aria-expanded={selectorOpen}
          onClick={() => setSelectorOpen((open) => !open)}
          data-testid="standard-estimate-selector-toggle"
        >
          {selectorOpen ? '仕様の選択を閉じる' : '仕様を変更'}
        </button>
        {selectedName && !selectorOpen && (
          <span className="min-w-0 rounded-md border border-emerald-700 bg-emerald-50 px-2 py-1 text-xs text-emerald-950" title={selectedName} data-testid="v25-selected-spec-summary">
            <span className="font-semibold">現在の仕様：</span>{selectedName}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div
          id="standard-estimate-selector-panel"
          className={selectorOpen ? 'min-w-0 w-full' : 'hidden'}
        >
          {sidebar}
        </div>
        <div className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
