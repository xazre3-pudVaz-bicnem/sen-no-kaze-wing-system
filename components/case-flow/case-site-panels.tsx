import Link from 'next/link';
import { getStore, type SessionUser } from '@/lib/data/store';
import { getCaseFlowStore } from '@/lib/data/case-flow/store';
import {
  acknowledgeCaseAction,
  assignCasePrimaryStaffAction,
  deleteCaseFileAction,
  setAppointmentStatusAction,
  setCaseManufacturerAction,
  setSiteSurveyStatusAction,
} from '@/lib/actions/case-flow';
import {
  APPOINTMENT_PURPOSE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CASE_FILE_CONTEXT_LABELS,
  CASE_NOTE_KIND_LABELS,
  MEETING_METHOD_LABELS,
  SLOT_PERIOD_LABELS,
  TECH_VERDICT_LABELS,
  formatCandidate,
  siteProfileSummary,
  type CaseAccess,
  type CaseFile,
  type CaseFileContext,
  type CaseNoteKind,
} from '@/lib/domain/case-flow';
import { formatDate } from '@/lib/utils';
import { formatYen } from '@/lib/domain/pricing';
import { Alert, Badge } from '@/components/ui';
import { AppointmentProposeForm, CaseFileUploadForm, CaseNoteForm, SiteSurveyForm } from '@/components/case-flow/forms';

const DONE_TEXT: Record<string, string> = {
  acknowledged: '受付済みにしました。お客様へお知らせしました。',
  primary: '主担当者を更新しました。',
  manufacturer: '技術検討・製造の担当を更新しました。',
  appointment: '日程を更新しました。',
  survey: '現地確認の状態を更新しました。',
};

function Section({ title, badge, children, testId }: { title: string; badge?: React.ReactNode; children: React.ReactNode; testId: string }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-white p-4 shadow-sm" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** 案件の写真・書類の一覧（どの文脈でも使う）。お客様に見せるものは印を付ける */
export function CaseFileList({
  files,
  actor,
  quoteId,
  requestId,
  back,
}: {
  files: CaseFile[];
  actor: SessionUser;
  quoteId: string | null;
  requestId: string;
  back: string;
}) {
  if (files.length === 0) return <p className="text-xs text-muted">まだ登録されていません。</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {files.map((file) => (
        <li key={file.id} className="rounded-lg border border-line p-2 text-xs">
          {file.content_type.startsWith('image/') ? (
            // 非公開の画像は、見てよいかを確かめるサーバーの経路から読む（next/image の最適化を通さない）
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/case-files/${file.id}`} alt={file.caption ?? file.file_name} className="mb-2 aspect-[4/3] w-full rounded object-cover" loading="lazy" />
          ) : null}
          <a href={`/api/case-files/${file.id}`} target="_blank" rel="noopener" className="font-semibold underline-offset-4 hover:underline">
            {file.caption || file.file_name}
          </a>
          <p className="mt-1 text-muted">
            {CASE_FILE_CONTEXT_LABELS[file.context]}・{formatDate(file.created_at)}
            {file.customer_visible ? '・お客様に表示' : ''}
          </p>
          {(file.uploaded_by === actor.id || actor.role === 'admin') && (
            <form action={deleteCaseFileAction} className="mt-1">
              <input type="hidden" name="file_id" value={file.id} />
              <input type="hidden" name="quote_id" value={quoteId ?? ''} />
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="text-[0.65rem] text-danger underline-offset-4 hover:underline">
                削除
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 案件画面の「現地確認」タブ：受付・担当（フェーズ5〜6）、日程（予約ボード）、現地確認・技術検討・本部への相談（フェーズ7）。
 * お客様に見せない情報を含むため、本部・担当代理店・技術検討の担当だけに表示する。
 */
export async function CaseSitePanels({
  quoteId,
  actor,
  flash,
}: {
  quoteId: string;
  actor: SessionUser;
  flash?: { done?: string; error?: string };
}) {
  const store = await getStore();
  const detail = await store.getQuote(quoteId, actor);
  if (!detail) return null;
  const requestId = detail.quote.quote_request_id;
  const caseFlow = await getCaseFlowStore();
  const access: CaseAccess | null = await caseFlow.getCaseAccess(actor, requestId);
  if (!access || access === 'customer') return null;
  const isAdmin = access === 'admin';
  const canOperate = access === 'admin' || access === 'staff';

  // お客様が入力した設置予定地・土地（フェーズ3。プランに紐づく）
  const configurationId = detail.request?.configuration_id ?? null;
  const siteProfile = configurationId ? await caseFlow.getSiteProfile(actor, configurationId) : null;
  const [workflow, preferences, appointments, survey, notes, files, profiles] = await Promise.all([
    caseFlow.getCaseWorkflow(actor, requestId),
    caseFlow.getQuoteRequestPreferences(actor, requestId),
    caseFlow.listCaseAppointments(actor, requestId),
    caseFlow.getSiteSurvey(actor, requestId),
    caseFlow.listCaseNotes(actor, requestId),
    caseFlow.listCaseFiles(actor, requestId),
    isAdmin ? store.listProfiles() : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null | undefined) => {
    if (!id) return null;
    if (id === actor.id) return `${actor.full_name || 'あなた'}（あなた）`;
    const p = profiles.find((profile) => profile.id === id);
    return p ? p.full_name || p.company_name || p.email : null;
  };
  const admins = profiles.filter((p) => p.role_code === 'admin');
  const masterDealers = profiles.filter((p) => p.role_code === 'master_dealer');
  const preferredDealer = preferences?.preferred_dealer_id
    ? (await caseFlow.listPublishedDealerProfiles()).find((d) => d.dealer_id === preferences.preferred_dealer_id)
    : null;
  const back = `/admin/quotes/${quoteId}?tab=site`;
  const noteKinds: CaseNoteKind[] =
    access === 'manufacturer'
      ? ['tech_review']
      : isAdmin
        ? ['meeting', 'consult_reply', 'tech_review', 'other']
        : ['meeting', 'consult', 'other'];
  const consults = notes
    .filter((note) => note.kind === 'consult')
    .map((note) => ({ id: note.id, label: `${formatDate(note.created_at)} ${note.author_name}：${note.body.slice(0, 30)}` }));
  const siteFiles = files.filter((file) => file.context === 'site_survey' || file.context === 'document');

  return (
    <div className="mt-2 space-y-2" id="case-flow-site">
      {flash?.error && <Alert tone="danger">{flash.error}</Alert>}
      {flash?.done && DONE_TEXT[flash.done] && <Alert tone="success">{DONE_TEXT[flash.done]}</Alert>}

      <Section
        title="受付・担当"
        testId="case-intake-panel"
        badge={workflow?.acknowledged_at ? <Badge tone="success">受付済み</Badge> : <Badge tone="warn">未受付</Badge>}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="space-y-2 rounded-lg bg-[#fbfcfb] p-3 text-sm">
            <p className="text-xs font-semibold text-muted">受付</p>
            {workflow?.acknowledged_at ? (
              <p>{formatDate(workflow.acknowledged_at)} に受付（{nameOf(workflow.acknowledged_by) ?? '担当'}）</p>
            ) : canOperate ? (
              <form action={acknowledgeCaseAction}>
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <button type="submit" className="btn-primary btn-sm">
                  内容を確認し、受付済みにする
                </button>
                <p className="mt-1 text-[0.65rem] text-muted">お客様へ「ご依頼を受け付けました」とお知らせします。</p>
              </form>
            ) : (
              <p className="text-muted">未受付</p>
            )}
          </div>
          <div className="space-y-2 rounded-lg bg-[#fbfcfb] p-3 text-sm">
            <p className="text-xs font-semibold text-muted">主担当者</p>
            <p>{nameOf(workflow?.primary_staff_id) ?? (workflow?.primary_staff_id ? '設定済み' : '未設定')}</p>
            {isAdmin && (
              <form action={assignCasePrimaryStaffAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <select name="staff_id" defaultValue={workflow?.primary_staff_id ?? ''} className="input h-9 max-w-[14rem] text-sm" aria-label="主担当者">
                  <option value="">未設定</option>
                  {admins.map((p) => (
                    <option key={p.id} value={p.id}>
                      本部：{p.full_name || p.email}
                    </option>
                  ))}
                  {detail.quote.dealer_id && (
                    <option value={detail.quote.dealer_id}>担当代理店：{nameOf(detail.quote.dealer_id) ?? '担当代理店'}</option>
                  )}
                </select>
                <button type="submit" className="btn-secondary btn-sm">
                  変更
                </button>
              </form>
            )}
            {access === 'staff' && workflow?.primary_staff_id !== actor.id && (
              <form action={assignCasePrimaryStaffAction}>
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <input type="hidden" name="staff_id" value={actor.id} />
                <button type="submit" className="btn-secondary btn-sm">
                  自分を主担当者にする
                </button>
              </form>
            )}
          </div>
          <div className="space-y-2 rounded-lg bg-[#fbfcfb] p-3 text-sm">
            <p className="text-xs font-semibold text-muted">技術検討・製造の担当（総代理店）</p>
            <p>{nameOf(workflow?.manufacturer_id) ?? (workflow?.manufacturer_id ? '設定済み' : '未設定')}</p>
            {isAdmin && (
              <form action={setCaseManufacturerAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <select name="manufacturer_id" defaultValue={workflow?.manufacturer_id ?? ''} className="input h-9 max-w-[14rem] text-sm" aria-label="技術検討・製造の担当">
                  <option value="">未設定</option>
                  {masterDealers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.company_name || p.full_name || p.email}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-secondary btn-sm">
                  変更
                </button>
              </form>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-line p-3 text-sm" data-testid="case-preferences">
          <p className="text-xs font-semibold text-muted">お客様のご希望（見積依頼のとき）</p>
          {preferences ? (
            <dl className="mt-1 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="inline text-muted">相談したい代理店：</dt>
                <dd className="inline">{preferredDealer?.display_name ?? (preferences.preferred_dealer_id ? '（非公開の代理店）' : '指定なし')}</dd>
              </div>
              <div>
                <dt className="inline text-muted">打合せの方法：</dt>
                <dd className="inline">{preferences.meeting_method ? MEETING_METHOD_LABELS[preferences.meeting_method] : 'おまかせ'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="inline text-muted">希望日：</dt>
                <dd className="inline">
                  {preferences.preferred_slots.length
                    ? preferences.preferred_slots.map((slot) => `${slot.date}（${SLOT_PERIOD_LABELS[slot.period]}）`).join('、')
                    : '指定なし'}
                </dd>
              </div>
              {preferences.note && (
                <div className="sm:col-span-2">
                  <dt className="inline text-muted">ご要望：</dt>
                  <dd className="inline whitespace-pre-wrap">{preferences.note}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="mt-1 text-muted">ご希望の入力はありません。</p>
          )}
        </div>
      </Section>

      {canOperate && (
        <Section title="打合せ・現地調査の日程" testId="case-appointments-panel" badge={<Link href="/admin/appointments" className="text-xs underline-offset-4 hover:underline">予約ボード</Link>}>
          {appointments.length === 0 ? (
            <p className="text-xs text-muted">日程はまだありません。</p>
          ) : (
            <ul className="space-y-2">
              {appointments.map((a) => (
                <li key={a.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{APPOINTMENT_PURPOSE_LABELS[a.purpose]}</span>
                    <Badge tone={a.status === 'confirmed' ? 'success' : a.status === 'proposed' ? 'warn' : 'neutral'}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                    <span className="text-xs text-muted">{MEETING_METHOD_LABELS[a.method]}</span>
                  </div>
                  {a.confirmed_starts_at ? (
                    <p className="mt-1">{formatCandidate({ starts_at: a.confirmed_starts_at, ends_at: a.confirmed_ends_at })}</p>
                  ) : (
                    <p className="mt-1 text-xs text-ink-soft">候補：{a.candidates.map(formatCandidate).join(' ／ ')}</p>
                  )}
                  {a.location && <p className="text-xs text-muted">場所：{a.location}</p>}
                  {a.customer_note && <p className="mt-1 rounded bg-[#fff8df] px-2 py-1 text-xs">お客様からのご要望：{a.customer_note}</p>}
                  {(a.status === 'proposed' || a.status === 'confirmed') && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.status === 'confirmed' && (
                        <form action={setAppointmentStatusAction}>
                          <input type="hidden" name="quote_id" value={quoteId} />
                          <input type="hidden" name="request_id" value={requestId} />
                          <input type="hidden" name="appointment_id" value={a.id} />
                          <input type="hidden" name="expected_lock_version" value={a.lock_version} />
                          <input type="hidden" name="status" value="done" />
                          <button type="submit" className="btn-secondary btn-sm">
                            実施済みにする
                          </button>
                        </form>
                      )}
                      <form action={setAppointmentStatusAction}>
                        <input type="hidden" name="quote_id" value={quoteId} />
                        <input type="hidden" name="request_id" value={requestId} />
                        <input type="hidden" name="appointment_id" value={a.id} />
                        <input type="hidden" name="expected_lock_version" value={a.lock_version} />
                        <input type="hidden" name="status" value="canceled" />
                        <button type="submit" className="btn-ghost btn-sm">
                          取り消す
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-lg bg-[#fbfcfb] p-3">
            <summary className="cursor-pointer text-sm font-semibold">新しい日程を送る</summary>
            <div className="mt-3">
              <AppointmentProposeForm quoteId={quoteId} requestId={requestId} />
            </div>
          </details>
        </Section>
      )}

      <Section
        title="お客様が入力した設置予定地・土地"
        testId="case-site-profile-panel"
        badge={<span className="text-[0.65rem] text-muted">お客様の申告（現地確認の前の参考）</span>}
      >
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
          <p className="text-xs text-muted">お客様はまだ土地の情報を入力していません（マイページか見積依頼の画面で入力できます）。</p>
        )}
      </Section>

      <Section
        title="現地確認の記録"
        testId="case-site-survey-panel"
        badge={
          survey?.status === 'completed' ? (
            <Badge tone="success">完了（{formatDate(survey.completed_at ?? survey.updated_at)}）</Badge>
          ) : survey ? (
            <Badge tone="warn">記録中</Badge>
          ) : (
            <Badge tone="neutral">未記録</Badge>
          )
        }
      >
        {canOperate ? (
          <>
            <SiteSurveyForm quoteId={quoteId} requestId={requestId} survey={survey} />
            {survey && (
              <form action={setSiteSurveyStatusAction}>
                <input type="hidden" name="quote_id" value={quoteId} />
                <input type="hidden" name="request_id" value={requestId} />
                <input type="hidden" name="expected_lock_version" value={survey.lock_version} />
                <input type="hidden" name="status" value={survey.status === 'completed' ? 'draft' : 'completed'} />
                <button type="submit" className="btn-secondary btn-sm">
                  {survey.status === 'completed' ? '記録中に戻す' : '現地確認を完了にする'}
                </button>
              </form>
            )}
          </>
        ) : survey ? (
          <dl className="grid gap-1 text-sm sm:grid-cols-2">
            {Object.entries({ ...survey.land, ...survey.legal }).map(([key, value]) => (
              <div key={key}>
                <dt className="inline text-muted">{key}：</dt>
                <dd className="inline">{value}</dd>
              </div>
            ))}
            {survey.survey_notes && <p className="sm:col-span-2 whitespace-pre-wrap">{survey.survey_notes}</p>}
          </dl>
        ) : (
          <p className="text-xs text-muted">現地確認はまだ記録されていません。</p>
        )}
        <div className="space-y-2 border-t border-line pt-3">
          <p className="text-sm font-semibold">現地の写真・資料</p>
          <CaseFileList files={siteFiles} actor={actor} quoteId={quoteId} requestId={requestId} back={back} />
          {canOperate && <CaseFileUploadForm quoteId={quoteId} requestId={requestId} context="site_survey" allowCustomerVisible={false} />}
        </div>
      </Section>

      <Section title="打合せ記録・本部への相談・技術検討" testId="case-notes-panel" badge={<span className="text-[0.65rem] text-muted">お客様には表示しません</span>}>
        {notes.length === 0 ? (
          <p className="text-xs text-muted">記録はまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className={`rounded-lg border p-3 text-sm ${note.parent_id ? 'ml-6 border-[#d6e4ef] bg-[#f6fafd]' : 'border-line'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={note.kind === 'tech_review' ? 'navy' : note.kind === 'consult' ? 'warn' : 'neutral'}>{CASE_NOTE_KIND_LABELS[note.kind]}</Badge>
                  <span className="text-muted">
                    {formatDate(note.created_at)}・{note.author_name}
                  </span>
                  {note.verdict && <span className="font-semibold">{TECH_VERDICT_LABELS[note.verdict]}</span>}
                  {note.estimated_cost !== null && <span className="text-muted">概算 {formatYen(note.estimated_cost)}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg bg-[#fbfcfb] p-3">
          <summary className="cursor-pointer text-sm font-semibold">記録を追加する</summary>
          <div className="mt-3">
            <CaseNoteForm quoteId={quoteId} requestId={requestId} kinds={noteKinds} consults={isAdmin ? consults : []} />
          </div>
        </details>
      </Section>
    </div>
  );
}

/** 使っている文脈のラベル（テストで参照する） */
export const SITE_FILE_CONTEXTS: CaseFileContext[] = ['site_survey', 'document'];
