import Link from 'next/link';
import { buildMetadata } from '@/lib/seo';
import { getSessionUser } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { hasSupabaseEnv } from '@/lib/supabase/server';
import { PASSWORD_RESET_LINK_ERROR } from '@/lib/auth/password-reset';
import { Alert } from '@/components/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { UpdatePasswordForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: '新しいパスワードの設定', description: '新しいパスワードを設定します', path: '/reset-password/update', noindex: true });

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // メールのリンクからは /auth/callback でログインした状態で来る。ログインしていなければ入力しても更新できないので、申し込みへ案内する
  const linkMissing = !isLocalMode() && hasSupabaseEnv() && !(await getSessionUser());
  return (
    <AuthShell title="新しいパスワードの設定">
      {linkMissing ? (
        <div className="space-y-5">
          <Alert tone="warn">{PASSWORD_RESET_LINK_ERROR}</Alert>
          <Link href="/reset-password" className="btn-primary w-full">
            再設定メールを送り直す
          </Link>
        </div>
      ) : (
        <UpdatePasswordForm token={token ?? null} />
      )}
    </AuthShell>
  );
}
