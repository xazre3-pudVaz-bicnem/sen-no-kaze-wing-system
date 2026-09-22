import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { requireStaff, requireUser } from '@/lib/auth/session';
import { AdminShell } from '@/components/admin/admin-shell';

export const metadata: Metadata = {
  title: { default: '管理画面', template: '%s｜Wing 管理画面' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-wing-pathname') ?? '';
  const migrationRoute = pathname === '/admin/base-migration' || pathname.startsWith('/admin/base-migration/');
  const user = migrationRoute
    ? await requireUser('/admin/base-migration')
    : await requireStaff();
  const migrationOnly = migrationRoute && user.role === 'customer';
  return <AdminShell email={user.email} role={user.role} migrationOnly={migrationOnly}>{children}</AdminShell>;
}
