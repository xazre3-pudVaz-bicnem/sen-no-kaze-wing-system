import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { buildMetadata } from '@/lib/seo';
import { safeNextPath } from '@/lib/utils';
import { AUTH_LINK_ERROR, firstParam } from '@/lib/auth/password-reset';
import { EMAIL_CONFIRMED_SIGN_IN } from '@/lib/auth/email-confirm';
import { Alert } from '@/components/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { LoginForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: 'ログイン', description: 'Wing マイページへのログイン', path: '/login', noindex: true });

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[]; confirmed?: string | string[] }>;
}) {
  const params = await searchParams;
  const safeNext = safeNextPath(firstParam(params.next), '/mypage');
  const error = firstParam(params.error);
  // 会員登録の確認メールのリンクを、登録した時と別のブラウザで開いた（確認は済んでいる。app/auth/callback）
  const confirmed = firstParam(params.confirmed) === '1';
  const user = await getSessionUser();
  if (user) redirect(safeNext);
  return (
    <AuthShell title="ログイン" lead="保存した仕様の編集、見積依頼、見積書PDFの確認にはログインが必要です。">
      {confirmed && error !== 'link' && (
        <Alert tone="success" className="mb-5">
          {EMAIL_CONFIRMED_SIGN_IN}
        </Alert>
      )}
      {error === 'link' && (
        <Alert tone="warn" className="mb-5">
          {AUTH_LINK_ERROR}
        </Alert>
      )}
      <LoginForm next={safeNext} />
    </AuthShell>
  );
}
