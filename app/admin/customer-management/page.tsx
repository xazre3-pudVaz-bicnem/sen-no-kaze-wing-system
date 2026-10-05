import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore, type AccessibleUnlinkedCustomerCase } from '@/lib/data/store';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { CustomerManagementList } from '@/components/admin/customer-management-list';
import { Badge } from '@/components/ui';

function unlinkedReason(customerCase: AccessibleUnlinkedCustomerCase): string {
  if (customerCase.identity_issue === 'inconsistent_user_id') return '顧客情報の確認が必要';
  if (customerCase.identity_issue === 'non_customer_profile') return '顧客アカウント未確定';
  return '顧客アカウント未確認';
}

function caseHref(caseId: string, openQuoteId: string | null): string {
  if (openQuoteId) {
    return `/admin/quotes?case=${encodeURIComponent(openQuoteId)}#case-workspace`;
  }
  return `/admin/quotes?request=${encodeURIComponent(caseId)}#pending-quote-request`;
}

export default async function AdminCustomerManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireStaff('/admin/customer-management');
  const sp = await searchParams;
  const store = await getStore();
  const view = await store.listAccessibleCustomers(actor);
  const showDealerColumn = actor.role === 'admin' || actor.role === 'master_dealer';

  if (view.availability === 'migration_pending') {
    return (
      <AdminPage
        title="顧客管理"
        lead="参照できる顧客を探し、案件・見積・設置予定地を確認するための画面です。"
        notice={
          <div className="space-y-1">
            <p className="font-semibold text-ink">本番DB更新待ちです。</p>
            <p>
              顧客管理用のDB機能がまだ本番へ適用されていないため、この画面では現在の顧客データを取得していません。
            </p>
          </div>
        }
      >
        <section className="card p-5" data-testid="customer-management-migration-pending">
          <h2 className="font-semibold">顧客データはまだ表示できません</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-soft">
            顧客が0件なのではなく、顧客管理用migrationの本番適用待ちです。DB更新後はこの画面から通常どおり顧客を確認できます。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/customer-management/demo" className="btn-primary btn-sm">サンプル画面を確認</Link>
            <Link href="/admin/quotes" className="btn-secondary btn-sm">案件管理を開く</Link>
          </div>
        </section>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="顧客管理"
      lead="顧客を探し、現在の案件を確認して、必要に応じて案件管理や顧客詳細へ進むための画面です。"
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">現在は参照専用です。</p>
          <p>
            本部は現在の権限範囲で全顧客を参照し、総代理店・代理店は現在アクセス可能な担当案件の顧客だけを参照します。
            今回は閲覧範囲を変更せず、ここでは情報の編集・統合も行いません。同姓同名や会社名・メールアドレスの一致だけで自動的に同じ顧客としてまとめることもありません。
          </p>
        </div>
      }
    >
      <CustomerManagementList
        customers={view.customers}
        searchParams={sp}
        showDealerColumn={showDealerColumn}
        basePath="/admin/customer-management"
        headingId="customer-list-heading"
      />

      <section className="space-y-3" aria-labelledby="unlinked-cases-heading">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="unlinked-cases-heading" className="text-lg font-semibold">顧客未紐付け案件</h2>
            <Badge tone={view.unlinked_cases.length > 0 ? 'warn' : 'neutral'}>{view.unlinked_cases.length} 件</Badge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-muted">
            参照可能な案件のうち、顧客アカウントとの紐付けを確認できていない案件です。
            同姓同名や会社名・メールアドレスの一致だけでは自動的に顧客へ統合しません。
          </p>
        </div>

        {view.unlinked_cases.length > 0 ? (
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
              {view.unlinked_cases.map((customerCase) => (
                <tr key={customerCase.id} data-testid="unlinked-customer-case-row">
                  <Td>
                    <p className="font-semibold">{customerCase.full_name}</p>
                    <p className="mt-1 text-xs text-muted">{customerCase.company_name ?? '法人名なし'}</p>
                  </Td>
                  <Td className="text-xs"><Badge tone="warn">{unlinkedReason(customerCase)}</Badge></Td>
                  <Td className="text-xs">
                    <span className="block font-semibold">{customerCase.quote_no ?? '見積未発行'}</span>
                    <span className="mt-1 block text-muted">{customerCase.model_name ?? '商品モデル未登録'}／{formatDate(customerCase.activity_at)}</span>
                    <span className="mt-1 block text-muted">設置予定地：{customerCase.site_address ?? '未登録'}</span>
                  </Td>
                  <Td className="text-xs">{customerCase.dealer_name ?? '未割り当て'}</Td>
                  <Td>
                    <Link href={caseHref(customerCase.id, customerCase.open_quote_id)} className="btn-secondary btn-sm">案件を見る</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="card p-4 text-sm text-muted">現在、参照可能な顧客未紐付け案件はありません。</div>
        )}
      </section>
    </AdminPage>
  );
}
