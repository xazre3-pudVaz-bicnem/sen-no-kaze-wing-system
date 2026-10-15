import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireStaff } from '@/lib/auth/session';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import {
  HANDOVER_STATUS_LABELS,
  MANUFACTURING_ORDER_STATUS_LABELS,
  PROGRESS_KIND_LABELS,
  SCHEDULE_CATEGORY_LABELS,
  SCHEDULE_STATUS_LABELS,
  UNIT_STATUS_LABELS,
  caseStageOf,
} from '@/lib/domain/case-flow';
import { FINISH_LEVEL_INFO, QUOTE_STATUS_LABELS, type FinishLevel } from '@/lib/domain/types';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui';
import { AdminPage, BackLink, Table, Td, Th } from '@/components/admin/ui';
import { CASE_ESTIMATE_SPEC_LABELS, ITEM_KIND_LABELS } from '@/components/admin/case-estimate-review';

export const metadata: Metadata = { title: '配下の案件の詳細 | 管理画面', robots: { index: false } };
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelOf(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) return '—';
  return labels[value] ?? value;
}

function period(start: string | null, end: string | null) {
  return start || end ? `${start ?? '—'} 〜 ${end ?? '—'}` : '—';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * 配下の案件の詳細（読み取りだけ）。仕様・見積の金額と明細・製造と施工の記録・進み具合を表示する。
 * お客様のお名前・連絡先・設置場所・打合せの記録は返ってこない（DB の get_supervised_case）。
 */
export default async function SupervisedCasePage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const actor = await requireStaff(`/admin/supervision/${requestId}`);
  if ((actor.role !== 'admin' && actor.role !== 'master_dealer') || !UUID.test(requestId)) notFound();
  const detail = await (await getCaseFlowStore()).getSupervisedCase(actor, requestId);
  if (!detail) notFound();
  const { quote, progress, manufacturing_order: order } = detail;
  const stage = caseStageOf(progress);
  const finish = quote?.finish_level && quote.finish_level in FINISH_LEVEL_INFO ? FINISH_LEVEL_INFO[quote.finish_level as FinishLevel].name : null;
  const spec = quote?.spec_code ? (CASE_ESTIMATE_SPEC_LABELS[quote.spec_code] ?? quote.spec_code) : null;

  return (
    <AdminPage
      title={quote ? `${quote.quote_no}（第${quote.revision}版）` : '配下の案件'}
      lead={[quote?.base_model_name, spec, finish].filter(Boolean).join('・') || undefined}
      actions={<BackLink href="/admin/supervision" label="配下の案件" />}
      notice="お客様への対応・見積の変更は、営業担当の代理店が行います。この画面には、お客様のお名前・連絡先・設置場所などは表示していません。"
    >
      <dl className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" data-testid="supervised-case-summary">
        <Field label="営業担当">{detail.sales_organization?.name ?? '—'}</Field>
        <Field label="主担当者">{detail.primary_staff_name ?? '未定'}</Field>
        <Field label="製造担当">{detail.manufacturing_organization?.name ?? '未定'}</Field>
        <Field label="進み具合">
          <Badge tone={stage.tone}>{stage.label}</Badge>
        </Field>
        {quote && (
          <>
            <Field label="見積の状態">{labelOf(QUOTE_STATUS_LABELS, quote.status)}</Field>
            <Field label="発行日">{formatDate(quote.issued_at)}</Field>
            <Field label="有効期限">{formatDate(quote.valid_until)}</Field>
            <Field label="見積の合計（税込）">
              <span className="font-semibold tabular-nums">{formatYen(quote.total)}</span>
            </Field>
          </>
        )}
      </dl>

      <Section id="progress-heading" title="進み具合">
        <dl className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="受付">{progress?.acknowledged_at ? formatDate(progress.acknowledged_at) : 'まだ受け付けていません'}</Field>
          <Field label="現地確認">
            {progress?.site_survey_status === 'completed'
              ? `完了（${formatDate(progress.site_survey_completed_at)}）`
              : progress?.site_survey_status === 'draft'
                ? '記録中'
                : 'まだです'}
          </Field>
          <Field label="契約">{progress?.contract_signed ? '締結済み' : 'まだです'}</Field>
          <Field label="製造">
            {progress?.manufacturing_status && progress.manufacturing_status !== 'none'
              ? `${MANUFACTURING_ORDER_STATUS_LABELS[progress.manufacturing_status]}（${progress.unit_count ?? 0} 棟・出荷 ${progress.units_shipped ?? 0}・設置 ${progress.units_installed ?? 0}）`
              : 'まだです'}
          </Field>
          <Field label="完成確認・引渡し">
            {progress?.handover_status && progress.handover_status !== 'none' ? HANDOVER_STATUS_LABELS[progress.handover_status] : 'まだです'}
          </Field>
        </dl>
      </Section>

      <Section id="estimate-heading" title="見積の金額と明細">
        {quote ? (
          <Table minWidth="48rem">
            <thead className="border-b border-line bg-sand/40">
              <tr>
                <Th>区分</Th>
                <Th>品名</Th>
                <Th right>数量</Th>
                <Th right>単価</Th>
                <Th right>金額</Th>
                <Th>備考</Th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, index) => (
                <tr key={`${item.kind}-${index}`} className="border-t border-line" data-testid="supervised-quote-item">
                  <Td className="whitespace-nowrap text-xs text-muted">{labelOf(ITEM_KIND_LABELS, item.kind)}</Td>
                  <Td>
                    {item.name}
                    {item.description && <p className="mt-0.5 text-xs text-muted">{item.description}</p>}
                  </Td>
                  <Td right>
                    {item.quantity}
                    {item.unit ? ` ${item.unit}` : ''}
                  </Td>
                  <Td right>{formatYen(item.unit_price)}</Td>
                  <Td right>{formatYen(item.amount)}</Td>
                  <Td className="text-xs text-muted">{item.remark ?? ''}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line">
              <tr>
                <Td colSpan={4} right>
                  小計
                </Td>
                <Td right>{formatYen(quote.subtotal)}</Td>
                <Td />
              </tr>
              <tr>
                <Td colSpan={4} right>
                  消費税（{Math.round(quote.tax_rate * 100)}%）
                </Td>
                <Td right>{formatYen(quote.tax)}</Td>
                <Td />
              </tr>
              <tr>
                <Td colSpan={4} right className="font-semibold">
                  合計（税込）
                </Td>
                <Td right className="font-semibold">
                  {formatYen(quote.total)}
                </Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        ) : (
          <p className="card p-5 text-sm text-muted">見積はまだありません。</p>
        )}
      </Section>

      <Section id="manufacturing-heading" title="製造">
        {order ? (
          <>
            <dl className="card grid gap-4 p-5 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="状態">{MANUFACTURING_ORDER_STATUS_LABELS[order.status as keyof typeof MANUFACTURING_ORDER_STATUS_LABELS] ?? order.status}</Field>
              <Field label="棟数">{order.unit_count} 棟</Field>
              <Field label="希望納期">{order.requested_delivery_on ?? '—'}</Field>
              <Field label="依頼日">{formatDate(order.sent_at)}</Field>
              <Field label="受領日">{formatDate(order.received_at)}</Field>
              <Field label="完了日">{formatDate(order.completed_at)}</Field>
            </dl>
            {detail.units.length > 0 && (
              <Table minWidth="52rem">
                <thead className="border-b border-line bg-sand/40">
                  <tr>
                    <Th>棟</Th>
                    <Th>状態</Th>
                    <Th>製造日</Th>
                    <Th>検査日</Th>
                    <Th>出荷日</Th>
                    <Th>設置日</Th>
                    <Th>引渡し日</Th>
                    <Th>メモ</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.units.map((unit) => (
                    <tr key={unit.seq} className="border-t border-line">
                      <Td>{unit.seq} 棟目</Td>
                      <Td>{labelOf(UNIT_STATUS_LABELS, unit.status)}</Td>
                      <Td>{unit.produced_on ?? '—'}</Td>
                      <Td>{unit.inspected_on ?? '—'}</Td>
                      <Td>{unit.shipped_on ?? '—'}</Td>
                      <Td>{unit.installed_on ?? '—'}</Td>
                      <Td>{unit.handed_over_on ?? '—'}</Td>
                      <Td className="text-xs text-muted">{unit.note ?? ''}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </>
        ) : (
          <p className="card p-5 text-sm text-muted">製造依頼はまだありません。</p>
        )}
      </Section>

      <Section id="schedule-heading" title="工程表">
        {detail.schedule.length > 0 ? (
          <Table minWidth="48rem">
            <thead className="border-b border-line bg-sand/40">
              <tr>
                <Th>工程</Th>
                <Th>予定</Th>
                <Th>実績</Th>
                <Th>状態</Th>
                <Th>メモ</Th>
              </tr>
            </thead>
            <tbody>
              {detail.schedule.map((item, index) => (
                <tr key={`${item.category}-${index}`} className="border-t border-line">
                  <Td>
                    {item.title}
                    <p className="mt-0.5 text-xs text-muted">{labelOf(SCHEDULE_CATEGORY_LABELS, item.category)}</p>
                  </Td>
                  <Td>{period(item.planned_start, item.planned_end)}</Td>
                  <Td>{period(item.actual_start, item.actual_end)}</Td>
                  <Td>{labelOf(SCHEDULE_STATUS_LABELS, item.status)}</Td>
                  <Td className="text-xs text-muted">{item.note ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="card p-5 text-sm text-muted">工程はまだ登録されていません。</p>
        )}
      </Section>

      <Section id="reports-heading" title="施工の記録">
        {detail.progress_reports.length > 0 ? (
          <ul className="space-y-3">
            {detail.progress_reports.map((report, index) => (
              <li key={`${report.reported_on}-${index}`} className="card p-4">
                <p className="text-xs text-muted">
                  {report.reported_on ?? '—'}・{labelOf(PROGRESS_KIND_LABELS, report.kind)}
                  {report.author_name ? `・${report.author_name}` : ''}
                </p>
                <p className="mt-1 font-medium">{report.title}</p>
                {report.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{report.body}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="card p-5 text-sm text-muted">施工の記録はまだありません。</p>
        )}
      </Section>
    </AdminPage>
  );
}
