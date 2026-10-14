'use client';

import { useActionState } from 'react';
import {
  addCaseNoteAction,
  confirmAppointmentAction,
  proposeAppointmentAction,
  requestAppointmentChangeAction,
  saveDealerProfileAction,
  saveSiteSurveyAction,
  uploadCaseFileAction,
  type CaseFlowActionState,
} from '@/lib/actions/case-flow';
import {
  APPOINTMENT_PURPOSES,
  APPOINTMENT_PURPOSE_LABELS,
  CASE_NOTE_KIND_LABELS,
  DEALER_SERVICE_CODES,
  DEALER_SERVICE_LABELS,
  MEETING_METHODS,
  MEETING_METHOD_LABELS,
  SITE_LAND_FIELDS,
  SITE_LEGAL_FIELDS,
  TECH_VERDICT_LABELS,
  formatCandidate,
  type AppointmentCandidate,
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
