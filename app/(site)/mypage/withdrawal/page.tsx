import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { requestCustomerWithdrawalAction } from '@/lib/actions/customer-account-lifecycle';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { Container, Section } from '@/components/ui';

export default async function CustomerWithdrawalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser('/mypage/withdrawal');
  if (user.role !== 'customer') redirect('/mypage?forbidden=1');
  const sp = await searchParams;

  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-2xl">
        <Link href="/mypage/profile" className="text-sm text-ink-soft underline underline-offset-4 hover:underline">← 登録情報の変更へ戻る</Link>
        <h1 className="mt-5 text-3xl">退会手続き</h1>
        <p className="mt-3 text-sm leading-7 text-ink-soft">
          退会申請と、過去の見積・契約・請求などの業務記録の削除は別の手続きです。
          退会後も保存義務等により一部の記録を保持する場合があります。
        </p>
        {sp.requested === '1' ? (
          <div role="status" className="card mt-7 space-y-2 p-5" data-testid="withdrawal-requested">
            <h2 className="font-semibold">退会申請を受け付けました</h2>
            <p className="text-sm leading-6 text-ink-soft">
              現段階では申請の受付であり、アカウント削除・ログイン停止の完了を意味しません。
              内容を確認したうえで退会手続きを進めます。
            </p>
          </div>
        ) : (
          <div className="card mt-7 space-y-4 p-5" data-testid="customer-withdrawal-form">
            <h2 className="font-semibold">退会を申請する</h2>
            <p className="text-sm leading-6 text-ink-soft">
              退会をご希望の場合は申請してください。進行中の案件がある場合は確認が必要です。
              この操作では見積書や契約記録を削除しません。
            </p>
            <form action={requestCustomerWithdrawalAction} className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input name="confirmed" type="checkbox" value="yes" required className="mt-1" />
                <span>過去の見積・契約履歴は必要に応じて保管されることを確認しました。</span>
              </label>
              <ConfirmSubmit
                className="btn-secondary btn-sm"
                destructive={false}
                dialogTitle="退会申請を送信しますか？"
                confirmLabel="申請する"
                message="退会申請を送信します。これは即時削除ではありません。"
              >
                退会を申請
              </ConfirmSubmit>
            </form>
          </div>
        )}
        {sp.error === 'unavailable' && (
          <p role="alert" className="mt-4 text-sm text-danger">
            現在、退会申請を受け付けるDB機能が利用できません。申請は登録されていません。
          </p>
        )}
        {sp.error === 'invalid' && (
          <p role="alert" className="mt-4 text-sm text-danger">
            確認事項に同意してからお手続きください。
          </p>
        )}
        {sp.error === 'blocked' && (
          <p role="alert" className="mt-4 text-sm text-danger">
            申請を完了できませんでした。内容を確認のうえ、管理者にお問い合わせください。
          </p>
        )}
      </Container>
    </Section>
  );
}
