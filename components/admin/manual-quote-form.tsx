'use client';

import { useActionState, useState } from 'react';
import { createManualQuoteAction } from '@/lib/actions/admin';
import { FINISH_LEVELS, FINISH_LEVEL_INFO, type FinishLevel } from '@/lib/domain/types';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { Status, SubmitButton } from './forms';

const initial = { ok: false } as const;

export interface ManualQuoteModel {
  id: string;
  name: string;
  presets: { code: string; name: string; description: string }[];
}

/**
 * スタッフ（本部・総代理店・代理店）がWeb外の案件を登録する。
 * この画面ではRevisionを発行せず、案件 + 空Draftだけを作ってExcel型編集へ進む。
 */
export function ManualQuoteForm({ models }: { models: ManualQuoteModel[] }) {
  const [state, action, pending] = useActionState(createManualQuoteAction, initial);
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} className="card max-w-2xl space-y-5 p-6" noValidate data-testid="manual-quote-form">
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="お客様名" htmlFor="mq-name" required errors={e.customer_name}>
          <Input id="mq-name" name="customer_name" required placeholder="例：山田 太郎" data-testid="mq-customer-name" />
        </Field>
        <Field label="会社名（任意）" htmlFor="mq-company" errors={e.customer_company}>
          <Input id="mq-company" name="customer_company" />
        </Field>
        <div className="sm:col-span-2">
          <Field
            label="設置予定地（任意）"
            htmlFor="mq-site-address"
            hint="分かる範囲で入力してください。住所を登録すると案件一覧からGoogleマップを開けます。"
            errors={e.site_address}
          >
            <Input
              id="mq-site-address"
              name="site_address"
              placeholder="例：石川県鳳珠郡穴水町○○"
              data-testid="mq-site-address"
            />
          </Field>
        </div>
        <Field label="本体（モデル）" htmlFor="mq-model" required errors={e.base_model_id}>
          <Select id="mq-model" name="base_model_id" value={modelId} onChange={(ev) => setModelId(ev.target.value)} data-testid="mq-model">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="仕様" htmlFor="mq-spec" required hint="仕様ごとに本体の内訳（分類表見積書）が変わります" errors={e.spec_code}>
          <Select id="mq-spec" name="spec_code" key={modelId} defaultValue={model?.presets[0]?.code} data-testid="mq-spec">
            {(model?.presets ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="注文範囲" htmlFor="mq-level" required errors={e.finish_level}>
          <Select id="mq-level" name="finish_level" defaultValue="full" data-testid="mq-level">
            {FINISH_LEVELS.map((lv: FinishLevel) => (
              <option key={lv} value={lv}>
                {FINISH_LEVEL_INFO[lv].name}（{FINISH_LEVEL_INFO[lv].short}）
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="メモ（任意）" htmlFor="mq-memo" hint="現地条件・お客様のご要望など" errors={e.memo}>
        <Textarea id="mq-memo" name="memo" rows={3} />
      </Field>
      <p className="text-xs text-muted">
        登録時点では見積Revisionを発行しません。空のDraftを作成し、次のExcel型編集画面で明細・金額を入力します。
        「正式保存」を行った時点で、初めて正式なRevision 1が作成されます。
      </p>
      <SubmitButton pending={pending} label="案件を登録して見積Draftを開く" />
    </form>
  );
}
