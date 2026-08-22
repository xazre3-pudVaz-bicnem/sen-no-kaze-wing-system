import { buildMetadata } from '@/lib/seo';
import { AuthShell } from '@/components/auth/auth-shell';
import { ResetRequestForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: 'パスワード再設定', description: 'パスワード再設定の案内を送信します', path: '/reset-password', noindex: true });

export default function ResetPasswordPage() {
  return (
    <AuthShell title="パスワード再設定" lead="登録したメールアドレスを入力してください。再設定用のリンクをお送りします。">
      <ResetRequestForm />
    </AuthShell>
  );
}
