import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { requireStaff, requireUser } from '@/lib/auth/session';
import { canSuperviseCases } from '@/lib/data/organizations/store';
import { AdminShell } from '@/components/admin/admin-shell';
import { ProductRegistrationFinalRefinements } from '@/components/admin/product-registration-final-refinements';
import { ProductRegistrationStep2Refinements } from '@/components/admin/product-registration-step2-refinements';
import './product-registration-refinements.css';

export const metadata: Metadata = {
  title: { default: '千の風プロジェクト 管理画面', template: '%s｜千の風プロジェクト 管理画面' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-wing-pathname') ?? '';
  const migrationRoute = pathname === '/admin/base-migration' || pathname.startsWith('/admin/base-migration/');
  const user = migrationRoute
    ? await requireUser('/admin/base-migration')
    : await requireStaff();
  const migrationOnly = migrationRoute && user.role === 'customer';
  // 配下の案件のメニューは、総代理店の組織の管理者だけ（DB と同じ）。ほかの利用者は組織を調べない
  const canSupervise = user.role === 'master_dealer' && !migrationOnly ? await canSuperviseCases(user) : false;
  return (
    <AdminShell
      email={user.email}
      role={user.role}
      fullName={user.full_name}
      companyName={user.company_name}
      migrationOnly={migrationOnly}
      canSupervise={canSupervise}
    >
      <ProductRegistrationFinalRefinements />
      <ProductRegistrationStep2Refinements />
      {children}
    </AdminShell>
  );
}
