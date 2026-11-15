import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/session';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import { INVITATION_COOKIE, INVITATION_TOKEN, ORGANIZATION_TYPE_LABEL, memberRoleLabel } from '@/lib/domain/organizations';
import { acceptInvitationAction } from '@/lib/actions/organizations';
import { AuthShell } from '@/components/auth/auth-shell';
import { Alert, Button } from '@/components/ui';

export const metadata: Metadata = {
  title: '組織への招待',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

const STATE_MESSAGE = {
  accepted: 'この招待はすでに使われています。',
  revoked: 'この招待は取り消されています。招待した方にご確認ください。',
  expired: '招待の有効期限が切れています。招待した方に、もう一度送ってもらってください。',
  organization_inactive: '招待された組織が停止中のため、参加できません。本部にご相談ください。',
} as const;

/** 招待の画面。鍵は招待メールのリンク（/invite/鍵）を開いたときに Cookie へ移してある（app/(site)/invite/[token]/route.ts） */
export default async function InvitationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const actor = await requireUser('/invite');
  const token = (await cookies()).get(INVITATION_COOKIE)?.value ?? '';
  const store = await getOrganizationStore();
  const preview = INVITATION_TOKEN.test(token) ? await store.previewInvitation(actor, token) : null;

  return (
    <AuthShell title="組織への招待" lead="招待されたメールアドレスでログインしているときだけ参加できます。">
      <div className="space-y-4" data-testid="invitation-card">
        {sp.error && <Alert tone="danger">{sp.error}</Alert>}
        {!preview ? (
          <Alert tone="danger">招待が見つかりません。メールのリンクをもう一度ご確認ください。</Alert>
        ) : (
          <>
            <dl className="card grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 p-5 text-sm">
              <dt className="text-muted">組織</dt>
              <dd className="font-semibold">
                {preview.organization_name}
                <span className="ml-2 text-xs font-normal text-muted">{ORGANIZATION_TYPE_LABEL[preview.organization_type]}</span>
              </dd>
              <dt className="text-muted">役割</dt>
              <dd>{memberRoleLabel(preview.member_role)}</dd>
              <dt className="text-muted">招待先</dt>
              <dd>{preview.email_hint}</dd>
              <dt className="text-muted">ログイン中</dt>
              <dd className="break-all">{actor.email}</dd>
            </dl>
            {preview.state === 'open' ? (
              <form action={acceptInvitationAction} className="space-y-3">
                <p className="text-xs leading-5 text-muted">参加すると、この組織のメンバーとして管理画面を使えるようになります。</p>
                <Button type="submit" data-testid="invitation-accept">
                  参加する
                </Button>
              </form>
            ) : (
              <Alert tone="warn">{STATE_MESSAGE[preview.state]}</Alert>
            )}
          </>
        )}
        <p className="text-sm">
          <Link href="/mypage" className="text-ink-soft underline-offset-4 hover:underline">
            マイページへ戻る
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
