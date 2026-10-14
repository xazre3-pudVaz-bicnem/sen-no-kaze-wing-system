'use client';

import { useActionState } from 'react';
import {
  addCaseNoteAction,
  addProgressReportAction,
  confirmAppointmentAction,
  confirmHandoverAction,
  createAfterServiceRequestAction,
  publishDisasterConsentTextAction,
  setDisasterConsentAction,
  startHandoverInspectionAction,
  saveManufacturingOrderAction,
  saveScheduleItemAction,
  proposeAppointmentAction,
  recordPaperContractAction,
  requestAppointmentChangeAction,
  requestQuoteChangeAction,
  saveDealerProfileAction,
  saveSiteSurveyAction,
  uploadCaseFileAction,
  type CaseFlowActionState,
} from '@/lib/actions/case-flow';
import {
  AFTER_SERVICE_KIND_LABELS,
  APPOINTMENT_PURPOSES,
  APPOINTMENT_PURPOSE_LABELS,
  CASE_NOTE_KIND_LABELS,
  DISASTER_DECISION_LABELS,
  type AfterServiceKind,
  type CaseHandover,
  type DisasterDecision,
  DEALER_SERVICE_CODES,
  DEALER_SERVICE_LABELS,
  MEETING_METHODS,
  MEETING_METHOD_LABELS,
  SITE_LAND_FIELDS,
  SITE_LEGAL_FIELDS,
  TECH_VERDICT_LABELS,
  PROGRESS_KIND_LABELS,
  SCHEDULE_CATEGORY_LABELS,
  SCHEDULE_STATUS_LABELS,
  formatCandidate,
  type AppointmentCandidate,
  type CaseScheduleItem,
  type ManufacturingOrder,
  type ProgressKind,
  type ScheduleCategory,
  type CaseFileContext,
  type CaseNoteKind,
  type DealerProfile,
  type SiteSurvey,
} from '@/lib/domain/case-flow';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

const initial: CaseFlowActionState = { ok: false };

function Result({ state }: { state: CaseFlowActionState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}


// ---------- 日程（本部・担当代理店） ----------

export function AppointmentProposeForm({ quoteId, requestId }: { quoteId: string; requestId: string }) {
  const [state, action, pending] = useActionState(proposeAppointmentAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="appointment-propose-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="日程の種類" htmlFor={`purpose-${requestId}`}>
          <Select id={`purpose-${requestId}`} name="purpose" defaultValue="meeting">
            {APPOINTMENT_PURPOSES.map((purpose) => (
              <option key={purpose} value={purpose}>
                {APPOINTMENT_PURPOSE_LABELS[purpose]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="方法" htmlFor={`method-${requestId}`}>
          <Select id={`method-${requestId}`} name="method" defaultValue="onsite">
            {MEETING_METHODS.map((method) => (
              <option key={method} value={method}>
                {MEETING_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">候補の日時（日本時間・1〜5 つ）</p>
        {[1, 2, 3].map((n) => (
          <div key={n} className="grid grid-cols-2 gap-2">
            <Input type="datetime-local" name={`candidate_${n}_starts`} aria-label={`候補${n}の開始`} required={n === 1} />
            <Input type="datetime-local" name={`candidate_${n}_ends`} aria-label={`候補${n}の終了（任意）`} />
          </div>
        ))}
      </div>
      <Field label="場所" htmlFor={`location-${requestId}`}>
        <Input id={`location-${requestId}`} name="location" placeholder="設置予定地、事務所、オンライン会議の URL など" />
      </Field>
      <Field label="お客様へのご案内" htmlFor={`note-${requestId}`}>
        <Textarea id={`note-${requestId}`} name="note" rows={2} placeholder="当日お持ちいただくもの、所要時間など" />
      </Field>
      <label className="flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" name="confirm" />
        お客様と合意済みの日時として確定する（候補は 1 つだけ）
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Spinner />}
        候補の日時を送る
      </Button>
    </form>
  );
}

// ---------- 日程（お客様） ----------

export function AppointmentChooseForm({
  appointmentId,
  requestId,
  lockVersion,
  candidates,
}: {
  appointmentId: string;
  requestId: string;
  lockVersion: number;
  candidates: AppointmentCandidate[];
}) {
  const [state, action, pending] = useActionState(confirmAppointmentAction, initial);
  const [changeState, changeAction, changePending] = useActionState(requestAppointmentChangeAction, initial);
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-2" data-testid="appointment-choose-form">
        <input type="hidden" name="appointment_id" value={appointmentId} />
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <Result state={state} />
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">ご都合の良い日時を選んでください</legend>
          {candidates.map((candidate, index) => (
            <label key={candidate.starts_at + index} className="flex items-center gap-2 text-sm">
              <input type="radio" name="candidate_index" value={index} required />
              {formatCandidate(candidate)}
            </label>
          ))}
        </fieldset>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Spinner />}
          この日時で決める
        </Button>
      </form>
      <details className="rounded-lg bg-[#f7f8f8] p-3">
        <summary className="cursor-pointer text-sm">どの候補も都合が合わない</summary>
        <form action={changeAction} className="mt-2 space-y-2">
          <input type="hidden" name="appointment_id" value={appointmentId} />
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="expected_lock_version" value={lockVersion} />
          <Result state={changeState} />
          <Textarea name="customer_note" rows={2} required placeholder="ご都合の良い曜日・時間帯をお知らせください" aria-label="日程のご要望" />
          <Button type="submit" variant="secondary" size="sm" disabled={changePending}>
            {changePending && <Spinner />}
            担当へ伝える
          </Button>
        </form>
      </details>
    </div>
  );
}

// ---------- 現地確認 ----------

export function SiteSurveyForm({ quoteId, requestId, survey }: { quoteId: string; requestId: string; survey: SiteSurvey | null }) {
  const [state, action, pending] = useActionState(saveSiteSurveyAction, initial);
  const readOnly = survey?.status === 'completed';
  return (
    <form action={action} className="space-y-4" data-testid="site-survey-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_lock_version" value={survey?.lock_version ?? ''} />
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="確認日" htmlFor={`surveyed-on-${requestId}`}>
          <Input id={`surveyed-on-${requestId}`} type="date" name="surveyed_on" defaultValue={survey?.surveyed_on ?? ''} disabled={readOnly} />
        </Field>
        <Field label="確認した人" htmlFor={`surveyor-${requestId}`}>
          <Input id={`surveyor-${requestId}`} name="surveyor_name" defaultValue={survey?.surveyor_name ?? ''} disabled={readOnly} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">土地・搬入・インフラ</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SITE_LAND_FIELDS.map(({ key, label }) => (
            <Field key={key} label={label} htmlFor={`land-${key}-${requestId}`}>
              <Input id={`land-${key}-${requestId}`} name={`land_${key}`} defaultValue={survey?.land[key] ?? ''} disabled={readOnly} />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">法規・行政</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SITE_LEGAL_FIELDS.map(({ key, label }) => (
            <Field key={key} label={label} htmlFor={`legal-${key}-${requestId}`}>
              <Input id={`legal-${key}-${requestId}`} name={`legal_${key}`} defaultValue={survey?.legal[key] ?? ''} disabled={readOnly} />
            </Field>
          ))}
        </div>
      </fieldset>
      <Field label="測量・確認のメモ" htmlFor={`survey-notes-${requestId}`}>
        <Textarea id={`survey-notes-${requestId}`} name="survey_notes" rows={4} defaultValue={survey?.survey_notes ?? ''} disabled={readOnly} />
      </Field>
      {!readOnly && (
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Spinner />}
          現地確認の内容を保存
        </Button>
      )}
    </form>
  );
}

// ---------- 社内の記録 ----------

export function CaseNoteForm({
  quoteId,
  requestId,
  kinds,
  consults,
}: {
  quoteId: string;
  requestId: string;
  kinds: CaseNoteKind[];
  /** 回答できる相談（本部だけ） */
  consults: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(addCaseNoteAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="case-note-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <Field label="記録の種類" htmlFor={`note-kind-${requestId}`}>
        <Select id={`note-kind-${requestId}`} name="kind" defaultValue={kinds[0]}>
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {CASE_NOTE_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </Field>
      {kinds.includes('tech_review') && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="製造可否（技術検討のとき）" htmlFor={`note-verdict-${requestId}`}>
            <Select id={`note-verdict-${requestId}`} name="verdict" defaultValue="">
              <option value="">—</option>
              {(Object.keys(TECH_VERDICT_LABELS) as (keyof typeof TECH_VERDICT_LABELS)[]).map((verdict) => (
                <option key={verdict} value={verdict}>
                  {TECH_VERDICT_LABELS[verdict]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="概算コスト（円・社内のみ）" htmlFor={`note-cost-${requestId}`}>
            <Input id={`note-cost-${requestId}`} name="estimated_cost" inputMode="numeric" />
          </Field>
        </div>
      )}
      {kinds.includes('consult_reply') && consults.length > 0 && (
        <Field label="回答する相談（回答のとき）" htmlFor={`note-parent-${requestId}`}>
          <Select id={`note-parent-${requestId}`} name="parent_id" defaultValue="">
            <option value="">—</option>
            {consults.map((consult) => (
              <option key={consult.id} value={consult.id}>
                {consult.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="内容" htmlFor={`note-body-${requestId}`}>
        <Textarea id={`note-body-${requestId}`} name="body" rows={3} required />
      </Field>
      <Button type="submit" size="sm" disabled={pending}>
        {pending && <Spinner />}
        記録する
      </Button>
    </form>
  );
}

// ---------- 写真・書類 ----------

export function CaseFileUploadForm({
  quoteId,
  requestId,
  context,
  contextId,
  allowCustomerVisible,
  label = '写真・書類を登録',
}: {
  quoteId: string | null;
  requestId: string;
  context: CaseFileContext;
  contextId?: string | null;
  /** 担当が「お客様にも見せる」を選べるか（お客様が登録するときは常に見える） */
  allowCustomerVisible: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState(uploadCaseFileAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid={`case-file-upload-${context}`}>
      <input type="hidden" name="quote_id" value={quoteId ?? ''} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="context" value={context} />
      <input type="hidden" name="context_id" value={contextId ?? ''} />
      <Result state={state} />
      <Input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required aria-label="ファイル" />
      <Input name="caption" placeholder="説明（任意）" aria-label="説明" />
      {allowCustomerVisible && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="customer_visible" />
          お客様のマイページにも表示する
        </label>
      )}
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        {label}
      </Button>
      <p className="text-[0.65rem] text-muted">JPEG・PNG・WebP の画像と PDF（20MB まで）</p>
    </form>
  );
}

// ---------- 見積の修正依頼（お客様） ----------

export function QuoteChangeRequestForm({ quoteId, requestId }: { quoteId: string; requestId: string }) {
  const [state, action, pending] = useActionState(requestQuoteChangeAction, initial);
  if (state.ok) return <Result state={state} />;
  return (
    <form action={action} className="space-y-2" data-testid="quote-change-request-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <Textarea name="message" rows={3} required maxLength={2000} placeholder="変更したい設備・仕様、ご予算、ご不明な点などをお書きください" aria-label="修正したい内容" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        内容の修正を依頼する
      </Button>
    </form>
  );
}

// ---------- 書面で締結した契約（本部） ----------

export function PaperContractForm({
  quoteId,
  requestId,
  defaultName,
  defaultEmail,
  today,
}: {
  quoteId: string;
  requestId: string;
  defaultName: string;
  defaultEmail: string;
  today: string;
}) {
  const [state, action, pending] = useActionState(recordPaperContractAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="paper-contract-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="署名者の氏名" htmlFor={`paper-name-${quoteId}`}>
          <Input id={`paper-name-${quoteId}`} name="signer_name" defaultValue={defaultName} required maxLength={100} />
        </Field>
        <Field label="署名者のメールアドレス" htmlFor={`paper-email-${quoteId}`}>
          <Input id={`paper-email-${quoteId}`} name="signer_email" type="email" defaultValue={defaultEmail} required />
        </Field>
        <Field label="締結日" htmlFor={`paper-date-${quoteId}`}>
          <Input id={`paper-date-${quoteId}`} name="signed_on" type="date" max={today} defaultValue={today} required />
        </Field>
      </div>
      <Field label="署名済みの契約書（PDF・20MB まで）" htmlFor={`paper-file-${quoteId}`}>
        <Input id={`paper-file-${quoteId}`} name="file" type="file" accept="application/pdf" required />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        書面の契約を記録する
      </Button>
    </form>
  );
}

// ---------- 製造依頼（フェーズ11） ----------

export function ManufacturingOrderForm({
  quoteId,
  requestId,
  order,
  canEditSupply,
  today,
}: {
  quoteId: string;
  requestId: string;
  order: ManufacturingOrder | null;
  /** 本部だけ：基幹資材の供給手配のメモ */
  canEditSupply: boolean;
  today: string;
}) {
  const [state, action, pending] = useActionState(saveManufacturingOrderAction, initial);
  const draft = !order || order.status === 'draft';
  return (
    <form action={action} className="space-y-3" data-testid="manufacturing-order-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="order_id" value={order?.id ?? ''} />
      <input type="hidden" name="expected_lock_version" value={order?.lock_version ?? ''} />
      {!draft && <input type="hidden" name="unit_count" value={order?.unit_count ?? 1} />}
      <Result state={state} />
      {draft && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="棟数" htmlFor={`unit-count-${requestId}`}>
            <Input id={`unit-count-${requestId}`} name="unit_count" type="number" min={1} max={50} defaultValue={order?.unit_count ?? 1} required />
          </Field>
          <Field label="希望納期" htmlFor={`delivery-${requestId}`}>
            <Input id={`delivery-${requestId}`} name="requested_delivery_on" type="date" min={today} defaultValue={order?.requested_delivery_on ?? ''} />
          </Field>
        </div>
      )}
      {draft && (
        <Field label="製造仕様のメモ（図面・仕様・数量・納期の確定内容）" htmlFor={`spec-note-${requestId}`}>
          <Textarea id={`spec-note-${requestId}`} name="spec_note" rows={3} defaultValue={order?.spec_note ?? ''} maxLength={4000} />
        </Field>
      )}
      {canEditSupply && (
        <Field label="基幹資材の供給手配（本部のメモ）" htmlFor={`supply-note-${requestId}`}>
          <Textarea id={`supply-note-${requestId}`} name="supply_note" rows={2} defaultValue={order?.supply_note ?? ''} maxLength={2000} />
        </Field>
      )}
      {(draft || canEditSupply) && (
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending && <Spinner />}
          {order ? '製造依頼を保存' : '製造依頼を作る'}
        </Button>
      )}
    </form>
  );
}

// ---------- 工程表（フェーズ12） ----------

export function ScheduleItemForm({
  quoteId,
  requestId,
  item,
  categories,
  canSetVisible,
}: {
  quoteId: string;
  requestId: string;
  item: CaseScheduleItem | null;
  categories: ScheduleCategory[];
  canSetVisible: boolean;
}) {
  const [state, action, pending] = useActionState(saveScheduleItemAction, initial);
  const key = item?.id ?? `new-${requestId}`;
  return (
    <form action={action} className="space-y-2" data-testid={item ? 'schedule-item-edit-form' : 'schedule-item-form'}>
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="item_id" value={item?.id ?? ''} />
      <input type="hidden" name="expected_lock_version" value={item?.lock_version ?? ''} />
      <Result state={state} />
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem]">
        <Select name="category" defaultValue={item?.category ?? categories[0]} aria-label="工程の種類">
          {categories.map((category) => (
            <option key={category} value={category}>
              {SCHEDULE_CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
        <Input name="title" defaultValue={item?.title ?? ''} placeholder="工程名（例：基礎工事）" required maxLength={100} aria-label="工程名" />
        <Select name="status" defaultValue={item?.status ?? 'planned'} aria-label="工程の状態">
          {(Object.keys(SCHEDULE_STATUS_LABELS) as (keyof typeof SCHEDULE_STATUS_LABELS)[]).map((status) => (
            <option key={status} value={status}>
              {SCHEDULE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[0.65rem] text-muted">
          予定の開始
          <Input type="date" name="planned_start" defaultValue={item?.planned_start ?? ''} />
        </label>
        <label className="text-[0.65rem] text-muted">
          予定の終了
          <Input type="date" name="planned_end" defaultValue={item?.planned_end ?? ''} />
        </label>
        <label className="text-[0.65rem] text-muted">
          実績の開始
          <Input type="date" name="actual_start" defaultValue={item?.actual_start ?? ''} />
        </label>
        <label className="text-[0.65rem] text-muted">
          実績の終了
          <Input type="date" name="actual_end" defaultValue={item?.actual_end ?? ''} />
        </label>
      </div>
      <Input name="note" defaultValue={item?.note ?? ''} placeholder="メモ（お客様に見せる項目では、お客様にも表示されます）" maxLength={1000} aria-label="メモ" />
      {canSetVisible && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="customer_visible" defaultChecked={item?.customer_visible ?? false} />
          お客様のマイページの工程表に表示する
        </label>
      )}
      <Button type="submit" variant="secondary" size="sm" disabled={pending} data-key={key}>
        {pending && <Spinner />}
        {item ? '保存' : '工程を追加'}
      </Button>
    </form>
  );
}

// ---------- 施工の記録（フェーズ13） ----------

export function ProgressReportForm({
  quoteId,
  requestId,
  kinds,
  scheduleItems,
  canSetVisible,
  today,
}: {
  quoteId: string;
  requestId: string;
  kinds: ProgressKind[];
  scheduleItems: { id: string; label: string }[];
  canSetVisible: boolean;
  today: string;
}) {
  const [state, action, pending] = useActionState(addProgressReportAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid="progress-report-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr_10rem]">
        <Select name="kind" defaultValue={kinds[0]} aria-label="記録の種類">
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {PROGRESS_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
        <Input name="title" placeholder="見出し（例：基礎工事が完了しました）" required maxLength={100} aria-label="見出し" />
        <Input name="reported_on" type="date" max={today} defaultValue={today} aria-label="記録日" />
      </div>
      {scheduleItems.length > 0 && (
        <Select name="schedule_item_id" defaultValue="" aria-label="工程">
          <option value="">工程を指定しない</option>
          {scheduleItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      )}
      <Textarea name="body" rows={3} maxLength={4000} placeholder="内容（搬入・設置・基礎・給排水・電気の進み具合、検査の結果など）" aria-label="内容" />
      {canSetVisible && (
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="customer_visible" />
          お客様のマイページの「施工の様子」に表示する
        </label>
      )}
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        記録する
      </Button>
    </form>
  );
}

// ---------- 完了確認・引渡し（フェーズ14） ----------

export function HandoverInspectionForm({
  quoteId,
  requestId,
  handover,
  today,
}: {
  quoteId: string;
  requestId: string;
  handover: CaseHandover | null;
  today: string;
}) {
  const [state, action, pending] = useActionState(startHandoverInspectionAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid="handover-inspection-form">
      <input type="hidden" name="quote_id" value={quoteId} />
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="expected_lock_version" value={handover?.lock_version ?? ''} />
      <Result state={state} />
      <div className="grid gap-2 sm:grid-cols-[11rem_1fr]">
        <label className="text-[0.65rem] text-muted">
          完成確認の日
          <Input type="date" name="inspection_on" defaultValue={handover?.inspection_on ?? today} required />
        </label>
        <label className="text-[0.65rem] text-muted">
          完成確認の内容（お客様にも表示されます）
          <Textarea name="inspection_summary" rows={2} maxLength={2000} defaultValue={handover?.inspection_summary ?? ''} placeholder="確認した箇所・設備の動作・お客様への説明事項など" />
        </label>
      </div>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        {handover ? '完成確認をやり直す（お客様に確認し直してもらう）' : '完成確認を記録して、お客様に確認をお願いする'}
      </Button>
    </form>
  );
}

/** お客様の回答：問題なし／気になる点がある */
export function HandoverConfirmForms({ requestId, lockVersion, canSayOk }: { requestId: string; lockVersion: number; canSayOk: boolean }) {
  const [okState, okAction, okPending] = useActionState(confirmHandoverAction, initial);
  const [issueState, issueAction, issuePending] = useActionState(confirmHandoverAction, initial);
  if (okState.ok) return <Result state={okState} />;
  if (issueState.ok) return <Result state={issueState} />;
  return (
    <div className="space-y-3" data-testid="handover-confirm-forms">
      {canSayOk && (
        <form action={okAction} className="space-y-2">
          <input type="hidden" name="request_id" value={requestId} />
          <input type="hidden" name="result" value="ok" />
          <input type="hidden" name="expected_lock_version" value={lockVersion} />
          <Result state={okState} />
          <Button type="submit" size="sm" disabled={okPending}>
            {okPending && <Spinner />}
            問題ありません
          </Button>
        </form>
      )}
      <form action={issueAction} className="space-y-2">
        <input type="hidden" name="request_id" value={requestId} />
        <input type="hidden" name="result" value="issues" />
        <input type="hidden" name="expected_lock_version" value={lockVersion} />
        <Result state={issueState} />
        <Textarea name="issues" rows={3} required placeholder={'気になる点を 1 行に 1 つお書きください（例：玄関ドアの閉まりが固い）'} aria-label="気になる点" />
        <Button type="submit" variant="secondary" size="sm" disabled={issuePending}>
          {issuePending && <Spinner />}
          気になる点を伝える
        </Button>
        <p className="text-[0.65rem] text-muted">写真があれば、下の「写真・書類を送る」から「指摘事項」として送れます。</p>
      </form>
    </div>
  );
}

// ---------- アフター（フェーズ15） ----------

export function AfterServiceRequestForm({ quoteId, requestId, forCustomer }: { quoteId: string | null; requestId: string; forCustomer: boolean }) {
  const [state, action, pending] = useActionState(createAfterServiceRequestAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid="after-service-request-form">
      <input type="hidden" name="quote_id" value={quoteId ?? ''} />
      <input type="hidden" name="request_id" value={requestId} />
      <Result state={state} />
      <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
        <Select name="kind" defaultValue={forCustomer ? 'repair' : 'inspection'} aria-label="ご依頼の種類">
          {(Object.keys(AFTER_SERVICE_KIND_LABELS) as AfterServiceKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {AFTER_SERVICE_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
        <Input name="title" required maxLength={100} placeholder={forCustomer ? '件名（例：窓の鍵がかかりにくい）' : '件名（例：1 年点検）'} aria-label="件名" />
      </div>
      <Textarea name="body" rows={3} maxLength={4000} placeholder={forCustomer ? 'いつから・どこが・どのような状態か' : '内容・予定日など（お客様にも表示されます）'} aria-label="内容" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        {forCustomer ? '依頼する' : '登録する'}
      </Button>
    </form>
  );
}

// ---------- 災害時提供の意思（フェーズ15） ----------

export function DisasterConsentForm({
  requestId,
  textVersion,
  current,
}: {
  requestId: string;
  textVersion: number;
  current: { decision: DisasterDecision; conditions: string | null } | null;
}) {
  const [state, action, pending] = useActionState(setDisasterConsentAction, initial);
  return (
    <form action={action} className="space-y-2" data-testid="disaster-consent-form">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="text_version" value={textVersion} />
      <Result state={state} />
      <fieldset className="flex flex-wrap gap-4">
        <legend className="sr-only">災害時提供のご意思</legend>
        {(Object.keys(DISASTER_DECISION_LABELS) as DisasterDecision[]).map((decision) => (
          <label key={decision} className="flex items-center gap-1.5 text-sm">
            <input type="radio" name="decision" value={decision} defaultChecked={current?.decision === decision} required />
            {DISASTER_DECISION_LABELS[decision]}
          </label>
        ))}
      </fieldset>
      <Textarea name="conditions" rows={2} maxLength={2000} defaultValue={current?.conditions ?? ''} placeholder="条件付きで承諾する場合の条件（例：連絡がついてから・○月〜○月を除く）" aria-label="条件" />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending && <Spinner />}
        {current ? 'ご意思を変更する' : 'ご意思を記録する'}
      </Button>
    </form>
  );
}

/** 本部：承諾書の文面（先方が確定した文面）を新しい版として登録する */
export function DisasterConsentTextForm() {
  const [state, action, pending] = useActionState(publishDisasterConsentTextAction, initial);
  return (
    <form action={action} className="space-y-3" data-testid="disaster-consent-text-form">
      <Result state={state} />
      <Field label="見出し" htmlFor="consent-title" required>
        <Input id="consent-title" name="title" required maxLength={100} />
      </Field>
      <Field label="文面" htmlFor="consent-body" required hint="先方（本部・法務）が確定した文面をそのまま貼り付けてください。登録した版は変更できません（直すときは新しい版を登録します）。">
        <Textarea id="consent-body" name="body" rows={10} required maxLength={20000} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmed" required />
        先方が確定した文面です。登録すると、引渡し済みのお客様のマイページに表示されます。
      </label>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        新しい版として登録する
      </Button>
    </form>
  );
}

// ---------- 代理店の公開情報 ----------

export function DealerProfileForm({
  dealerId,
  profile,
  prefectures,
}: {
  dealerId: string;
  profile: DealerProfile | null;
  prefectures: string[];
}) {
  const [state, action, pending] = useActionState(saveDealerProfileAction, initial);
  return (
    <form action={action} className="space-y-4" data-testid="dealer-profile-form">
      <input type="hidden" name="dealer_id" value={dealerId} />
      <input type="hidden" name="expected_lock_version" value={profile?.lock_version ?? ''} />
      <Result state={state} />
      <Field label="表示名" htmlFor="display_name" required>
        <Input id="display_name" name="display_name" defaultValue={profile?.display_name ?? ''} required maxLength={100} />
      </Field>
      <Field label="紹介文" htmlFor="intro">
        <Textarea id="intro" name="intro" rows={4} defaultValue={profile?.intro ?? ''} maxLength={2000} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">対応エリア（都道府県）</legend>
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
          {prefectures.map((prefecture) => (
            <label key={prefecture} className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="service_prefectures" value={prefecture} defaultChecked={profile?.service_prefectures.includes(prefecture)} />
              {prefecture}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="対応エリア（市区町村・任意）"
        htmlFor="service_municipalities"
        hint="「都道府県/市区町村」を 1 行に 1 つ。書いた都道府県は、その市区町村だけが対象になります（例：石川県/七尾市）"
      >
        <Textarea id="service_municipalities" name="service_municipalities" rows={3} defaultValue={profile?.service_municipalities.join('\n') ?? ''} />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">施工対応</legend>
        <div className="flex flex-wrap gap-3">
          {DEALER_SERVICE_CODES.map((code) => (
            <label key={code} className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="services" value={code} defaultChecked={profile?.services.includes(code)} />
              {DEALER_SERVICE_LABELS[code]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="資格" htmlFor="qualifications">
        <Textarea id="qualifications" name="qualifications" rows={2} defaultValue={profile?.qualifications ?? ''} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <Field label="施工実績" htmlFor="track_record">
          <Textarea id="track_record" name="track_record" rows={3} defaultValue={profile?.track_record ?? ''} />
        </Field>
        <Field label="施工件数" htmlFor="completed_count">
          <Input id="completed_count" name="completed_count" inputMode="numeric" defaultValue={profile?.completed_count ?? ''} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="電話番号（公開）" htmlFor="phone">
          <Input id="phone" name="phone" defaultValue={profile?.phone ?? ''} />
        </Field>
        <Field label="Web サイト" htmlFor="website_url">
          <Input id="website_url" name="website_url" defaultValue={profile?.website_url ?? ''} placeholder="https://" />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        保存する
      </Button>
    </form>
  );
}
