import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { Container, Section } from '@/components/ui';
import { ProfileForm } from '@/components/mypage/profile-form';

export default async function ProfilePage() {
  const user = await requireUser('/mypage/profile');
  const store = await getStore();
  const profile = await store.getProfile(user.id);
  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-2xl">
        <Link href="/mypage" className="text-sm text-ink-soft underline-offset-4 hover:underline">← マイページへ戻る</Link>
        <h1 className="mt-4 text-3xl sm:text-4xl">登録情報の変更</h1>
        <p className="mt-2 text-sm text-ink-soft">メールアドレス：{profile?.email ?? user.email}</p>
        <div className="mt-8">
          <ProfileForm
            defaults={{
              full_name: profile?.full_name ?? '',
              company_name: profile?.company_name ?? '',
              phone: profile?.phone ?? '',
              postal_code: profile?.postal_code ?? '',
              address: profile?.address ?? '',
            }}
          />
        </div>
        <p className="mt-8 text-sm">
          パスワードの変更は <Link href="/reset-password/update" className="underline underline-offset-4">こちら</Link>
        </p>
      </Container>
    </Section>
  );
}
