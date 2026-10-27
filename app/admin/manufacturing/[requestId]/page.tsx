import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { CASE_NOTE_KIND_LABELS, MANUFACTURING_ORDER_STATUS_LABELS, TECH_VERDICT_LABELS } from '@/lib/domain/case-flow';
import { FINISH_LEVEL_INFO, type FinishLevel } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { CASE_ESTIMATE_SPEC_LABELS, ITEM_KIND_LABELS } from '@/components/admin/case-estimate-review';
import { CaseProductionPanels } from '@/components/case-flow/case-production-panels';
import { CaseNoteForm } from '@/components/case-flow/forms';

export const metadata: Metadata = { title: '製造の案件 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * 製造担当の案件（2026-10-15 先方確定：総代理店は製造受付・製造工程・検査・出荷・製造側の記録を更新する）。
 * 製造担当組織のメンバー（これまでの案件では本部が選んだ製造の担当）と本部が開ける。お客様の情報・見積の金額は表示しない。
 */
export default async function ManufacturingCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { requestId } = await params;
  const sp = await searchParams;
  const actor = await requireStaff(`/admin/manufacturing/${requestId}`);
  if (!UUID.test(requestId)) notFound();
  const caseFlow = await getCaseFlowStore();
  const detail = await caseFlow.getManufacturingCase(actor, requestId);
  if (!detail) notFound();
  const notes = (await caseFlow.listCaseNotes(actor, requestId)).filter((note) => note.kind === 'tech_review');
  const { quote } = detail;
  const finish = quote?.finish_level && quote.finish_level in FINISH_LEVEL_INFO ? FINISH_LEVEL_INFO[quote.finish_level as FinishLevel].name : null;
  const spec = quote?.spec_code ? (CASE_ESTIMATE_SPEC_LABELS[quote.spec_code] ?? quote.spec_code) : null;
  const back = `/admin/manufacturing/${requestId}`;

  return (
    <AdminPage
      title={quote ? `製造：${quote.quote_no}（第${quote.revision}版）` : '製造の案件'}
      lead={[quote?.base_model_name, spec, finish].filter(Boolean).join('・') || undefined}
      actions={<BackLink href="/admin/manufacturing" label="製造の進み具合" />}
      notice="お客様への連絡・見積は営業担当が行います。この画面には、お客様のお名前・連絡先・設置場所などは表示していません。"
    >
      <dl className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5" data-testid="manufacturing-case-summary">
        <Field label="営業担当">{detail.sales_organization?.name ?? '本部'}</Field>
        <Field label="主担当者">{detail.primary_staff_name ?? '未定'}</Field>
        <Field label="製造担当">{detail.manufacturing_organization?.name ?? '本部が選んだ担当'}</Field>
        <Field label="契約">{detail.contract_signed ? '締結済み' : 'まだです'}</Field>
        <Field label="製造依頼">
          {detail.order ? <Badge tone={detail.order.status === 'sent' ? 'warn' : 'neutral'}>{MANUFACTURING_ORDER_STATUS_LABELS[detail.order.status]}</Badge> : '届いていません'}
        </Field>
      </dl>

      <section className="space-y-3" aria-labelledby="spec-heading">
        <h2 id="spec-heading" className="text-lg font-semibold">
          仕様
        </h2>
        {detail.spec_items.length > 0 ? (
          <Table minWidth="32rem">
            <thead className="border-b border-line bg-sand/40">
              <tr>
                <Th>区分</Th>
                <Th>品名</Th>
                <Th right>数量</Th>
              </tr>
            </thead>
            <tbody>
              {detail.spec_items.map((item, index) => (
                <tr key={`${item.kind}-${index}`} className="border-t border-line" data-testid="manufacturing-spec-item">
                  <Td className="whitespace-nowrap text-xs text-muted">{ITEM_KIND_LABELS[item.kind] ?? item.kind}</Td>
                  <Td>{item.name}</Td>
                  <Td right>
                    {item.quantity}
                    {item.unit ? ` ${item.unit}` : ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="card p-5 text-sm text-muted">見積の明細はまだありません。</p>
        )}
        <p className="text-xs text-muted">製造依頼が届くと、依頼の時点の仕様が下の「製造依頼と個体」に残ります。</p>
      </section>

      <section className="space-y-3" aria-labelledby="tech-review-heading" data-testid="manufacturing-tech-review">
        <h2 id="tech-review-heading" className="text-lg font-semibold">
          技術検討
        </h2>
        {notes.length > 0 ? (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="card p-4 text-sm">
                <p className="text-xs text-muted">
                  {formatDate(note.created_at, true)}・{note.author_name}・{CASE_NOTE_KIND_LABELS[note.kind]}
                  {note.verdict ? `・${TECH_VERDICT_LABELS[note.verdict]}` : ''}
                </p>
                <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card p-5 text-sm text-muted">技術検討の記録はまだありません。</p>
        )}
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">技術検討を記録する</summary>
          <div className="mt-3">
            <CaseNoteForm quoteId="" requestId={requestId} kinds={['tech_review']} consults={[]} />
          </div>
        </details>
      </section>

      <CaseProductionPanels quoteId={null} requestId={requestId} actor={actor} flash={sp} back={back} />
    </AdminPage>
  );
}
