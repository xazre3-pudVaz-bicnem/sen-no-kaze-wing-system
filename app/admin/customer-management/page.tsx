import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import {
  buildCustomerManagementView,
  customerCaseHref,
  customerCaseLabel,
  type CustomerCaseView,
} from '@/lib/domain/customer-management';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { Badge, Button, Input } from '@/components/ui';

function unlinkedReason(customerCase: CustomerCaseView): string {
  if (customerCase.identityIssue === 'inconsistent_user_id') return 'user_id 不一致';
  if (customerCase.identityIssue === 'non_customer_profile') return '担当者等の user_id に紐付く案件';
  return '顧客Profileを確認できない案件';
}

function unlinkedDisplayName(customerCase: CustomerCaseView): string {
  return customerCase.contact?.full_name || customerCase.latestQuote?.customer_name || '顧客名未登録';
}

function unlinkedCompanyName(customerCase: CustomerCaseView): string | null {
  return customerCase.contact?.company_name || customerCase.latestQuote?.customer_company || null;
}

export default async function AdminCustomerManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin('/admin/customer-management');
  const sp = await searchParams;
  const store = await getStore();
  const [profiles, quotes, requests, configurations] = await Promise.all([
    store.listProfiles(),
    store.listAllQuotes(),
    store.listQuoteRequests(),
    store.listAllConfigurations(),
  ]);

  const view = buildCustomerManagementView({ profiles, quotes, requests, configurations });
  const query = (sp.q ?? '').trim().toLocaleLowerCase('ja-JP');
  const shown = view.customers.filter((customer) => {
    if (!query) return true;
    const recent = customer.recentCase;
    return [
      customer.profile.full_name,
      customer.profile.company_name,
      customer.profile.email,
      customer.profile.phone,
      customer.profile.address,
      recent?.siteAddress,
      recent?.latestQuote?.quote_no,
      recent?.latestQuote?.base_model_name,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('ja-JP').includes(query));
  });

  return (
    <AdminPage
      title="顧客管理"
      lead="顧客を探し、既存の user_id で明確に紐づく案件・見積を確認するための参照画面です。"
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">現在は read-only の顧客参照です。</p>
          <p>
            Profile と案件受付時の QuoteContact は別情報として扱い、どちらかを顧客情報の正本とは決めていません。
            氏名やメールアドレスだけで別データを自動統合することもありません。
          </p>
        </div>
      }
    >
      <form method="get" className="card p-4" aria-label="顧客を検索">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">
              顧客名・法人名・連絡先・住所・案件で検索
            </span>
            <Input
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="例：山田、株式会社○○、能登町、見積番号"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">検索</Button>
            <Link
              href="/admin/customer-management"
              className="text-sm text-ink-soft underline-offset-4 hover:underline"
            >
              解除
            </Link>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
          <span>顧客アカウント {view.customers.length} 名</span>
          <span>表示 {shown.length} 名</span>
        </div>
      </form>

      <section className="space-y-2" aria-labelledby="customer-list-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="customer-list-heading" className="text-lg font-semibold">顧客一覧</h2>
            <p className="mt-1 text-xs text-muted">
              顧客アカウントの Profile と、同じ user_id を持つ案件だけを表示します。
            </p>
          </div>
        </div>

        <Table minWidth="76rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>顧客名 / 法人名</Th>
              <Th>連絡先</Th>
              <Th>住所</Th>
              <Th>進行中案件</Th>
              <Th>最近の案件</Th>
              <Th>担当代理店</Th>
              <Th>詳細</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-sm text-muted">
                  条件に一致する顧客はいません。
                </Td>
              </tr>
            ) : (
              shown.map((customer) => {
                const recent = customer.recentCase;
                return (
                  <tr key={customer.profile.id} data-testid="customer-management-row">
                    <Td>
                      <p className="font-semibold">{customer.profile.full_name || '氏名未登録'}</p>
                      <p className="mt-1 text-xs text-muted">{customer.profile.company_name ?? '法人名なし'}</p>
                      {customer.profile.customer_no && (
                        <p className="mt-1 text-[0.68rem] text-muted">顧客番号 {customer.profile.customer_no}</p>
                      )}
                    </Td>
                    <Td className="text-xs">
                      <span className="block">{customer.profile.email || 'メール未登録'}</span>
                      <span className="mt-1 block text-muted">{customer.profile.phone ?? '電話未登録'}</span>
                    </Td>
                    <Td className="max-w-56 text-xs">{customer.profile.address ?? '未登録'}</Td>
                    <Td>
                      <span className="text-lg font-semibold tabular-nums">{customer.ongoingCases.length}</span>
                      <span className="ml-1 text-xs text-muted">件</span>
                    </Td>
                    <Td className="text-xs">
                      {recent ? (
                        <div className="space-y-1">
                          <Link
                            href={customerCaseHref(recent)}
                            className="font-semibold text-ink underline-offset-4 hover:underline"
                          >
                            {customerCaseLabel(recent)}
                          </Link>
                          <p>{recent.latestQuote?.base_model_name ?? '見積未発行'}</p>
                          <p className="text-muted">
                            {recent.siteAddress ?? '設置予定地未登録'}／{formatDate(recent.activityAt)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-muted">案件なし</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {recent?.dealer ? (
                        <>
                          <span className="block font-semibold">{recent.dealer.full_name}</span>
                          <span className="mt-1 block text-muted">{recent.dealer.company_name ?? recent.dealer.email}</span>
                        </>
                      ) : (
                        <span className="text-muted">未割り当て</span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/customer-management/${encodeURIComponent(customer.profile.id)}`}
                        className="btn-secondary btn-sm"
                      >
                        顧客を見る
                      </Link>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      </section>

      <section className="space-y-3" aria-labelledby="unlinked-cases-heading">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="unlinked-cases-heading" className="text-lg font-semibold">顧客未紐付け案件</h2>
            <Badge tone={view.unlinkedCases.length > 0 ? 'warn' : 'neutral'}>
              {view.unlinkedCases.length} 件
            </Badge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-muted">
            対面・電話・紹介でスタッフが登録した案件など、既存 user_id だけでは実顧客のidentityを確定できない案件です。
            氏名・会社名・メールの一致だけで顧客へ統合せず、案件として個別に残しています。
          </p>
        </div>

        {view.unlinkedCases.length > 0 ? (
          <Table minWidth="58rem">
            <thead className="bg-[#fff8e8]">
              <tr>
                <Th>案件上のお客様</Th>
                <Th>紐付けない理由</Th>
                <Th>案件</Th>
                <Th>設置予定地</Th>
                <Th>担当代理店</Th>
                <Th>確認</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {view.unlinkedCases.map((customerCase) => (
                <tr key={customerCase.id} data-testid="unlinked-customer-case-row">
                  <Td>
                    <p className="font-semibold">{unlinkedDisplayName(customerCase)}</p>
                    <p className="mt-1 text-xs text-muted">{unlinkedCompanyName(customerCase) ?? '法人名なし'}</p>
                  </Td>
                  <Td className="text-xs">
                    <Badge tone="warn">{unlinkedReason(customerCase)}</Badge>
                  </Td>
                  <Td className="text-xs">
                    <span className="block font-semibold">{customerCaseLabel(customerCase)}</span>
                    <span className="mt-1 block text-muted">
                      {customerCase.latestQuote?.base_model_name ?? '見積未発行'}／{formatDate(customerCase.activityAt)}
                    </span>
                  </Td>
                  <Td className="text-xs">{customerCase.siteAddress ?? '未登録'}</Td>
                  <Td className="text-xs">{customerCase.dealer?.full_name ?? '未割り当て'}</Td>
                  <Td>
                    <Link href={customerCaseHref(customerCase)} className="btn-secondary btn-sm">
                      案件を見る
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="card p-4 text-sm text-muted">現在、顧客未紐付けとして分離される案件はありません。</div>
        )}
      </section>
    </AdminPage>
  );
}
