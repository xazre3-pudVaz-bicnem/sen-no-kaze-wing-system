import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { activeContract } from '@/lib/domain/electronic-contract';
import {
  APPOINTMENT_PURPOSE_LABELS,
  MANUFACTURING_ORDER_STATUS_LABELS,
  MEETING_METHOD_LABELS,
  SCHEDULE_CATEGORY_LABELS,
  SCHEDULE_STATUS_LABELS,
  formatCandidate,
} from '@/lib/domain/case-flow';
import { isFormalQuote } from '@/lib/domain/quote-lifecycle';
import { formatDate } from '@/lib/utils';
import { Badge, Container, Section } from '@/components/ui';
import { AppointmentChooseForm, CaseFileUploadForm } from '@/components/case-flow/forms';
import { CaseFileList } from '@/components/case-flow/case-site-panels';

export const metadata: Metadata = { title: 'ご依頼の進み具合 | マイページ', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Step = { key: string; label: string; done: boolean; detail: string | null };

/** お客様の案件（見積依頼）の進み具合：受付・日程・現地確認・正式見積・契約（フェーズ5〜10） */
export default async function CustomerCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/mypage/cases/${id}`);
  const caseFlow = await getCaseFlowStore();
  const access = await caseFlow.getCaseAccess(user, id);
  // このページはお客様の画面。本部・担当は案件画面で扱う
  if (access !== 'customer') notFound();

  const store = await getStore();
  const [progress, appointments, files, quotes, contracts, scheduleItems, reports] = await Promise.all([
    caseFlow.getCaseProgress(user, id),
    caseFlow.listCaseAppointments(user, id),
    caseFlow.listCaseFiles(user, id),
    store.listQuotes(user.id),
    store.listElectronicContracts(id, user),
    // お客様には、担当が「お客様に表示」にした工程・記録だけが返る（RLS）
    caseFlow.listScheduleItems(user, id),
    caseFlow.listProgressReports(user, id),
  ]);
  const caseQuotes = quotes.filter((q) => q.quote_request_id === id).sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0));
  const latest = caseQuotes[0] ?? null;
  if (!latest) notFound();
  const formal = caseQuotes.find((q) => isFormalQuote(q) && q.status !== 'superseded') ?? null;
  const contract = activeContract(contracts);
  const confirmed = appointments.find((a) => a.status === 'confirmed');
  const proposals = appointments.filter((a) => a.status === 'proposed');

  const steps: Step[] = [
    { key: 'requested', label: '見積のご依頼', done: true, detail: formatDate(latest.issued_at) },
    { key: 'acknowledged', label: '受付', done: Boolean(progress?.acknowledged_at), detail: progress?.acknowledged_at ? formatDate(progress.acknowledged_at) : null },
    {
      key: 'appointment',
      label: '打合せ・現地調査の日程',
      done: Boolean(confirmed) || appointments.some((a) => a.status === 'done'),
      detail: confirmed?.confirmed_starts_at ? formatCandidate({ starts_at: confirmed.confirmed_starts_at, ends_at: confirmed.confirmed_ends_at }) : null,
    },
    {
      key: 'site_survey',
      label: '現地確認',
      done: progress?.site_survey_status === 'completed',
      detail: progress?.site_survey_completed_at ? formatDate(progress.site_survey_completed_at) : null,
    },
    { key: 'formal', label: '正式見積', done: Boolean(formal), detail: formal ? `第${formal.revision}版` : null },
    { key: 'contract', label: 'ご契約', done: contract?.status === 'signed', detail: contract?.signed_at ? formatDate(contract.signed_at) : null },
    {
      key: 'manufacturing',
      label: '製造',
      done: progress?.manufacturing_status === 'shipped' || progress?.manufacturing_status === 'completed',
      detail:
        progress?.manufacturing_status && progress.manufacturing_status !== 'none'
          ? `${MANUFACTURING_ORDER_STATUS_LABELS[progress.manufacturing_status]}${progress.unit_count ? `（${progress.unit_count}棟中 出荷 ${progress.units_shipped ?? 0}）` : ''}`
          : null,
    },
    {
      key: 'installation',
      label: '設置・施工',
      done: Boolean(progress?.unit_count) && (progress?.units_installed ?? 0) >= (progress?.unit_count ?? 0),
      detail: progress?.unit_count ? `${progress.units_installed ?? 0} / ${progress.unit_count} 棟 設置済み` : null,
    },
  ];
  const progressFiles = files.filter((file) => file.context === 'progress');
  const otherFiles = files.filter((file) => file.context !== 'progress');

  return (
    <Section className="py-10 sm:py-14">
      <Container className="max-w-4xl space-y-6">
        <Link href="/mypage" className="text-sm text-ink-soft underline-offset-4 hover:underline">
          ← マイページへ戻る
        </Link>
        <div>
          <p className="eyebrow">Your project</p>
          <h1 className="mt-1 text-3xl">ご依頼の進み具合</h1>
          <p className="mt-2 text-sm text-ink-soft">
            {latest.base_model_name}・見積番号 <span className="font-mono">{latest.quote_no}</span>
            {progress?.primary_staff_name && <>　担当：{progress.primary_staff_name}</>}
          </p>
        </div>

        <ol className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8" data-testid="customer-case-steps">
          {steps.map((step) => (
            <li key={step.key} className={`rounded-lg border p-3 text-sm ${step.done ? 'border-[#cfe3d6] bg-[#f3faf5]' : 'border-line bg-white'}`}>
              <p className="text-xs text-muted">{step.done ? '完了' : 'これから'}</p>
              <p className="font-semibold">{step.label}</p>
              {step.detail && <p className="mt-1 text-xs text-ink-soft">{step.detail}</p>}
            </li>
          ))}
        </ol>

        <section className="card space-y-3 p-5" data-testid="customer-case-appointments">
          <h2 className="text-lg font-semibold">打合せ・現地調査の日程</h2>
          {appointments.length === 0 && <p className="text-sm text-muted">担当より日程のご連絡をいたします。しばらくお待ちください。</p>}
          {proposals.map((a) => (
            <div key={a.id} className="space-y-2 rounded-lg border border-[#e6d8a8] bg-[#fffaf0] p-4">
              <p className="text-sm font-semibold">
                {APPOINTMENT_PURPOSE_LABELS[a.purpose]}（{MEETING_METHOD_LABELS[a.method]}）の候補日が届いています
              </p>
              {a.location && <p className="text-xs text-ink-soft">場所：{a.location}</p>}
              {a.note && <p className="whitespace-pre-wrap text-xs text-ink-soft">{a.note}</p>}
              {a.customer_note ? (
                <p className="text-xs text-muted">ご要望を担当へお伝えしました：{a.customer_note}</p>
              ) : null}
              <AppointmentChooseForm appointmentId={a.id} requestId={id} lockVersion={a.lock_version} candidates={a.candidates} />
            </div>
          ))}
          {appointments
            .filter((a) => a.status === 'confirmed' || a.status === 'done')
            .map((a) => (
              <div key={a.id} className="rounded-lg border border-line p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{APPOINTMENT_PURPOSE_LABELS[a.purpose]}</span>
                  <Badge tone={a.status === 'done' ? 'neutral' : 'success'}>{a.status === 'done' ? '実施済み' : '確定'}</Badge>
                </div>
                {a.confirmed_starts_at && <p className="mt-1">{formatCandidate({ starts_at: a.confirmed_starts_at, ends_at: a.confirmed_ends_at })}</p>}
                <p className="text-xs text-muted">
                  {MEETING_METHOD_LABELS[a.method]}
                  {a.location ? `・${a.location}` : ''}
                </p>
                {a.note && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-soft">{a.note}</p>}
              </div>
            ))}
        </section>

        {scheduleItems.length > 0 && (
          <section className="card space-y-3 p-5" data-testid="customer-case-schedule">
            <h2 className="text-lg font-semibold">工程表</h2>
            <ul className="divide-y divide-line text-sm">
              {scheduleItems.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="mr-2 text-xs text-muted">{SCHEDULE_CATEGORY_LABELS[item.category]}</span>
                    {item.title}
                    {item.note && <span className="ml-2 text-xs text-ink-soft">{item.note}</span>}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {item.actual_end
                      ? `${item.actual_end} 完了`
                      : item.planned_start
                        ? `予定 ${item.planned_start}${item.planned_end && item.planned_end !== item.planned_start ? `〜${item.planned_end}` : ''}`
                        : '日程調整中'}
                    <Badge tone={item.status === 'done' ? 'success' : item.status === 'delayed' ? 'warn' : 'neutral'} className="ml-2">
                      {SCHEDULE_STATUS_LABELS[item.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reports.length > 0 && (
          <section className="card space-y-4 p-5" data-testid="customer-case-progress">
            <h2 className="text-lg font-semibold">施工の様子</h2>
            {reports.map((report) => (
              <article key={report.id} className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <p className="text-xs text-muted">{report.reported_on}</p>
                <h3 className="font-semibold">{report.title}</h3>
                {report.body && <p className="whitespace-pre-wrap text-sm text-ink-soft">{report.body}</p>}
                <CaseFileList files={progressFiles.filter((file) => file.context_id === report.id)} actor={user} quoteId={null} requestId={id} back={`/mypage/cases/${id}`} />
              </article>
            ))}
          </section>
        )}

        <section className="card space-y-3 p-5" data-testid="customer-case-files">
          <h2 className="text-lg font-semibold">写真・資料</h2>
          <p className="text-xs text-muted">担当がお客様向けに共有した写真・資料と、お客様が登録した資料です。</p>
          <CaseFileList files={otherFiles} actor={user} quoteId={null} requestId={id} back={`/mypage/cases/${id}`} />
          <details className="rounded-lg bg-[#f7f8f8] p-3">
            <summary className="cursor-pointer text-sm">設置予定地の写真・図面を担当へ送る</summary>
            <div className="mt-2">
              <CaseFileUploadForm quoteId={null} requestId={id} context="document" allowCustomerVisible={false} label="送る" />
            </div>
          </details>
        </section>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link href={`/mypage/quotes/${latest.id}`} className="btn-secondary btn-sm">
            最新の見積書を見る
          </Link>
        </div>
      </Container>
    </Section>
  );
}
