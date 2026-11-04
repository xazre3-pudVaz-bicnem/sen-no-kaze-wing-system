import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { buildMetadata } from '@/lib/seo';
import { safeNextPath } from '@/lib/utils';
import { AUTH_LINK_ERROR } from '@/lib/auth/password-reset';
import { Alert } from '@/components/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: 'ログイン', description: 'Wing マイページへのログイン', path: '/login', noindex: true });

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const safeNext = safeNextPath(next, '/mypage');
  const user = await getSessionUser();
  if (user) redirect(safeNext);
  return (
    <AuthShell title="ログイン" lead="保存した仕様の編集、見積依頼、見積書PDFの確認にはログインが必要です。">
      {error === 'link' && (
        <Alert tone="warn" className="mb-5">
          {AUTH_LINK_ERROR}
        </Alert>
      )}
      <LoginForm next={safeNext} />
    </AuthShell>
  );
}
