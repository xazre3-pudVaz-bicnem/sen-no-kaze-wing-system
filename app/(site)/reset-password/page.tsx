import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { buildMetadata } from '@/lib/seo';
import { getSiteUrl } from '@/lib/site';
import { isLocalMode } from '@/lib/data/store';
import { hasSupabaseEnv } from '@/lib/supabase/server';
import { PASSWORD_RESET_LINK_ERROR, passwordResetCanonicalUrl, requestHost } from '@/lib/auth/password-reset';
import { Alert } from '@/components/ui';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetRequestForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: 'パスワード再設定', description: 'パスワード再設定の案内を送信します', path: '/reset-password', noindex: true });

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!isLocalMode() && hasSupabaseEnv()) {
    // メールのリンクの戻り先（NEXT_PUBLIC_SITE_URL）と同じホストで申し込ませる。
    // 本人確認の Cookie は申し込んだ画面のホストにしか残らないため、違うと必ず失敗する（独自ドメインと vercel.app）
    const canonical = passwordResetCanonicalUrl(getSiteUrl(), requestHost(await headers()));
    if (canonical) redirect(error === 'link' ? `${canonical}?error=link` : canonical);
  }
  return (
    <AuthShell title="パスワード再設定" lead="登録したメールアドレスを入力してください。再設定用のリンクをお送りします。">
      {error === 'link' && (
        <Alert tone="warn" className="mb-5">
          {PASSWORD_RESET_LINK_ERROR}
        </Alert>
      )}
      <ResetRequestForm />
    </AuthShell>
  );
}
