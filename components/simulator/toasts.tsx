'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warn';
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lift',
            t.tone === 'success' && 'border-success/30 bg-white text-success',
            t.tone === 'warn' && 'border-warn/40 bg-white text-warn',
            t.tone === 'info' && 'border-line bg-white text-ink'
          )}
        >
          <p className="flex-1">{t.message}</p>
          <button type="button" onClick={() => onDismiss(t.id)} aria-label="閉じる" className="rounded p-0.5 hover:bg-sand">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
