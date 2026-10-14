import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { ROLE_LABELS } from '@/lib/domain/types';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '代理店の紹介ページ | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** 代理店の紹介ページ（フェーズ4・代理店マスタ）。本部はすべての代理店、代理店は自分のページだけ */
export default async function AdminDealersPage() {
  const actor = await requireStaff('/admin/dealers');
  if (actor.role !== 'admin') redirect(`/admin/dealers/${actor.id}`);
  const store = await getStore();
  const caseFlow = await getCaseFlowStore();
  const [dealers, profiles] = await Promise.all([store.listCaseDealers(), caseFlow.listDealerProfiles(actor)]);

  return (
    <AdminPage
      title="代理店の紹介ページ"
      lead="代理店・総代理店の対応エリア・施工対応・資格・実績を登録し、お客様の代理店検索（/dealers）に公開します。公開・非公開は本部が決めます。"
    >
      <Table minWidth="44rem">
        <thead>
          <tr>
            <Th>代理店</Th>
            <Th>権限</Th>
            <Th>紹介ページ</Th>
            <Th>対応エリア</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody>
          {dealers.map((dealer) => {
            const profile = profiles.find((p) => p.dealer_id === dealer.id);
            return (
              <tr key={dealer.id} data-testid="admin-dealer-row">
                <Td>{dealer.company_name || dealer.full_name}</Td>
                <Td>{ROLE_LABELS[dealer.role_code]}</Td>
                <Td>
                  {profile ? (
                    profile.published ? <Badge tone="success">公開中</Badge> : <Badge tone="warn">非公開</Badge>
                  ) : (
                    <span className="text-muted">未登録</span>
                  )}
                </Td>
                <Td>{profile?.service_prefectures.join('・') || '—'}</Td>
                <Td>
                  <Link href={`/admin/dealers/${dealer.id}`} className="underline-offset-4 hover:underline">
                    {profile ? '編集' : '登録'}
                  </Link>
                </Td>
              </tr>
            );
          })}
          {dealers.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-muted">
                代理店・総代理店のアカウントはまだありません（管理設定の「ユーザー・担当者」で権限を設定します）。
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
