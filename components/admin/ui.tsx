import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { Alert } from '@/components/ui';

export function AdminPage({ title, lead, actions, children }: { title: string; lead?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">{title}</h1>
          {lead && <p className="mt-1 text-sm text-ink-soft">{lead}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}

export function FlashMessages({ sp }: { sp: Record<string, string | undefined> }) {
  return (
    <>
      {sp.saved && <Alert tone="success">保存しました。</Alert>}
      {sp.deleted && <Alert tone="success">削除しました。</Alert>}
      {sp.image_deleted && <Alert tone="success">画像を削除しました。</Alert>}
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
    </>
  );
}

export function Table({ children, minWidth = '40rem' }: { children: ReactNode; minWidth?: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 text-xs font-semibold text-muted ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

export function Td({
  children,
  right,
  className = '',
  ...rest
}: ComponentProps<'td'> & { right?: boolean }) {
  return (
    <td {...rest} className={`px-4 py-3 align-top ${right ? 'text-right tabular-nums' : ''} ${className}`}>
      {children}
    </td>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-sm text-ink-soft underline-offset-4 hover:underline">
      ← {label}
    </Link>
  );
}

export function Stat({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const inner = (
    <div className="card p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-serif text-3xl">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
