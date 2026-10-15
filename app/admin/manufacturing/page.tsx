import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { getOrganizationStore } from '@/lib/data/organizations/store';
import { setManufacturingOrderStatusAction } from '@/lib/actions/case-flow';
import { MANUFACTURING_ORDER_STATUS_LABELS, canChangeOrderStatus } from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '製造の進み具合 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const DONE_TEXT: Record<string, string> = { order_status: '製造依頼の状態を更新しました。', order_sent: '製造依頼を送りました。', unit: '個体の状態を更新しました。' };

/**
 * 製造の進み具合（フェーズ11〜12）。本部は全国の製造の進み具合、総代理店は届いた製造依頼、代理店は担当の案件。
 * 受領は総代理店がこの画面から行える。製造担当（総代理店）は「製造担当の案件」から案件ごとの画面を開き、
 * 個体・工程・施工の記録・技術検討を行う（20261015150000）。担当代理店と本部は案件画面の「製造・施工」タブ。
 */
export default async function ManufacturingBoardPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const actor = await requireStaff('/admin/manufacturing');
  const sp = await searchParams;
  const caseFlow = await getCaseFlowStore();
  const [orders, mine, cases] = await Promise.all([
    caseFlow.listManufacturingBoard(actor),
    actor.role === 'admin' ? Promise.resolve(null) : (await getOrganizationStore()).getMyOrganization(actor),
    // 製造担当の案件（製造依頼の前の技術検討から）。代理店は製造の担当にならないため読まない
    actor.role === 'dealer' ? Promise.resolve([]) : caseFlow.listManufacturingCases(actor),
  ]);
  // 製造の担当：組織あての製造依頼は製造担当組織のメンバー、これまでの製造依頼は本部が選んだ総代理店の利用者（最終の判定は DB）
  const accessOf = (order: (typeof orders)[number]) =>
    actor.role === 'admin'
      ? 'admin'
      : order.manufacturing_organization_id
        ? order.manufacturing_organization_id === mine?.organization_id
          ? 'manufacturer'
          : 'staff'
        : order.manufacturer_id === actor.id && actor.role === 'master_dealer'
          ? 'manufacturer'
          : 'staff';

  return (
    <AdminPage
      title="製造の進み具合"
      lead={
        actor.role === 'admin'
          ? '全国の製造依頼と、個体の出荷・設置の進み具合です。'
          : actor.role === 'master_dealer'
            ? '製造担当の案件と、届いた製造依頼の進み具合です。案件を開くと、受領・製造・検査・出荷の記録と技術検討ができます。'
            : '担当の案件の製造の進み具合です。詳しい記録は案件画面の「製造・施工」タブで行います。'
      }
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.done && DONE_TEXT[sp.done] && <Alert tone="success">{DONE_TEXT[sp.done]}</Alert>}
      {cases.length > 0 && (
        <section className="space-y-3" aria-labelledby="manufacturing-cases-heading">
          <h2 id="manufacturing-cases-heading" className="text-lg font-semibold">
            製造担当の案件
          </h2>
          <Table minWidth="52rem">
            <thead>
              <tr>
                <Th>案件</Th>
                <Th>営業担当</Th>
                <Th>契約</Th>
                <Th>製造依頼</Th>
                <Th>棟数（出荷・設置）</Th>
                <Th>更新</Th>
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <tr key={row.request_id} data-testid="manufacturing-case-row" className="border-t border-line">
                  <Td>
                    <Link href={`/admin/manufacturing/${row.request_id}`} className="font-medium underline-offset-4 hover:underline">
                      {row.quote ? `${row.quote.quote_no}（第${row.quote.revision}版）` : '見積の準備中'}
                    </Link>
                    {row.quote && <p className="mt-0.5 text-xs text-muted">{row.quote.base_model_name}</p>}
                  </Td>
                  <Td>
                    {row.sales_organization?.name ?? '本部'}
                    <p className="mt-0.5 text-xs text-muted">主担当者：{row.primary_staff_name ?? '未定'}</p>
                  </Td>
                  <Td>{row.contract_signed ? '締結済み' : 'まだ'}</Td>
                  <Td>
                    {row.order ? (
                      <Badge tone={row.order.status === 'sent' ? 'warn' : row.order.status === 'completed' ? 'success' : 'neutral'}>
                        {MANUFACTURING_ORDER_STATUS_LABELS[row.order.status]}
                      </Badge>
                    ) : (
                      <span className="text-muted">依頼の前</span>
                    )}
                  </Td>
                  <Td>{row.order ? `${row.order.unit_count} 棟（出荷 ${row.order.units_shipped}・設置 ${row.order.units_installed}）` : '—'}</Td>
                  <Td>{formatDate(row.activity_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      {cases.length > 0 && <h2 className="text-lg font-semibold">製造依頼</h2>}
      <Table minWidth="52rem">
        <thead>
          <tr>
            <Th>案件</Th>
            <Th>状態</Th>
            <Th>棟数（出荷・設置）</Th>
            <Th>希望納期</Th>
            <Th>送った日</Th>
            <Th>操作</Th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const access = accessOf(order);
            return (
              <tr key={order.id} data-testid="manufacturing-board-row">
                <Td>
                  {access === 'manufacturer' ? (
                    // 製造担当は見積（お客様の情報を含む）を読めないため、製造担当の画面を開く
                    <Link href={`/admin/manufacturing/${order.quote_request_id}`} className="underline-offset-4 hover:underline">
                      {order.case_label}
                    </Link>
                  ) : order.case_quote_id ? (
                    <Link href={`/admin/quotes/${order.case_quote_id}?tab=production`} className="underline-offset-4 hover:underline">
                      {order.case_label}
                    </Link>
                  ) : (
                    order.case_label
                  )}
                </Td>
                <Td>
                  <Badge tone={order.status === 'sent' ? 'warn' : order.status === 'completed' ? 'success' : 'neutral'}>{MANUFACTURING_ORDER_STATUS_LABELS[order.status]}</Badge>
                </Td>
                <Td>
                  {order.units_total} 棟（出荷 {order.units_shipped}・設置 {order.units_installed}）
                </Td>
                <Td>{order.requested_delivery_on ?? '—'}</Td>
                <Td>{order.sent_at ? formatDate(order.sent_at) : '未送信'}</Td>
                <Td>
                  {canChangeOrderStatus(access, order.status, 'received') && (
                    <form action={setManufacturingOrderStatusAction}>
                      <input type="hidden" name="order_id" value={order.id} />
                      <input type="hidden" name="request_id" value={order.quote_request_id} />
                      <input type="hidden" name="expected_lock_version" value={order.lock_version} />
                      <input type="hidden" name="status" value="received" />
                      <button type="submit" className="btn-secondary btn-sm">
                        受領する
                      </button>
                    </form>
                  )}
                </Td>
              </tr>
            );
          })}
          {orders.length === 0 && (
            <tr>
              <Td colSpan={6} className="py-8 text-center text-muted">製造依頼はまだありません。</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
