'use client';

import { useActionState, useState } from 'react';
import { saveSiteProfileAction, type CaseFlowActionState } from '@/lib/actions/case-flow';
import {
  INTENDED_USE_LABELS,
  LAND_BUDGET_LABELS,
  LAND_CATEGORY_LABELS,
  LAND_STATUS_LABELS,
  ROAD_ACCESS_LABELS,
  SITE_UTILITY_FIELDS,
  UTILITY_STATUS_LABELS,
  type LandStatus,
  type SiteProfile,
} from '@/lib/domain/case-flow';
import { Alert, Button, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

function Options<T extends string>({ labels }: { labels: Record<T, string> }) {
  return (
    <>
      <option value="">選んでください</option>
      {(Object.keys(labels) as T[]).map((key) => (
        <option key={key} value={key}>
          {labels[key]}
        </option>
      ))}
    </>
  );
}

/**
 * 設置予定地・土地の入力欄（フェーズ3）。土地の有無で入力する項目が変わる：
 * 土地あり → 設置予定地（住所・面積・地目・前面道路・電気・水道・排水）、土地なし・未定 → 希望地域・用途・土地のご予算。
 * マイページの「設置予定地・土地」と、見積依頼の画面で使う（見積依頼の画面は、住所を既存の「設置予定地」の欄で受ける）。
 */
export function SiteProfileFields({
  profile,
  values,
  includeAddress,
  defaultDesiredArea,
  idPrefix = 'land',
}: {
  profile: SiteProfile | null;
  /** 送信に失敗して戻ってきたときの入力 */
  values?: Record<string, string | undefined>;
  includeAddress: boolean;
  /** 希望地域の初期値（シミュレーターで選んだ都道府県・市区町村） */
  defaultDesiredArea?: string;
  idPrefix?: string;
}) {
  const [status, setStatus] = useState<LandStatus | ''>(((values?.land_status ?? profile?.land_status) || '') as LandStatus | '');
  const value = (key: string) => {
    if (values && key in values) return values[key] ?? '';
    const stored = profile?.[(key === 'land_note' ? 'note' : key) as keyof SiteProfile];
    return stored === null || stored === undefined ? '' : String(stored);
  };
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="space-y-4" data-testid="site-profile-fields">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">土地はありますか？</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(Object.keys(LAND_STATUS_LABELS) as LandStatus[]).map((key) => (
            <label key={key} className="flex items-center gap-1.5 text-sm">
              <input type="radio" name="land_status" value={key} checked={status === key} onChange={() => setStatus(key)} data-testid={`land-status-${key}`} />
              {LAND_STATUS_LABELS[key]}
            </label>
          ))}
        </div>
      </fieldset>

      {status === 'owned' && (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="site-profile-owned">
          {includeAddress && (
            <Field label="設置予定地（住所・地番）" htmlFor={id('address')} hint="分かる範囲で構いません" className="sm:col-span-2">
              <Input id={id('address')} name="site_address" defaultValue={value('site_address')} maxLength={200} />
            </Field>
          )}
          <Field label="敷地面積（おおよそ）" htmlFor={id('area')} hint="㎡で入力します（1坪 ≒ 3.3㎡）">
            <div className="flex items-center gap-2">
              <Input id={id('area')} name="area_sqm" inputMode="decimal" defaultValue={value('area_sqm')} placeholder="例：200" />
              <span className="shrink-0 text-sm text-ink-soft">㎡</span>
            </div>
          </Field>
          <Field label="地目" htmlFor={id('category')} hint="登記簿の地目です。農地は転用の手続きが必要なことがあります">
            <Select id={id('category')} name="land_category" defaultValue={value('land_category')}>
              <Options labels={LAND_CATEGORY_LABELS} />
            </Select>
          </Field>
          <Field label="前面道路" htmlFor={id('road')} hint="建物を建てるには、幅 4m 以上の道路に接していることが必要な場合があります">
            <Select id={id('road')} name="road_access" defaultValue={value('road_access')}>
              <Options labels={ROAD_ACCESS_LABELS} />
            </Select>
          </Field>
          {SITE_UTILITY_FIELDS.map(({ key, label }) => (
            <Field key={key} label={label} htmlFor={id(key)}>
              <Select id={id(key)} name={key} defaultValue={value(key)}>
                <Options labels={UTILITY_STATUS_LABELS} />
              </Select>
            </Field>
          ))}
        </div>
      )}

      {(status === 'none' || status === 'undecided') && (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="site-profile-search">
          <Field label="希望地域" htmlFor={id('desired-area')} hint="市区町村や「海の近く」など、分かる範囲で構いません" className="sm:col-span-2">
            <Input id={id('desired-area')} name="desired_area" defaultValue={value('desired_area') || defaultDesiredArea || ''} maxLength={200} />
          </Field>
          <Field label="希望用途" htmlFor={id('use')}>
            <Select id={id('use')} name="intended_use" defaultValue={value('intended_use')}>
              <Options labels={INTENDED_USE_LABELS} />
            </Select>
          </Field>
          <Field label="土地のご予算（目安）" htmlFor={id('budget')}>
            <Select id={id('budget')} name="land_budget" defaultValue={value('land_budget')}>
              <Options labels={LAND_BUDGET_LABELS} />
            </Select>
          </Field>
          <p className="text-xs leading-5 text-ink-soft sm:col-span-2">土地探しからご相談いただけます。見積を依頼すると、担当の代理店からご連絡します。</p>
        </div>
      )}

      {status && (
        <Field label="土地についてのメモ（任意）" htmlFor={id('note')}>
          <Textarea id={id('note')} name="land_note" rows={2} maxLength={1000} defaultValue={value('land_note')} placeholder="傾斜地、搬入路が細い、など" />
        </Field>
      )}
    </div>
  );
}

const initial: CaseFlowActionState = { ok: false };

/** マイページの「設置予定地・土地」の保存フォーム */
export function SiteProfileForm({ configurationId, profile, defaultDesiredArea }: { configurationId: string; profile: SiteProfile | null; defaultDesiredArea?: string }) {
  const [state, action, pending] = useActionState(saveSiteProfileAction, initial);
  return (
    <form action={action} className="card space-y-5 p-6 sm:p-8" data-testid="site-profile-form">
      <input type="hidden" name="configuration_id" value={configurationId} />
      <input type="hidden" name="expected_lock_version" value={profile?.lock_version ?? ''} />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="success">{state.message}</Alert>}
      <SiteProfileFields profile={profile} includeAddress defaultDesiredArea={defaultDesiredArea} />
      <Button type="submit" disabled={pending} data-testid="site-profile-save">
        {pending && <Spinner />}
        {pending ? '保存中…' : '保存する'}
      </Button>
    </form>
  );
}
