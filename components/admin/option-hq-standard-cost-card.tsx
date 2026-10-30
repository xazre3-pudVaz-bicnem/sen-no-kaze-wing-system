'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveOptionHqStandardCostAction,
  type OptionHqStandardCostActionState,
} from '@/lib/actions/option-hq-standard-cost';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/utils';

type CostRow = {
  standard_cost: number;
  lock_version: number;
};

type VersionRow = {
  id: string;
  version_no: number;
  standard_cost: number;
  change_reason: string;
  created_at: string;
  superseded_at: string | null;
};

type Props = {
  optionId: string;
  canManage: boolean;
  cost: CostRow | null;
  /** 標準原価の Version（新しい順）。Version の表がまだ DB に無い間は null */
  versions?: VersionRow[] | null;
};

const VERSION_HISTORY_LIMIT = 20;

const initialState: OptionHqStandardCostActionState = { ok: false };

export function OptionHqStandardCostCard({ optionId, canManage, cost, versions = null }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(saveOptionHqStandardCostAction, initialState);
  const currentCost = state.ok && state.standardCost !== undefined ? state.standardCost : cost?.standard_cost;
  const currentVersion = state.ok && state.lockVersion !== undefined ? state.lockVersion : cost?.lock_version ?? 0;
  const currentCostVersion = versions?.find((version) => version.superseded_at === null) ?? null;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok, state.lockVersion]);

  return (
    <section className="card space-y-3 p-4 sm:p-5" data-testid="option-hq-standard-cost-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-brown">本部内部情報</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">本部商品基準原価（税別）</h2>
            <span className={`rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${
              currentCost === undefined
                ? 'bg-[#fff1cf] text-[#7c5a18]'
                : 'bg-[#eaf6f1] text-[#245a48]'
            }`}>
              {currentCost === undefined ? '未設定' : '設定済み'}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            本部が商品原価の基準値として管理する金額です。実仕入価格・案件実原価ではありません。
            既存の見積・発行済みQuoteには自動反映されません。
            {versions !== null && ' 変更するたびに新しい版として記録し、過去の版は書き換えません。'}
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-4 rounded-xl border border-line bg-sand/20 px-3 py-2 sm:min-w-56">
          <div>
            <p className="text-[0.7rem] text-muted">現在の基準原価</p>
            <p className="mt-0.5 font-semibold tabular-nums">
              {currentCost === undefined ? '未設定' : formatYen(currentCost)}
            </p>
            {currentCostVersion && (
              <p className="mt-0.5 text-[0.7rem] text-muted" data-testid="option-hq-standard-cost-version">
                第{currentCostVersion.version_no}版（{formatDate(currentCostVersion.created_at)}）
              </p>
            )}
          </div>
          {canManage && (
            <Button type="button" variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? '閉じる' : currentCost === undefined ? '設定' : '変更'}
            </Button>
          )}
        </div>
      </div>

      {!canManage && (
        <p className="border-t border-line pt-3 text-xs text-muted">
          この権限では閲覧のみです。変更は本部owner/adminまたはglobal adminが行えます。
        </p>
      )}

      {state.ok && <Alert tone="success">{state.message}</Alert>}

      {versions !== null && versions.length > 0 && (
        <details className="border-t border-line pt-3" data-testid="option-hq-standard-cost-history">
          <summary className="cursor-pointer text-xs font-semibold text-brown">
            変更履歴（{versions.length >= VERSION_HISTORY_LIMIT ? `新しい${VERSION_HISTORY_LIMIT}件` : `${versions.length}件`}）
          </summary>
          <ol className="mt-2 space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="grid gap-1 rounded-lg border border-line px-3 py-2 text-sm sm:grid-cols-[6rem_8rem_8rem_minmax(0,1fr)] sm:items-baseline sm:gap-3"
              >
                <span className="text-xs font-semibold">
                  第{version.version_no}版{version.superseded_at === null ? '（現在）' : ''}
                </span>
                <span className="font-semibold tabular-nums">{formatYen(version.standard_cost)}</span>
                <span className="text-xs text-muted tabular-nums">{formatDate(version.created_at, true)}</span>
                <span className="min-w-0 break-words text-xs text-muted">{version.change_reason}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      {canManage && editing && (
        <form action={action} className="space-y-4 border-t border-line pt-4">
          <input type="hidden" name="option_id" value={optionId} />
          <input type="hidden" name="expected_lock_version" value={currentVersion} />

          <div className="grid gap-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <Field label="本部商品基準原価（税別・円）" htmlFor="hq-standard-cost" required>
              <Input
                key={`${optionId}:${currentVersion}:${currentCost ?? 'unset'}`}
                id="hq-standard-cost"
                name="standard_cost"
                type="number"
                min={0}
                max={2147483647}
                step={1}
                required
                defaultValue={currentCost ?? ''}
                placeholder="例：95000"
                inputMode="numeric"
              />
            </Field>

            <Field label="変更理由" htmlFor="hq-standard-cost-reason" required hint="初回設定・変更ともに必須です（1〜500文字）。">
              <Textarea
                key={`reason:${optionId}:${currentVersion}`}
                id="hq-standard-cost-reason"
                name="change_reason"
                minLength={1}
                maxLength={500}
                required
                placeholder="例：2026年10月の本部基準原価資料に基づき設定"
              />
            </Field>
          </div>

          {state.error && <Alert tone="danger">{state.error}</Alert>}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? '保存中…' : currentCost === undefined ? '本部基準原価を設定' : '本部基準原価を変更'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
