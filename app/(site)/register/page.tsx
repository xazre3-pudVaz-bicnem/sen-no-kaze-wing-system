import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { buildMetadata } from '@/lib/seo';
import { safeNextPath } from '@/lib/utils';
import { AuthShell } from '@/components/auth/auth-shell';
import { RegisterForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: '新規会員登録', description: 'Wing マイページの新規会員登録', path: '/register', noindex: true });

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = safeNextPath(next, '/mypage');
  const user = await getSessionUser();
  if (user) redirect(safeNext);
  return (
    <AuthShell title="新規会員登録" lead="登録は無料です。シミュレーションの保存と見積依頼にご利用ください。">
      <RegisterForm next={safeNext} />
    </AuthShell>
  );
}
