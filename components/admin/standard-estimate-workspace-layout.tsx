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
          className="btn-secondary btn-sm"
          aria-controls="standard-estimate-selector-panel"
          aria-expanded={selectorOpen}
          onClick={() => setSelectorOpen((open) => !open)}
          data-testid="standard-estimate-selector-toggle"
        >
          {selectorOpen ? '仕様一覧を閉じる' : '仕様一覧を開く'}
        </button>
        {selectedName && (
          <span className="min-w-0 truncate text-xs text-muted" title={selectedName}>
            選択中：{selectedName}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div
          id="standard-estimate-selector-panel"
          className={selectorOpen ? 'min-w-0' : 'hidden'}
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
