import type { ReactNode } from 'react';
import { Container } from '@/components/ui';

export function AuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <Container className="flex min-h-[60vh] justify-center py-10 sm:py-14">
      <div className="w-full max-w-md">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {lead && <p className="mt-3 text-ink-soft">{lead}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </Container>
  );
}
