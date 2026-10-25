'use client';

import { useActionState, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { requestQuoteAction, type QuoteRequestState } from '@/lib/actions/configurations';
import { MEETING_METHODS, MEETING_METHOD_LABELS, SLOT_PERIODS, SLOT_PERIOD_LABELS, type SiteProfile } from '@/lib/domain/case-flow';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { SiteProfileFields } from '@/components/case-flow/site-profile-fields';
import { SAME_SITE_ADDRESS_CONFIRMATION_FIELD, SAME_SITE_ADDRESS_CONFIRMATION_MESSAGE, sameContactAndSiteAddress } from '@/lib/domain/quote-contact-site-address';

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
  /** 保存されたシミュレーターの地域（未定・未選択も区別して表示） */
  selectedSiteAreaLabel: string;
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

export function QuoteRequestForm({ configurationId, lockVersion, dealers = [], today, siteProfile = null, siteArea, selectedSiteAreaLabel, defaults }: Props) {
  const [state, action, pending] = useActionState(requestQuoteAction, initial);
  const v: Record<string, string | undefined> = { ...defaults, ...(state.values ?? {}) };
  const isConflict = Boolean(state.error?.includes(CONFIGURATION_CONFLICT_MESSAGE));
  const [observedAddresses, setObservedAddresses] = useState({
    contact: v.address ?? '',
    site: v.site_address ?? '',
  });
  const [addressReadFromForm, setAddressReadFromForm] = useState(false);
  const [sameAddressConfirmed, setSameAddressConfirmed] = useState(false);

  // ブラウザのオートフィルでDOMの入力値だけ変わる場合、Reactの初期stateとずれる。
  // 入力またはフォーカス時に、連絡先と設置先を必ず同じフォームの実際の値から読み取る。
  function refreshAddressesFromForm(form: HTMLFormElement | null) {
    if (!form) return;
    const data = new FormData(form);
    setObservedAddresses({
      contact: String(data.get('address') ?? ''),
      site: String(data.get('site_address') ?? ''),
    });
    setAddressReadFromForm(true);
    setSameAddressConfirmed(false);
  }

  // ブラウザ側で自動入力を検知できなかった場合も、
  // サーバーが差し戻した入力値から確認欄を復元できるようにする。
  const matchingAddresses = sameContactAndSiteAddress(observedAddresses.contact, observedAddresses.site)
    || (!addressReadFromForm && sameContactAndSiteAddress(v.address, v.site_address))
    || (!addressReadFromForm && state.error === SAME_SITE_ADDRESS_CONFIRMATION_MESSAGE);
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" noValidate data-testid="quote-request-form"
      onSubmitCapture={(event) => {
        // サイレントなブラウザ自動入力でも、送信時のDOM値を最終確認する。
        const data = new FormData(event.currentTarget);
        const contact = String(data.get('address') ?? '');
        const site = String(data.get('site_address') ?? '');
        if (sameContactAndSiteAddress(contact, site)
          && data.get(SAME_SITE_ADDRESS_CONFIRMATION_FIELD) !== 'on') {
          event.preventDefault();
          setObservedAddresses({ contact, site });
          setAddressReadFromForm(true);
          setSameAddressConfirmed(false);
        }
      }}
    >
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
      <Field label="お客様のご住所（連絡先）" htmlFor="address" hint="Wingの設置予定地とは異なる住所でも構いません。" required errors={state.fieldErrors?.address}>
        <Input id="address" name="address" defaultValue={v.address} autoComplete="street-address" required
          onFocus={(event) => refreshAddressesFromForm(event.currentTarget.form)}
          onInput={(event) => refreshAddressesFromForm(event.currentTarget.form)}
        />
      </Field>
      <div className="rounded-lg border border-line bg-sand/50 px-4 py-3" data-testid="quote-request-selected-site-area">
        <p className="text-xs text-ink-soft">シミュレーターで選択した設置予定地</p>
        <p className="mt-1 text-sm font-semibold text-ink">{selectedSiteAreaLabel}</p>
      </div>
      <Field label="詳しい設置住所・地番（任意）" htmlFor="site_address" hint="以前入力した土地情報がある場合は初期表示されます。設置場所が未定なら空欄にしてください。" errors={state.fieldErrors?.site_address}>
        <Input id="site_address" name="site_address" defaultValue={v.site_address} autoComplete="off"
          onFocus={(event) => refreshAddressesFromForm(event.currentTarget.form)}
          onInput={(event) => refreshAddressesFromForm(event.currentTarget.form)}
        />
      </Field>
      {matchingAddresses && (
        <div className="rounded-lg border border-line bg-sand/60 p-4 text-sm" role="group" aria-label="連絡先住所と設置住所の確認" data-testid="quote-request-same-address-confirmation">
          <p className="font-semibold">連絡先住所と設置住所に同じ内容が入力されています。</p>
          <p className="mt-1 text-ink-soft">設置先が違う場合は詳しい設置住所を修正してください。未定の場合は空欄で見積を依頼できます。</p>
          <label className="mt-3 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              name={SAME_SITE_ADDRESS_CONFIRMATION_FIELD}
              value="on"
              checked={sameAddressConfirmed}
              onChange={(event) => setSameAddressConfirmed(event.target.checked)}
              className="mt-1 shrink-0"
            />
            <span>連絡先住所と設置住所は同じ場所で間違いありません</span>
          </label>
        </div>
      )}
      <details
        className="group rounded-lg border border-line"
        data-testid="quote-request-site-profile-disclosure"
        open={Boolean(state.error?.startsWith('設置予定地・土地：'))}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
          <span>土地について（任意）</span>
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <fieldset className="min-w-0 space-y-4 border-t border-line p-4" data-testid="quote-request-site-profile">
          <legend className="sr-only">土地について（任意）</legend>
          <SiteProfileFields profile={siteProfile} values={state.values} includeAddress={false} defaultDesiredArea={siteArea} idPrefix="request-land" />
        </fieldset>
      </details>
      <Field label="ご要望・ご質問" htmlFor="message" errors={state.fieldErrors?.message}>
        <Textarea id="message" name="message" defaultValue={v.message} placeholder="搬入路の状況、希望時期、確認申請の要否など" />
      </Field>
      <details className="group rounded-lg border border-line" data-testid="quote-request-preferences-disclosure">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold [&::-webkit-details-marker]:hidden">
          <span>打合せのご希望（任意）</span>
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <fieldset className="min-w-0 space-y-4 border-t border-line p-4" data-testid="quote-request-preferences">
          <legend className="sr-only">打合せのご希望（任意）</legend>
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
      </details>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="submit-quote-request">
        {pending && <Spinner />}
        {pending ? '送信中…' : 'この仕様で見積を依頼する'}
      </Button>
    </form>
  );
}
