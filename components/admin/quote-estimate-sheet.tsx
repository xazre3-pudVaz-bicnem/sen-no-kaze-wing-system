'use client';

import { useState } from 'react';
import type { Quote, QuoteItem } from '@/lib/domain/types';
import { QuoteTable } from '@/components/mypage/quote-table';
import { DealerRevisionForm } from '@/components/admin/dealer-forms';
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
  const [editing, setEditing] = useState(startInEditMode && canRevise);

  if (editing && canRevise) {
    return (
      <DealerRevisionForm
        quote={quote}
        items={items}
        freeProducts={freeProducts}
        catalog={catalog}
        canEditBase={canEditBase}
        sheetMode
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="rounded-lg border border-line bg-white shadow-sm" data-testid="quote-estimate-sheet">
      {canRevise && (
        <div className="flex items-center justify-end border-b border-line bg-[#fafbf9] px-3 py-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#9eb6a9] bg-white px-3 py-1.5 text-xs font-semibold text-[#315745] hover:bg-[#f1f7f3]"
            data-testid="quote-edit-toggle"
          >
            ＋新しい見積書
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <QuoteTable quote={quote} items={items} totalTestId="admin-quote-total" showBaseDetail />
      </div>
    </div>
  );
}
