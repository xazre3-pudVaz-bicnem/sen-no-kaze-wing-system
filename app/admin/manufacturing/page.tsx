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
 * 受領は総代理店がこの画面から行える。詳しい記録（個体・工程・写真）は案件画面の「製造・施工」タブ。
 */
export default async function ManufacturingBoardPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const actor = await requireStaff('/admin/manufacturing');
  const sp = await searchParams;
  const caseFlow = await getCaseFlowStore();
  const [orders, mine] = await Promise.all([
    caseFlow.listManufacturingBoard(actor),
    actor.role === 'admin' ? Promise.resolve(null) : (await getOrganizationStore()).getMyOrganization(actor),
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
          : '届いた製造依頼と、担当の案件の製造の進み具合です。詳しい記録は案件画面の「製造・施工」タブで行います。'
      }
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.done && DONE_TEXT[sp.done] && <Alert tone="success">{DONE_TEXT[sp.done]}</Alert>}
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
                  {order.case_quote_id ? (
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
