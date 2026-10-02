'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export function CaseEstimateSelectableRow({
  href,
  selected,
  children,
}: {
  href: string;
  selected: boolean;
  children: ReactNode;
}) {
  const router = useRouter();

  const open = () => {
    router.push(href);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  return (
    <tr
      tabIndex={0}
      aria-selected={selected}
      data-testid="case-estimate-row"
      onClick={open}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => router.prefetch(href)}
      className={
        selected
          ? 'cursor-pointer border-t border-line bg-[#fff7df] shadow-[inset_4px_0_0_#2f6b4f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest/40'
          : 'cursor-pointer border-t border-line hover:bg-[#f8faf9] focus-visible:bg-[#f8faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-forest/40'
      }
    >
      {children}
    </tr>
  );
}
