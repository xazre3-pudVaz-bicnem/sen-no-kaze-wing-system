'use client';

import { useActionState } from 'react';
import { RefreshCw } from 'lucide-react';
import { requestQuoteAction, type QuoteRequestState } from '@/lib/actions/configurations';
import { MEETING_METHODS, MEETING_METHOD_LABELS, SLOT_PERIODS, SLOT_PERIOD_LABELS, type SiteProfile } from '@/lib/domain/case-flow';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { SiteProfileFields } from '@/components/case-flow/site-profile-fields';

interface Props {
  configurationId: string;
  /** この確認画面に表示しているプランの版。送信時に DB の版と照合する（版の列が無い DB では null） */
  lockVersion: number | null;
  /** 相談したい代理店の候補（公開中で、設置予定地に対応している代理店） */
  dealers?: { id: string; name: string }[];
  /** 打合せの希望日の下限（日本時間の今日） */
  today?: string;
  /** マイページで入力済みの設置予定地・土地（フェーズ3） */
  siteProfile?: SiteProfile | null;
  /** シミュレーターで選んだ地域（希望地域の初期値） */
  siteArea?: string;
  defaults: {
    full_name: string;
    company_name: string;
    email: string;
    phone: string;
    address: string;
    site_address?: string;
    site_profile_lock_version?: string;
  };
}

const initial: QuoteRequestState = { ok: false };

const CONFIGURATION_CONFLICT_MESSAGE = '他の画面でこのプランが更新されています';

export function QuoteRequestForm({ configurationId, lockVersion, dealers = [], today, siteProfile = null, siteArea, defaults }: Props) {
  const [state, action, pending] = useActionState(requestQuoteAction, initial);
  const v: Record<string, string | undefined> = { ...defaults, ...(state.values ?? {}) };
  const isConflict = Boolean(state.error?.includes(CONFIGURATION_CONFLICT_MESSAGE));
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" noValidate data-testid="quote-request-form">
      <input type="hidden" name="configuration_id" value={configurationId} />
      <input type="hidden" name="expected_lock_version" value={lockVersion ?? ''} />
      <input type="hidden" name="site_profile_lock_version" value={v.site_profile_lock_version ?? ''} />
      {isConflict ? (
        <Alert tone="warn">
          <div data-testid="quote-request-conflict-message">
            <p className="font-semibold text-ink">ほかの画面でこのプランが更新されています。</p>
            <p className="mt-2 text-sm leading-relaxed">
              見積依頼はまだ送信していません。最新の内容を再読み込みして仕様と金額を確認してから、もう一度依頼してください。
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => window.location.reload()}
              data-testid="quote-request-conflict-reload"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              最新の内容を再読み込み
            </Button>
          </div>
        </Alert>
      ) : (
        state.error && <Alert tone="danger">{state.error}</Alert>
      )}
      <h2 className="text-xl">お客様情報</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="お名前" htmlFor="full_name" required errors={state.fieldErrors?.full_name}>
          <Input id="full_name" name="full_name" defaultValue={v.full_name} autoComplete="name" required />
        </Field>
        <Field label="法人名" htmlFor="company_name" errors={state.fieldErrors?.company_name}>
          <Input id="company_name" name="company_name" defaultValue={v.company_name} autoComplete="organization" />
        </Field>
        <Field label="メールアドレス" htmlFor="email" required errors={state.fieldErrors?.email}>
          <Input id="email" name="email" type="email" defaultValue={v.email} autoComplete="email" required />
        </Field>
        <Field label="電話番号" htmlFor="phone" required errors={state.fieldErrors?.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} autoComplete="tel" required />
        </Field>
      </div>
      <Field label="ご住所" htmlFor="address" required errors={state.fieldErrors?.address}>
        <Input id="address" name="address" defaultValue={v.address} autoComplete="street-address" required />
      </Field>
      <Field label="設置予定地" htmlFor="site_address" hint="分かる範囲で構いません。土地をお持ちなら住所・地番まで（例：石川県七尾市○○ 海沿いの傾斜地）" errors={state.fieldErrors?.site_address}>
        <Input id="site_address" name="site_address" defaultValue={v.site_address} />
      </Field>
      <fieldset className="space-y-4 rounded-lg border border-line p-4" data-testid="quote-request-site-profile">
        <legend className="px-1 text-sm font-semibold">土地について（任意）</legend>
        <SiteProfileFields profile={siteProfile} values={state.values} includeAddress={false} defaultDesiredArea={siteArea} idPrefix="request-land" />
      </fieldset>
      <Field label="ご要望・ご質問" htmlFor="message" errors={state.fieldErrors?.message}>
        <Textarea id="message" name="message" defaultValue={v.message} placeholder="搬入路の状況、希望時期、確認申請の要否など" />
      </Field>
      <fieldset className="space-y-4 rounded-lg border border-line p-4" data-testid="quote-request-preferences">
        <legend className="px-1 text-sm font-semibold">打合せのご希望（任意）</legend>
        {dealers.length > 0 && (
          <Field label="相談したい代理店" htmlFor="preferred_dealer_id" hint="設置予定地に対応している代理店です。本部が担当を決めるときの参考にします">
            <Select id="preferred_dealer_id" name="preferred_dealer_id" defaultValue={v.preferred_dealer_id ?? ''}>
              <option value="">指定しない</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="打合せの方法" htmlFor="meeting_method">
          <Select id="meeting_method" name="meeting_method" defaultValue={v.meeting_method ?? ''}>
            <option value="">おまかせ</option>
            {MEETING_METHODS.map((method) => (
              <option key={method} value={method}>
                {MEETING_METHOD_LABELS[method]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium">打合せの希望日（3 つまで）</p>
          {[1, 2, 3].map((n) => (
            <div key={n} className="grid grid-cols-[1fr_9rem] gap-2">
              <Input
                type="date"
                name={`slot_${n}_date`}
                min={today}
                defaultValue={v[`slot_${n}_date`]}
                aria-label={`第${n}希望の日付`}
              />
              <Select name={`slot_${n}_period`} defaultValue={v[`slot_${n}_period`] ?? 'any'} aria-label={`第${n}希望の時間帯`}>
                {SLOT_PERIODS.map((period) => (
                  <option key={period} value={period}>
                    {SLOT_PERIOD_LABELS[period]}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        <Field label="日程のご要望" htmlFor="schedule_note">
          <Textarea id="schedule_note" name="schedule_note" defaultValue={v.schedule_note} placeholder="平日の夕方以降が都合が良い、など" rows={2} />
        </Field>
      </fieldset>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="submit-quote-request">
        {pending && <Spinner />}
        {pending ? '送信中…' : 'この仕様で見積を依頼する'}
      </Button>
    </form>
  );
}
