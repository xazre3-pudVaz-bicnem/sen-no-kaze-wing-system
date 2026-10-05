import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { DEMO_CUSTOMERS, DEMO_UNLINKED_CASES } from '@/lib/demo/customer-management';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { CustomerManagementList } from '@/components/admin/customer-management-list';
import { Badge } from '@/components/ui';

function unlinkedReason(issue: 'inconsistent_user_id' | 'missing_profile' | 'non_customer_profile'): string {
  if (issue === 'inconsistent_user_id') return '顧客情報の確認が必要';
  if (issue === 'non_customer_profile') return '顧客アカウント未確定';
  return '顧客アカウント未確認';
}

export default async function AdminCustomerManagementDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStaff('/admin/customer-management/demo');
  const sp = await searchParams;
  const showDealerColumn = actor.role === 'admin' || actor.role === 'master_dealer';

  return (
    <AdminPage
      title="顧客管理"
      lead="顧客を探し、現在の案件を確認して、必要に応じて案件管理や顧客詳細へ進むための画面です。"
      actions={
        <Link href="/admin/customer-management" className="btn-secondary btn-sm">実際の顧客管理へ戻る</Link>
      }
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">画面確認用のサンプル表示です。</p>
          <p>
            このページの氏名・会社名・住所・見積番号・金額はすべて架空です。
            本番DBには保存されず、実際の顧客データにも影響しません。
          </p>
        </div>
      }
    >
      <CustomerManagementList
        customers={DEMO_CUSTOMERS}
        searchParams={sp}
        showDealerColumn={showDealerColumn}
        basePath="/admin/customer-management/demo"
        headingId="demo-customer-list-heading"
        demo
      />

      <section className="space-y-3" aria-labelledby="demo-unlinked-cases-heading">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="demo-unlinked-cases-heading" className="text-lg font-semibold">顧客未紐付け案件</h2>
            <Badge tone="warn">{DEMO_UNLINKED_CASES.length} 件</Badge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-muted">
            顧客アカウントとの紐付けを確認できていない案件がある場合の表示例です。
          </p>
        </div>

        <Table minWidth="44rem">
          <thead className="bg-[#fff8e8]">
            <tr>
              <Th>案件上のお客様</Th>
              <Th>確認が必要な理由</Th>
              <Th>案件・設置予定地</Th>
              <Th>担当代理店</Th>
              <Th>確認</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {DEMO_UNLINKED_CASES.map((customerCase) => (
              <tr key={customerCase.id} data-testid="unlinked-customer-demo-row">
                <Td>
                  <p className="font-semibold">{customerCase.full_name}</p>
                  <p className="mt-1 text-xs text-muted">{customerCase.company_name ?? '法人名なし'}</p>
                </Td>
                <Td className="text-xs"><Badge tone="warn">{unlinkedReason(customerCase.identity_issue)}</Badge></Td>
                <Td className="text-xs">
                  <span className="block font-semibold">{customerCase.quote_no ?? '見積未発行'}</span>
                  <span className="mt-1 block text-muted">{customerCase.model_name ?? '商品モデル未登録'}／{formatDate(customerCase.activity_at)}</span>
                  <span className="mt-1 block text-muted">設置予定地：{customerCase.site_address ?? '未登録'}</span>
                </Td>
                <Td className="text-xs">{customerCase.dealer_name ?? '未割り当て'}</Td>
                <Td><span className="btn-secondary btn-sm cursor-default opacity-60">案件を見る（デモ）</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
