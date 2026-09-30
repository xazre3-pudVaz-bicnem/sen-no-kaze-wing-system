'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function CaseAdminControls({
  children,
  defaultOpen = false,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (defaultOpen && detailsRef.current) detailsRef.current.open = true;
  }, [defaultOpen]);

  return (
    <details id="case-admin-controls" ref={detailsRef} className="relative text-xs" data-testid="case-admin-controls">
      <summary className="cursor-pointer list-none rounded-md border border-white/35 px-2.5 py-1.5 font-semibold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden">
        案件設定
      </summary>
      <div className="relative mt-2 min-w-[18rem] rounded-lg border border-line bg-white p-3 text-ink shadow-lg sm:min-w-[34rem]">
        <button
          type="button"
          onClick={() => {
            if (detailsRef.current) detailsRef.current.open = false;
          }}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[0.65rem] font-semibold text-ink-soft hover:bg-sand/50"
          aria-label="案件設定を閉じる"
        >
          <X className="size-3.5" aria-hidden="true" />
          閉じる
        </button>
        <div className="grid gap-3 pt-7 sm:grid-cols-2">{children}</div>
      </div>
    </details>
  );
}
