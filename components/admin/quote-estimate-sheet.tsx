'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Quote, QuoteItem } from '@/lib/domain/types';
import { QuoteReferenceDetails, QuoteTable } from '@/components/mypage/quote-table';
import { DealerRevisionForm } from '@/components/admin/dealer-forms';
import { LegacyAcceptedFormalizationEntry } from '@/components/admin/legacy-accepted-formalization-entry';
import type { CatalogPickerItem } from '@/components/admin/catalog-picker';

export function QuoteEstimateSheet({
  quote,
  items,
  freeProducts,
  catalog,
  canEditBase,
  canRevise,
  startInEditMode = false,
}: {
  quote: Quote;
  items: QuoteItem[];
  freeProducts: { code: string; name: string; price: number }[];
  catalog: CatalogPickerItem[];
  canEditBase: boolean;
  canRevise: boolean;
  startInEditMode?: boolean;
}) {
  // v2.5 の標準見積から作った見積（v2.5 PR-D1）は、固定した版の v2.5 の決まりで発行する編集画面で改訂する
  const v25 = quote.pricing_model === 'v2.5';
  const [editing, setEditing] = useState(startInEditMode && canRevise && !v25);

  if (editing && canRevise && !v25) {
    return (
      <div className="space-y-2" data-testid="quote-estimate-editing">
        <DealerRevisionForm
          quote={quote}
          items={items}
          freeProducts={freeProducts}
          catalog={catalog}
          canEditBase={canEditBase}
          sheetMode
          onCancel={() => setEditing(false)}
        />
        <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <QuoteReferenceDetails quote={quote} items={items} showSelectedImages={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-sm" data-testid="quote-estimate-sheet">
      <LegacyAcceptedFormalizationEntry quote={quote} />
      {canRevise && (
        <div className="flex items-center justify-end border-b border-line bg-[#fafbf9] px-3 py-2">
          {v25 ? (
            <Link
              href={`/admin/quotes/${quote.id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#9eb6a9] bg-white px-3 py-1.5 text-xs font-semibold text-[#315745] hover:bg-[#f1f7f3]"
              data-testid="quote-edit-v25"
            >
              見積内容を更新（v2.5）
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#9eb6a9] bg-white px-3 py-1.5 text-xs font-semibold text-[#315745] hover:bg-[#f1f7f3]"
              data-testid="quote-edit-toggle"
            >
              見積内容を更新
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <QuoteTable
          quote={quote}
          items={items}
          totalTestId="admin-quote-total"
          showBaseDetail
          showSelectedImages={false}
        />
      </div>
    </div>
  );
}
