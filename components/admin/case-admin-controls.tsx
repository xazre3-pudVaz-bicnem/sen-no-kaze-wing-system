'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function CaseAdminControls({
  children,
  defaultOpen = false,
  label = '案件設定',
  variant = 'header',
  summaryTestId,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  label?: string;
  variant?: 'header' | 'primary' | 'compact';
  summaryTestId?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (defaultOpen && detailsRef.current) detailsRef.current.open = true;
  }, [defaultOpen]);

  const summaryClassName =
    variant === 'primary'
      ? 'inline-flex cursor-pointer list-none items-center rounded-lg bg-[#2f6b4f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#285d45] [&::-webkit-details-marker]:hidden'
      : variant === 'compact'
        ? 'inline-flex cursor-pointer list-none items-center rounded border border-white/35 px-1.5 py-0.5 text-[0.58rem] font-semibold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden'
        : 'cursor-pointer list-none rounded-md border border-white/35 px-2.5 py-1.5 font-semibold text-white hover:bg-white/10 [&::-webkit-details-marker]:hidden';

  return (
    <details id="case-admin-controls" ref={detailsRef} className="relative text-xs" data-testid="case-admin-controls">
      <summary className={summaryClassName} data-testid={summaryTestId}>
        {label}
      </summary>
      <div className="relative mt-2 min-w-[18rem] rounded-lg border border-line bg-white p-3 text-ink shadow-lg sm:min-w-[34rem]">
        <button
          type="button"
          onClick={() => {
            if (detailsRef.current) detailsRef.current.open = false;
          }}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[0.65rem] font-semibold text-ink-soft hover:bg-sand/50"
          aria-label="担当代理店の選択を閉じる"
        >
          <X className="size-3.5" aria-hidden="true" />
          閉じる
        </button>
        <div className="pt-7">{children}</div>
      </div>
    </details>
  );
}
