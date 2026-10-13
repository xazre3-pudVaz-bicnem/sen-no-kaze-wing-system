'use client';

import { useEffect } from 'react';

export const PRODUCT_LEDGER_SCROLL_STORAGE_KEY = 'product-ledger-scroll-y-after-action';

export function ProductLedgerScrollRestore() {
  useEffect(() => {
    const stored = window.sessionStorage.getItem(PRODUCT_LEDGER_SCROLL_STORAGE_KEY);
    if (stored === null) return;

    window.sessionStorage.removeItem(PRODUCT_LEDGER_SCROLL_STORAGE_KEY);
    const top = Number(stored);
    if (!Number.isFinite(top) || top < 0) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.scrollTo({ top, behavior: 'auto' });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return null;
}
