'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type DismissibleDetailsProps = {
  children: ReactNode;
  className?: string;
};

/** details要素を、枠外クリック時に閉じられるようにする薄いラッパー。 */
export function DismissibleDetails({ children, className }: DismissibleDetailsProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (!details?.open) return;

      if (event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return (
    <details ref={detailsRef} className={className}>
      {children}
    </details>
  );
}
