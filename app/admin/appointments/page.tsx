import type { Metadata } from 'next';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { APPOINTMENT_PURPOSE_LABELS, MEETING_METHOD_LABELS, formatCandidate } from '@/lib/domain/case-flow';
import { Badge } from '@/components/ui';
import { AdminPage, Table, Td, Th } from '@/components/admin/ui';

export const metadata: Metadata = { title: '予約ボード | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** 予約ボード（フェーズ6）：見える案件の、日程調整中・確定の日程。本部はすべて、代理店は担当の案件だけ */
export default async function AppointmentsBoardPage() {
  const actor = await requireStaff('/admin/appointments');
  const caseFlow = await getCaseFlowStore();
  const rows = await caseFlow.listBoardAppointments(actor);
  const confirmed = rows
    .filter((row) => row.status === 'confirmed' && row.confirmed_starts_at)
    .sort((a, b) => (a.confirmed_starts_at ?? '').localeCompare(b.confirmed_starts_at ?? ''));
  const proposed = rows.filter((row) => row.status === 'proposed');
  const caseHref = (quoteId: string | null) => (quoteId ? `/admin/quotes/${quoteId}?tab=site` : '/admin/quotes');

  return (
    <AdminPage title="予約ボード" lead="打合せ・現地調査・引渡し・点検の日程です。日程は案件画面の「現地確認」タブから送ります。">
      <section className="space-y-2" data-testid="board-confirmed">
        <h2 className="font-semibold">確定した日程</h2>
        <Table minWidth="44rem">
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>種類</Th>
              <Th>案件</Th>
              <Th>方法・場所</Th>
            </tr>
          </thead>
          <tbody>
            {confirmed.map((row) => (
              <tr key={row.id}>
                <Td>{formatCandidate({ starts_at: row.confirmed_starts_at as string, ends_at: row.confirmed_ends_at })}</Td>
                <Td>{APPOINTMENT_PURPOSE_LABELS[row.purpose]}</Td>
                <Td>
                  <Link href={caseHref(row.quote_id)} className="underline-offset-4 hover:underline">
                    {row.case_label}
                  </Link>
                </Td>
                <Td>
                  {MEETING_METHOD_LABELS[row.method]}
                  {row.location ? `・${row.location}` : ''}
                </Td>
              </tr>
            ))}
            {confirmed.length === 0 && (
              <tr>
                <Td colSpan={4} className="py-6 text-center text-muted">確定した日程はありません。</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>

      <section className="mt-6 space-y-2" data-testid="board-proposed">
        <h2 className="font-semibold">お客様の回答待ち</h2>
        <Table minWidth="44rem">
          <thead>
            <tr>
              <Th>候補</Th>
              <Th>種類</Th>
              <Th>案件</Th>
              <Th>状態</Th>
            </tr>
          </thead>
          <tbody>
            {proposed.map((row) => (
              <tr key={row.id}>
                <Td>{row.candidates.map(formatCandidate).join(' ／ ')}</Td>
                <Td>{APPOINTMENT_PURPOSE_LABELS[row.purpose]}</Td>
                <Td>
                  <Link href={caseHref(row.quote_id)} className="underline-offset-4 hover:underline">
                    {row.case_label}
                  </Link>
                </Td>
                <Td>{row.customer_note ? <Badge tone="warn">変更のご要望あり</Badge> : <Badge tone="neutral">回答待ち</Badge>}</Td>
              </tr>
            ))}
            {proposed.length === 0 && (
              <tr>
                <Td colSpan={4} className="py-6 text-center text-muted">回答待ちの日程はありません。</Td>
              </tr>
            )}
          </tbody>
        </Table>
      </section>
    </AdminPage>
  );
}
