import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { caseStageOf } from '@/lib/domain/case-flow';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '配下の案件 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * 総代理店の「配下の案件」（2026-10-15 先方確定）。配下の代理店が営業担当の案件の進み具合・仕様・見積の金額を確認する。
 * お客様のお名前・連絡先・設置場所などは表示しない（項目は先方の確認待ち）。営業の操作は代理店側に残す。
 */
export default async function SupervisedCasesPage() {
  const actor = await requireStaff('/admin/supervision');
  if (actor.role !== 'admin' && actor.role !== 'master_dealer') notFound();
  const cases = await (await getCaseFlowStore()).listSupervisedCases(actor);
  const isAdmin = actor.role === 'admin';

  return (
    <AdminPage
      title="配下の案件"
      lead={
        isAdmin
          ? '代理店が営業担当の案件を、総代理店の画面と同じ内容で表示しています。'
          : '配下の代理店が営業担当になっている案件の進み具合です。お客様への対応と見積は、営業担当の代理店が行います。'
      }
      notice="この画面には、お客様のお名前・連絡先・設置場所などは表示していません。"
    >
      <Table minWidth={isAdmin ? '60rem' : '52rem'}>
        <thead>
          <tr>
            <Th>案件</Th>
            <Th>営業担当</Th>
            {isAdmin && <Th>総代理店</Th>}
            <Th>進み具合</Th>
            <Th right>見積（税込）</Th>
            <Th>製造担当</Th>
            <Th>更新</Th>
          </tr>
        </thead>
        <tbody>
          {cases.map((row) => {
            const stage = caseStageOf(row.progress);
            return (
              <tr key={row.request_id} data-testid="supervised-case-row" className="border-t border-line">
                <Td>
                  <Link href={`/admin/supervision/${row.request_id}`} className="font-medium underline-offset-4 hover:underline">
                    {row.quote ? `${row.quote.quote_no}（第${row.quote.revision}版）` : '見積の準備中'}
                  </Link>
                  {row.quote && <p className="mt-0.5 text-xs text-muted">{row.quote.base_model_name}</p>}
                </Td>
                <Td>
                  {row.sales_organization.name}
                  <p className="mt-0.5 text-xs text-muted">主担当者：{row.primary_staff_name ?? '未定'}</p>
                </Td>
                {isAdmin && <Td>{row.supervisor_organization.name}</Td>}
                <Td>
                  <Badge tone={stage.tone}>{stage.label}</Badge>
                </Td>
                <Td right>{row.quote ? formatYen(row.quote.total) : '—'}</Td>
                <Td>{row.manufacturing_organization?.name ?? '未定'}</Td>
                <Td>{formatDate(row.activity_at)}</Td>
              </tr>
            );
          })}
          {cases.length === 0 && (
            <tr>
              <Td colSpan={isAdmin ? 7 : 6} className="py-8 text-center text-muted">
                配下の代理店が営業担当の案件は、まだありません。
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
