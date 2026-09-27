'use client';

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';

interface Props {
  href: string;
  className?: string;
  children: ReactNode;
  testId?: string;
  selected?: boolean;
  ariaLabel: string;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('a,button,input,select,textarea,summary,details,form'));
}

export function ClickableCaseRow({ href, className, children, testId, selected, ariaLabel }: Props) {
  const router = useRouter();

  const open = () => router.push(href);

  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    if (isInteractiveTarget(event.target)) return;
    open();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  };

  return (
    <tr
      className={`${className ?? ''} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#2f6b4f]`}
      data-testid={testId}
      data-selected={selected ? 'true' : undefined}
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </tr>
  );
}
