'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveOptionHqStandardCostAction,
  type OptionHqStandardCostActionState,
} from '@/lib/actions/option-hq-standard-cost';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { formatYen } from '@/lib/domain/pricing';

type CostRow = {
  standard_cost: number;
  lock_version: number;
};

type Props = {
  optionId: string;
  canManage: boolean;
  cost: CostRow | null;
};

const initialState: OptionHqStandardCostActionState = { ok: false };

export function OptionHqStandardCostCard({ optionId, canManage, cost }: Props) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveOptionHqStandardCostAction, initialState);
  const currentCost = state.ok && state.standardCost !== undefined ? state.standardCost : cost?.standard_cost;
  const currentVersion = state.ok && state.lockVersion !== undefined ? state.lockVersion : cost?.lock_version ?? 0;

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [router, state.ok, state.lockVersion]);

  return (
    <section className="card space-y-4 p-4 sm:p-5" data-testid="option-hq-standard-cost-card">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brown">本部内部情報</p>
        <h2 className="mt-1 text-lg font-semibold">本部商品基準原価（税別）</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          本部が商品原価の基準値として管理する金額です。実仕入価格・案件実原価ではありません。
          既存の見積・発行済みQuoteには自動反映されません。
        </p>
      </div>

      {!canManage ? (
        <dl>
          <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 border-t border-line py-3 text-sm">
            <dt className="text-muted">現在の基準原価</dt>
            <dd className="font-semibold tabular-nums">{currentCost === undefined ? '未設定' : formatYen(currentCost)}</dd>
          </div>
          <p className="text-xs text-muted">この権限では閲覧のみです。変更は本部owner/adminまたはglobal adminが行えます。</p>
        </dl>
      ) : (
        <form action={action} className="space-y-4">
          <input type="hidden" name="option_id" value={optionId} />
          <input type="hidden" name="expected_lock_version" value={currentVersion} />

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

          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.ok && <Alert tone="success">{state.message}</Alert>}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-xs text-muted">
              {currentCost === undefined ? '現在：未設定' : `現在：${formatYen(currentCost)}`} ／ version {currentVersion}
            </p>
            <Button type="submit" disabled={pending}>{pending ? '保存中…' : '本部商品基準原価を保存'}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
