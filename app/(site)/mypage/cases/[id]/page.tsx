import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getStore } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import { activeContract } from '@/lib/domain/electronic-contract';
import {
  AFTER_SERVICE_KIND_LABELS,
  APPOINTMENT_PURPOSE_LABELS,
  DISASTER_DECISION_LABELS,
  MANUFACTURING_ORDER_STATUS_LABELS,
  MEETING_METHOD_LABELS,
  SCHEDULE_CATEGORY_LABELS,
  SCHEDULE_STATUS_LABELS,
  formatCandidate,
  siteProfileSummary,
  type AfterServiceStatus,
  type HandoverStatus,
  type PunchItemStatus,
} from '@/lib/domain/case-flow';
import { setPunchItemStatusAction } from '@/lib/actions/case-flow';
import { isFormalQuote } from '@/lib/domain/quote-lifecycle';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Container, Section } from '@/components/ui';
import { AfterServiceRequestForm, AppointmentChooseForm, CaseFileUploadForm, DisasterConsentForm, HandoverConfirmForms } from '@/components/case-flow/forms';
import { CaseFileList } from '@/components/case-flow/case-site-panels';

export const metadata: Metadata = { title: 'ご依頼の進み具合 | マイページ', robots: { index: false } };
export const dynamic = 'force-dynamic';

type Step = { key: string; label: string; done: boolean; detail: string | null };

const HANDOVER_TEXT: Record<HandoverStatus, string> = {
  inspecting: '完成内容をご確認ください',
  correcting: 'ご指摘の点を是正しています',
  ready: 'お引渡しの準備ができました',
  handed_over: 'お引渡し済み',
};
const PUNCH_TEXT: Record<PunchItemStatus, string> = { open: '是正の準備中', fixed: '是正しました（ご確認ください）', verified: 'ご確認済み' };
const AFTER_SERVICE_TEXT: Record<AfterServiceStatus, string> = { open: '受付', in_progress: '対応中', escalated: '対応中（製造元で確認しています）', resolved: '対応済み' };

/** お客様の案件（見積依頼）の進み具合：受付・日程・現地確認・正式見積・契約・製造・設置・引渡し・アフター（フェーズ5〜15） */
export default async function CustomerCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/mypage/cases/${id}`);
  const caseFlow = await getCaseFlowStore();
  const access = await caseFlow.getCaseAccess(user, id);
  // このページはお客様の画面。本部・担当は案件画面で扱う
  if (access !== 'customer') notFound();

  const store = await getStore();
  const [progress, appointments, files, quotes, contracts, scheduleItems, reports, handover, punchItems, afterService, consentTexts, consents] = await Promise.all([
    caseFlow.getCaseProgress(user, id),
    caseFlow.listCaseAppointments(user, id),
    caseFlow.listCaseFiles(user, id),
    store.listQuotes(user.id),
    store.listElectronicContracts(id, user),
    // お客様には、担当が「お客様に表示」にした工程・記録だけが返る（RLS）
    caseFlow.listScheduleItems(user, id),
    caseFlow.listProgressReports(user, id),
    caseFlow.getHandover(user, id),
    caseFlow.listPunchItems(user, id),
    caseFlow.listAfterServiceRequests(user, id),
    caseFlow.listDisasterConsentTexts(user),
    caseFlow.listDisasterConsents(user, id),
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
    {
      key: 'handover',
      label: 'お引渡し',
      done: handover?.status === 'handed_over',
      detail: handover ? (handover.handed_over_on ?? HANDOVER_TEXT[handover.status]) : null,
    },
  ];
  const progressFiles = files.filter((file) => file.context === 'progress');
  const afterFiles = files.filter((file) => file.context === 'after_service');
  const otherFiles = files.filter((file) => file.context !== 'progress' && file.context !== 'after_service');
  const handedOver = handover?.status === 'handed_over';
  const openPunch = punchItems.filter((item) => item.status !== 'verified');
  // 承諾書の文面は先方が決める。本部が登録するまで、災害時提供の欄は表示しない
  const consentText = consentTexts[0] ?? null;
  const currentConsent = consents[0] ?? null;
  const back = `/mypage/cases/${id}`;
  // 設置予定地・土地（フェーズ3。プランに紐づく）
  const siteProfile = latest.configuration_id ? await caseFlow.getSiteProfile(user, latest.configuration_id) : null;

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

        {sp.error && <Alert tone="danger">{sp.error}</Alert>}
        {sp.done === 'punch_status' && <Alert tone="success">是正の内容をご確認いただきました。ありがとうございます。</Alert>}

        <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="customer-case-steps">
          {steps.map((step) => (
            <li key={step.key} className={`rounded-lg border p-3 text-sm ${step.done ? 'border-[#cfe3d6] bg-[#f3faf5]' : 'border-line bg-white'}`}>
              <p className="text-xs text-muted">{step.done ? '完了' : 'これから'}</p>
              <p className="font-semibold">{step.label}</p>
              {step.detail && <p className="mt-1 text-xs text-ink-soft">{step.detail}</p>}
            </li>
          ))}
        </ol>

        {latest.configuration_id && (
          <section className="card space-y-3 p-5" data-testid="customer-case-site-profile">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">設置予定地・土地</h2>
              <Link href={`/mypage/configurations/${latest.configuration_id}/land`} className="text-sm underline-offset-4 hover:underline">
                {siteProfile ? '変更する' : '入力する'}
              </Link>
            </div>
            {siteProfile ? (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
                {siteProfileSummary(siteProfile).map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-xs text-muted">{row.label}</dt>
                    <dd className="whitespace-pre-wrap">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted">土地の有無や設置予定地を教えていただくと、担当が現地確認の準備をしやすくなります。</p>
            )}
          </section>
        )}

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

        {handover && (
          <section className="card space-y-4 p-5" data-testid="customer-case-handover">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">完成内容のご確認・お引渡し</h2>
              <Badge tone={handedOver ? 'success' : handover.status === 'ready' ? 'navy' : 'warn'}>{HANDOVER_TEXT[handover.status]}</Badge>
            </div>
            <p className="text-sm text-ink-soft">
              完成確認の日：{handover.inspection_on}
              {handover.handed_over_on && <>　お引渡し日：{handover.handed_over_on}</>}
            </p>
            {handover.inspection_summary && <p className="whitespace-pre-wrap rounded-lg bg-[#f7f8f8] p-3 text-sm">{handover.inspection_summary}</p>}

            {punchItems.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">ご指摘・是正の内容</h3>
                <ul className="space-y-2">
                  {punchItems.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm">
                      <span className="min-w-0 flex-1 whitespace-pre-wrap">{item.description}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={item.status === 'verified' ? 'success' : item.status === 'fixed' ? 'navy' : 'neutral'}>{PUNCH_TEXT[item.status]}</Badge>
                        {item.status === 'fixed' && !handedOver && (
                          <form action={setPunchItemStatusAction}>
                            <input type="hidden" name="request_id" value={id} />
                            <input type="hidden" name="item_id" value={item.id} />
                            <input type="hidden" name="status" value="verified" />
                            <input type="hidden" name="expected_lock_version" value={item.lock_version} />
                            <input type="hidden" name="back" value={back} />
                            <button type="submit" className="btn-secondary btn-sm">
                              是正を確認しました
                            </button>
                          </form>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!handedOver && (
              <div className="space-y-2 rounded-lg border border-[#e6d8a8] bg-[#fffaf0] p-4">
                {handover.status === 'ready' ? (
                  <p className="text-sm">ご確認ありがとうございます。担当よりお引渡しの日程をご連絡いたします。お引渡しの前に気になる点があれば、お知らせください。</p>
                ) : openPunch.length > 0 ? (
                  <p className="text-sm">是正が終わった点をご確認ください。すべてご確認いただくと「問題ありません」をお選びいただけます。</p>
                ) : (
                  <p className="text-sm">完成内容をご確認のうえ、問題がなければ「問題ありません」を、気になる点があればその内容をお知らせください。</p>
                )}
                <HandoverConfirmForms requestId={id} lockVersion={handover.lock_version} canSayOk={handover.status !== 'ready' && openPunch.length === 0} />
                <details>
                  <summary className="cursor-pointer text-xs">気になる点の写真を送る</summary>
                  <div className="mt-2">
                    <CaseFileUploadForm quoteId={null} requestId={id} context="punch" allowCustomerVisible={false} label="送る" />
                  </div>
                </details>
              </div>
            )}
          </section>
        )}

        {handedOver && (
          <section className="card space-y-4 p-5" data-testid="customer-case-after-service">
            <h2 className="text-lg font-semibold">点検・修理などのご依頼</h2>
            <p className="text-xs text-muted">定期点検のご相談、不具合の修理、使い方のご質問などを担当へお送りいただけます。</p>
            {afterService.length > 0 && (
              <ul className="space-y-3">
                {afterService.map((row) => (
                  <li key={row.id} className="space-y-2 rounded-lg border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone="neutral">{AFTER_SERVICE_KIND_LABELS[row.kind]}</Badge>
                      <Badge tone={row.status === 'resolved' ? 'success' : 'warn'}>{AFTER_SERVICE_TEXT[row.status]}</Badge>
                      <span className="text-muted">{formatDate(row.created_at)}</span>
                    </div>
                    <p className="font-semibold">{row.title}</p>
                    {row.body && <p className="whitespace-pre-wrap text-ink-soft">{row.body}</p>}
                    {row.response && <p className="whitespace-pre-wrap rounded-lg bg-[#f3faf5] p-3">担当より：{row.response}</p>}
                    <CaseFileList files={afterFiles.filter((file) => file.context_id === row.id)} actor={user} quoteId={null} requestId={id} back={back} />
                    {row.status !== 'resolved' && (
                      <details>
                        <summary className="cursor-pointer text-xs">このご依頼の写真を送る</summary>
                        <div className="mt-2">
                          <CaseFileUploadForm quoteId={null} requestId={id} context="after_service" contextId={row.id} allowCustomerVisible={false} label="送る" />
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <details className="rounded-lg bg-[#f7f8f8] p-3" open={afterService.length === 0}>
              <summary className="cursor-pointer text-sm font-semibold">新しく依頼する</summary>
              <div className="mt-3">
                <AfterServiceRequestForm quoteId={null} requestId={id} forCustomer />
              </div>
            </details>
          </section>
        )}

        {handedOver && consentText && (
          <section className="card space-y-4 p-5" data-testid="customer-case-disaster">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">災害時のご提供について</h2>
              {currentConsent ? <Badge tone="neutral">現在：{DISASTER_DECISION_LABELS[currentConsent.decision]}</Badge> : <Badge tone="warn">未回答</Badge>}
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-[#fbfcfb] p-4 text-sm" data-testid="disaster-consent-text">
              <p className="font-semibold">{consentText.title}</p>
              <p className="mt-2 whitespace-pre-wrap leading-7 text-ink-soft">{consentText.body}</p>
              <p className="mt-2 text-[0.65rem] text-muted">第{consentText.version}版</p>
            </div>
            {currentConsent?.conditions && <p className="text-xs text-ink-soft">現在の条件：{currentConsent.conditions}</p>}
            <DisasterConsentForm requestId={id} textVersion={consentText.version} current={currentConsent ? { decision: currentConsent.decision, conditions: currentConsent.conditions } : null} />
            <p className="text-[0.65rem] text-muted">ご意思はいつでも変更できます。変更の記録は残ります。</p>
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
