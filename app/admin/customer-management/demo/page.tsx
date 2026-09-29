import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import {
  DEMO_CUSTOMERS,
  DEMO_UNLINKED_CASES,
} from '@/lib/demo/customer-management';
import { formatDate } from '@/lib/utils';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';
import { Badge, Button, Input } from '@/components/ui';

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
  await requireStaff('/admin/customer-management/demo');
  const sp = await searchParams;
  const query = (sp.q ?? '').trim().toLocaleLowerCase('ja-JP');
  const shown = DEMO_CUSTOMERS.filter((customer) => {
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
      actions={
        <Link href="/admin/customer-management" className="btn-secondary btn-sm">
          実際の顧客管理へ戻る
        </Link>
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
      <form method="get" className="card p-4" aria-label="サンプル顧客を検索">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">
              顧客名・法人名・連絡先・住所・案件情報で検索
            </span>
            <Input
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="例：山田、サンプル住建、穴水町、W-DEMO"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="secondary">検索</Button>
            <Link
              href="/admin/customer-management/demo"
              className="text-sm text-ink-soft underline-offset-4 hover:underline"
            >
              解除
            </Link>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
          <span>サンプル顧客 {DEMO_CUSTOMERS.length} 名</span>
          <span>表示 {shown.length} 名</span>
        </div>
      </form>

      <section className="space-y-2" aria-labelledby="demo-customer-list-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="demo-customer-list-heading" className="text-lg font-semibold">顧客一覧</h2>
            <p className="mt-1 text-xs text-muted">
              実際の顧客管理と同じ情報量を、サンプルデータで確認できます。
            </p>
          </div>
          <Badge tone="navy">DEMO</Badge>
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
                  条件に一致するサンプル顧客はいません。
                </Td>
              </tr>
            ) : (
              shown.map((customer) => {
                const recent = customer.recent_case;
                return (
                  <tr key={customer.id} data-testid="customer-management-demo-row">
                    <Td>
                      <p className="font-semibold">{customer.full_name}</p>
                      <p className="mt-1 text-xs text-muted">{customer.company_name ?? '法人名なし'}</p>
                      {customer.customer_no && (
                        <p className="mt-1 text-[0.68rem] text-muted">顧客番号 {customer.customer_no}</p>
                      )}
                    </Td>
                    <Td className="max-w-64 text-xs">
                      <span className="block">{customer.email}</span>
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
                          <p className="font-semibold text-ink">{recent.quote_no ?? '見積未発行'}</p>
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
                        href={`/admin/customer-management/demo/${encodeURIComponent(customer.id)}`}
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
            {DEMO_UNLINKED_CASES.map((customerCase) => (
              <tr key={customerCase.id} data-testid="unlinked-customer-demo-row">
                <Td>
                  <p className="font-semibold">{customerCase.full_name}</p>
                  <p className="mt-1 text-xs text-muted">{customerCase.company_name ?? '法人名なし'}</p>
                </Td>
                <Td className="text-xs">
                  <Badge tone="warn">{unlinkedReason(customerCase.identity_issue)}</Badge>
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
                  <span className="btn-secondary btn-sm cursor-default opacity-60">案件を見る（デモ）</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
