import Link from 'next/link';
import { buildMetadata } from '@/lib/seo';
import { getSessionUser } from '@/lib/auth/session';
import { isLocalMode } from '@/lib/data/store';
import { hasSupabaseEnv } from '@/lib/supabase/server';
import { PASSWORD_UPDATE_SIGNED_OUT } from '@/lib/auth/password-reset';
import { Alert } from '@/components/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { UpdatePasswordForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: '新しいパスワードの設定', description: '新しいパスワードを設定します', path: '/reset-password/update', noindex: true });

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  // メールのリンクからは /auth/callback でログインした状態で来る。マイページからはログインした状態で来る。
  // ログインしていなければ入力しても更新できないので、ログインか再設定メールへ案内する
  const signedOut = !isLocalMode() && hasSupabaseEnv() && !(await getSessionUser());
  return (
    <AuthShell title="新しいパスワードの設定">
      {signedOut ? (
        <div className="space-y-5">
          <Alert tone="warn">{PASSWORD_UPDATE_SIGNED_OUT}</Alert>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link href={`/login?next=${encodeURIComponent('/reset-password/update')}`} className="btn-primary w-full">
              ログインして変更する
            </Link>
            <Link href="/reset-password" className="btn-secondary w-full">
              再設定メールを送る
            </Link>
          </div>
        </div>
      ) : (
        <UpdatePasswordForm token={token ?? null} />
      )}
    </AuthShell>
  );
}
