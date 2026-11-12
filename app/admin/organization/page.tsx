import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import { Alert } from '@/components/ui';
import { AdminPage } from '@/components/admin/ui';

export const metadata: Metadata = { title: '自社の組織 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** 自分の所属する組織の画面へ案内する（本部は組織の一覧へ） */
export default async function MyOrganizationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaff('/admin/organization');
  const sp = await searchParams;
  const store = await getOrganizationStore();
  const mine = await store.getMyOrganization(actor);
  if (mine) redirect(`/admin/organizations/${mine.organization_id}${sp.joined ? '?joined=1' : ''}`);
  if (actor.role === 'admin') redirect('/admin/organizations');
  return (
    <AdminPage title="自社の組織">
      <Alert tone="info">所属している組織はまだありません。組織への参加は、本部または組織の管理者からの招待で行います。</Alert>
    </AdminPage>
  );
}
