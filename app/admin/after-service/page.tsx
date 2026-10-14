import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { updateAfterServiceRequestAction } from '@/lib/actions/case-flow';
import { AFTER_SERVICE_KIND_LABELS, AFTER_SERVICE_STATUS_LABELS, canUpdateAfterService, type AfterServiceStatus } from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { Alert, Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: 'アフター | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STATUSES: AfterServiceStatus[] = ['open', 'in_progress', 'escalated', 'resolved'];

/**
 * アフター（フェーズ15：定期点検・問い合わせ・修理）。本部はすべて、担当代理店は担当の案件、総代理店は回されたもの（製造起因）。
 * 状態とお客様への回答はここでも更新できる。写真や引渡しの記録は案件画面の「引渡し・アフター」タブ。
 */
export default async function AfterServiceBoardPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string; status?: string }> }) {
  const actor = await requireStaff('/admin/after-service');
  const sp = await searchParams;
  const caseFlow = await getCaseFlowStore();
  const all = await caseFlow.listAfterServiceBoard(actor);
  const showResolved = sp.status === 'all';
  const rows = showResolved ? all : all.filter((row) => row.status !== 'resolved');

  return (
    <AdminPage
      title="アフター"
      lead={
        actor.role === 'admin'
          ? '全国の定期点検・問い合わせ・修理の受付と対応状況です。製造起因のものは製造の担当（総代理店）へ回せます。'
          : '担当の案件と、回ってきた製造起因のアフターです。お客様への回答はお客様のマイページに表示されます。'
      }
    >
      {sp.error && <Alert tone="danger">{sp.error}</Alert>}
      {sp.done === 'after_service' && <Alert tone="success">アフターを更新しました。</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/after-service" aria-current={!showResolved ? 'page' : undefined} className={!showResolved ? 'font-semibold' : 'text-ink-soft underline-offset-4 hover:underline'}>
          対応中（{all.filter((row) => row.status !== 'resolved').length}）
        </Link>
        <span className="text-muted">／</span>
        <Link href="/admin/after-service?status=all" aria-current={showResolved ? 'page' : undefined} className={showResolved ? 'font-semibold' : 'text-ink-soft underline-offset-4 hover:underline'}>
          完了を含むすべて（{all.length}）
        </Link>
      </div>
      <Table minWidth="60rem">
        <thead>
          <tr>
            <Th>受付日</Th>
            <Th>案件</Th>
            <Th>種類・件名</Th>
            <Th>状態</Th>
            <Th>状態・お客様への回答を更新</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const access = row.viewer_access;
            const options = access ? STATUSES.filter((status) => status === row.status || canUpdateAfterService(access, row, status)) : [];
            const editable = access !== null && canUpdateAfterService(access, row, row.status);
            return (
              <tr key={row.id} data-testid="after-service-board-row" className="align-top">
                <Td>{formatDate(row.created_at)}</Td>
                <Td>
                  {row.case_quote_id ? (
                    <Link href={`/admin/quotes/${row.case_quote_id}?tab=handover`} className="underline-offset-4 hover:underline">
                      {row.case_label}
                    </Link>
                  ) : (
                    row.case_label
                  )}
                </Td>
                <Td>
                  <span className="text-xs text-muted">{AFTER_SERVICE_KIND_LABELS[row.kind]}</span>
                  <p className="font-semibold">{row.title}</p>
                  {row.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-ink-soft">{row.body}</p>}
                  {row.requested_by_customer && <span className="text-[0.65rem] text-muted">お客様から</span>}
                </Td>
                <Td>
                  <Badge tone={row.status === 'resolved' ? 'success' : row.status === 'escalated' ? 'navy' : 'warn'}>{AFTER_SERVICE_STATUS_LABELS[row.status]}</Badge>
                </Td>
                <Td>
                  {editable ? (
                    <form action={updateAfterServiceRequestAction} className="space-y-1">
                      <input type="hidden" name="after_service_id" value={row.id} />
                      <input type="hidden" name="request_id" value={row.quote_request_id} />
                      <input type="hidden" name="current_status" value={row.status} />
                      <input type="hidden" name="expected_lock_version" value={row.lock_version} />
                      <input type="hidden" name="back" value={showResolved ? '/admin/after-service?status=all' : '/admin/after-service'} />
                      <div className="flex flex-wrap items-center gap-1">
                        <select name="status" defaultValue={row.status} className="input h-8 text-xs" aria-label="状態">
                          {options.map((status) => (
                            <option key={status} value={status}>
                              {status === 'escalated' && row.status !== 'escalated' ? '製造の担当（総代理店）へ回す' : AFTER_SERVICE_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="btn-secondary btn-sm">
                          更新
                        </button>
                      </div>
                      <textarea name="response" rows={2} maxLength={2000} defaultValue={row.response ?? ''} className="input w-full text-xs" placeholder="お客様への回答（お客様にも表示されます）" aria-label="お客様への回答" />
                    </form>
                  ) : (
                    row.response && <p className="whitespace-pre-wrap text-xs text-ink-soft">{row.response}</p>
                  )}
                </Td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-muted">
                {showResolved ? 'アフターの記録はまだありません。' : '対応中のアフターはありません。'}
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </AdminPage>
  );
}
