import { buildMetadata } from '@/lib/seo';
import { AuthShell } from '@/components/auth/auth-shell';
import { UpdatePasswordForm } from '@/components/auth/auth-forms';

export const metadata = buildMetadata({ title: '新しいパスワードの設定', description: '新しいパスワードを設定します', path: '/reset-password/update', noindex: true });

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="新しいパスワードの設定">
      <UpdatePasswordForm token={token ?? null} />
    </AuthShell>
  );
}
