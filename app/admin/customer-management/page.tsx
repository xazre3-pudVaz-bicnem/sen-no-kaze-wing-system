import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getStore, type AccessibleUnlinkedCustomerCase } from '@/lib/data/store';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { Badge, Button, Input } from '@/components/ui';

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
            <Link href="/admin/customer-management/demo" className="btn-primary btn-sm">
              サンプル画面を確認
            </Link>
            <Link href="/admin/quotes" className="btn-secondary btn-sm">
              案件管理を開く
            </Link>
          </div>
        </section>
      </AdminPage>
    );
  }

  const query = (sp.q ?? '').trim().toLocaleLowerCase('ja-JP');
  const shown = view.customers.filter((customer) => {
    if (!query) return true;
    const recent = customer.recent_case;
    return [
      customer.full_name,
      customer.company_name,
      customer.email,
      customer.phone,
      customer.address,
      recent?.site_address,
      recent?.quote_no,
      recent?.model_name,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('ja-JP').includes(query));
  });

  return (
    <AdminPage
      title="顧客管理"
      lead="参照できる顧客を探し、案件・見積・設置予定地を確認するための画面です。"
      notice={
        <div className="space-y-1">
          <p className="font-semibold text-ink">現在は参照専用です。</p>
          <p>
            本部は全顧客を参照し、総代理店・代理店は自分が担当する案件に関係する顧客だけを参照します。
            ここでは情報の編集・統合は行いません。同姓同名やメールアドレスの一致だけで自動的に同じ顧客としてまとめることもありません。
          </p>
        </div>
      }
    >
      <form method="get" className="card p-4" aria-label="顧客を検索">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">
              顧客名・法人名・連絡先・住所・案件情報で検索
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
          <span>参照可能な顧客 {view.customers.length} 名</span>
          <span>表示 {shown.length} 名</span>
        </div>
      </form>

      <section className="space-y-2" aria-labelledby="customer-list-heading">
        <div>
          <h2 id="customer-list-heading" className="text-lg font-semibold">顧客一覧</h2>
          <p className="mt-1 text-xs text-muted">顧客ごとに、連絡先と参照可能な案件状況を確認できます。</p>
        </div>

        <Table minWidth="58rem">
          <thead className="bg-sand/60">
            <tr>
              <Th>顧客名 / 法人名</Th>
              <Th>連絡先・住所</Th>
              <Th>進行中案件</Th>
              <Th>最近の案件</Th>
              <Th>詳細</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-10 text-center text-sm text-muted">
                  条件に一致する顧客はいません。
                </Td>
              </tr>
            ) : (
              shown.map((customer) => {
                const recent = customer.recent_case;
                return (
                  <tr key={customer.id} data-testid="customer-management-row">
                    <Td>
                      <p className="font-semibold">{customer.full_name || '氏名未登録'}</p>
                      <p className="mt-1 text-xs text-muted">{customer.company_name ?? '法人名なし'}</p>
                      {customer.customer_no && (
                        <p className="mt-1 text-[0.68rem] text-muted">顧客番号 {customer.customer_no}</p>
                      )}
                    </Td>
                    <Td className="max-w-64 text-xs">
                      <span className="block">{customer.email || 'メール未登録'}</span>
                      <span className="mt-1 block text-muted">{customer.phone ?? '電話未登録'}</span>
                      <span className="mt-1 block text-muted">{customer.address ?? '住所未登録'}</span>
                    </Td>
                    <Td>
                      <span className="text-lg font-semibold tabular-nums">{customer.ongoing_case_count}</span>
                      <span className="ml-1 text-xs text-muted">件</span>
                    </Td>
                    <Td className="text-xs">
                      {recent ? (
                        <div className="space-y-1">
                          <Link
                            href={caseHref(recent.id, recent.open_quote_id)}
                            className="font-semibold text-ink underline-offset-4 hover:underline"
                          >
                            {recent.quote_no ?? '見積未発行'}
                          </Link>
                          <p>{recent.model_name ?? '商品モデル未登録'}</p>
                          <p className="text-muted">
                            {recent.site_address ?? '設置予定地未登録'}／{formatDate(recent.activity_at)}
                          </p>
                          <p className="text-muted">担当：{recent.dealer_name ?? '未割り当て'}</p>
                        </div>
                      ) : (
                        <span className="text-muted">案件なし</span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/customer-management/${encodeURIComponent(customer.id)}`}
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
            <Badge tone={view.unlinked_cases.length > 0 ? 'warn' : 'neutral'}>
              {view.unlinked_cases.length} 件
            </Badge>
          </div>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-muted">
            参照可能な案件のうち、顧客アカウントとの紐付けを確認できていない案件です。
            同姓同名や会社名・メールアドレスの一致だけでは自動的に顧客へ統合しません。
          </p>
        </div>

        {view.unlinked_cases.length > 0 ? (
          <Table minWidth="48rem">
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
                  <Td className="text-xs">
                    <Badge tone="warn">{unlinkedReason(customerCase)}</Badge>
                  </Td>
                  <Td className="text-xs">
                    <span className="block font-semibold">{customerCase.quote_no ?? '見積未発行'}</span>
                    <span className="mt-1 block text-muted">
                      {customerCase.model_name ?? '商品モデル未登録'}／{formatDate(customerCase.activity_at)}
                    </span>
                    <span className="mt-1 block text-muted">
                      設置予定地：{customerCase.site_address ?? '未登録'}
                    </span>
                  </Td>
                  <Td className="text-xs">{customerCase.dealer_name ?? '未割り当て'}</Td>
                  <Td>
                    <Link
                      href={caseHref(customerCase.id, customerCase.open_quote_id)}
                      className="btn-secondary btn-sm"
                    >
                      案件を見る
                    </Link>
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
