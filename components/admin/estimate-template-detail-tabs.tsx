'use client';

import { useState, type ReactNode } from 'react';

type DetailTab = 'edit' | 'estimate' | 'plan';

export function EstimateTemplateDetailTabs({
  editContent,
  estimateContent,
  planContent,
}: {
  editContent: ReactNode;
  estimateContent: ReactNode;
  planContent: ReactNode;
}) {
  const [tab, setTab] = useState<DetailTab>('edit');

  const tabClass = (key: DetailTab) =>
    `min-h-10 border-b-2 px-4 py-2 text-sm font-semibold transition ${
      tab === key
        ? 'border-forest text-forest'
        : 'border-transparent text-muted hover:border-line hover:text-ink'
    }`;

  return (
    <section className="space-y-4">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-1 border-b border-line px-3" role="tablist" aria-label="見積書の表示切替">
          <button type="button" role="tab" aria-selected={tab === 'edit'} onClick={() => setTab('edit')} className={tabClass('edit')}>
            編集
          </button>
          <button type="button" role="tab" aria-selected={tab === 'estimate'} onClick={() => setTab('estimate')} className={tabClass('estimate')}>
            見積書
          </button>
          <button type="button" role="tab" aria-selected={tab === 'plan'} onClick={() => setTab('plan')} className={tabClass('plan')}>
            プランボード
          </button>
        </div>
        {tab !== 'edit' && (
          <div className="border-b border-line bg-amber-50/60 px-4 py-2 text-xs leading-relaxed text-ink-soft">
            現在は保存済み・取込済み内容の確認です。編集画面の未保存変更は、正式保存機能の接続後に反映する予定です。
          </div>
        )}
      </div>

      <div className={tab === 'edit' ? 'block' : 'hidden'} aria-hidden={tab !== 'edit'}>
        {editContent}
      </div>
      {tab === 'estimate' && estimateContent}
      {tab === 'plan' && planContent}
    </section>
  );
}
