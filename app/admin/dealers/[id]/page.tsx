import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { setDealerProfilePublishedAction } from '@/lib/actions/case-flow';
import { PREFECTURES } from '@/lib/domain/address';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, BackLink } from '@/components/admin/ui';
import { DealerProfileForm } from '@/components/case-flow/forms';

export const metadata: Metadata = { title: '代理店の紹介ページ | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 代理店の紹介ページの編集。代理店は自分のページだけ。公開・非公開は本部だけ */
export default async function AdminDealerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireStaff(`/admin/dealers/${id}`);
  if (!UUID.test(id)) notFound();
  const isAdmin = actor.role === 'admin';
  if (!isAdmin && actor.id !== id) notFound();

  const store = await getStore();
  const caseFlow = await getCaseFlowStore();
  const dealers = isAdmin ? await store.listCaseDealers() : [];
  const dealer = isAdmin ? dealers.find((d) => d.id === id) : { id: actor.id, role_code: actor.role, full_name: actor.full_name, company_name: actor.company_name };
  if (!dealer || (dealer.role_code !== 'dealer' && dealer.role_code !== 'master_dealer')) notFound();
  const profile = await caseFlow.getDealerProfile(actor, id);

  return (
    <AdminPage
      title={`紹介ページ：${dealer.company_name || dealer.full_name}`}
      lead="お客様の代理店検索（/dealers）と、見積依頼の「相談したい代理店」に表示する内容です。"
      actions={isAdmin ? <BackLink href="/admin/dealers" label="代理店の一覧へ" /> : undefined}
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.done === 'published' && <Alert tone="success">紹介ページを公開しました。</Alert>}
      {sp.done === 'unpublished' && <Alert tone="success">紹介ページを非公開にしました。</Alert>}
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4 text-sm" data-testid="dealer-publish-panel">
        <span>公開状態：</span>
        {profile?.published ? <Badge tone="success">公開中</Badge> : <Badge tone="warn">{profile ? '非公開' : '未登録'}</Badge>}
        {isAdmin && profile && (
          <form action={setDealerProfilePublishedAction}>
            <input type="hidden" name="dealer_id" value={id} />
            <input type="hidden" name="expected_lock_version" value={profile.lock_version} />
            <input type="hidden" name="published" value={profile.published ? 'false' : 'true'} />
            <button type="submit" className="btn-secondary btn-sm">
              {profile.published ? '非公開にする' : '公開する'}
            </button>
          </form>
        )}
        {!isAdmin && <span className="text-xs text-muted">公開・非公開は本部が決めます。内容を保存したら本部へご連絡ください。</span>}
      </section>
      <section className="rounded-lg border border-line bg-white p-5">
        <DealerProfileForm dealerId={id} profile={profile} prefectures={PREFECTURES} />
      </section>
    </AdminPage>
  );
}
