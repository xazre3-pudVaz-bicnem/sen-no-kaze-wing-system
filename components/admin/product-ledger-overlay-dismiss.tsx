'use client';

import { useEffect } from 'react';

export function ProductLedgerOverlayDismiss() {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (window.matchMedia('(min-width: 1280px)').matches) return;

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const pane = target.closest<HTMLElement>('[data-testid="ledger-product-detail-pane"]');
      if (!pane || target !== pane) return;

      pane.querySelector<HTMLButtonElement>('button[aria-label="商品詳細を閉じる"]')?.click();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return null;
}
