'use client';

import { useActionState, useState } from 'react';
import {
  saveVariantChoiceAction,
  saveVariantGroupAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import {
  type OptionVariantChoice,
  type OptionVariantGroup,
  type ProductOption,
} from '@/lib/domain/types';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

const initial: AdminFormState = { ok: false };

function ActionStatus({ state }: { state: AdminFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.fieldErrors?._form) return <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function PendingButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Spinner />}
      {children}
    </Button>
  );
}

function GroupFields({
  optionId,
  group,
  groups,
  choices,
}: {
  optionId: string;
  group: OptionVariantGroup | null;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
}) {
  const [state, action, pending] = useActionState(saveVariantGroupAction, initial);
  const [parentCode, setParentCode] = useState(group?.depends_on_group_code ?? '');
  const [customerVisible, setCustomerVisible] = useState(group?.status !== 'draft');
  const e = state.fieldErrors ?? {};
  const parent = groups.find((row) => row.code === parentCode && row.id !== group?.id) ?? null;
  const parentChoices = parent ? choices.filter((choice) => choice.group_id === parent.id) : [];
  const isNew = !group;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={group?.id ?? ''} />
      <input type="hidden" name="option_id" value={optionId} />
      <input type="hidden" name="status" value={customerVisible ? 'published' : 'draft'} />
      <ActionStatus state={state} />

      <Field
        label="何を選びますか？"
        htmlFor={`variant-group-name-${group?.id ?? 'new'}`}
        hint="例：カラー／扉色／浴槽色／水栓仕様"
        required
        errors={e.name}
      >
        <Input
          id={`variant-group-name-${group?.id ?? 'new'}`}
          name="name"
          defaultValue={group?.name ?? ''}
          placeholder="例：カラー"
          required
        />
      </Field>

      <details className="rounded-xl border border-line bg-ivory/30 p-4">
        <summary className="cursor-pointer text-sm font-semibold">詳細設定</summary>
        <p className="mt-2 text-xs text-muted">
          通常は変更不要です。表示順・必須・表示条件などを調整するときだけ使用します。
        </p>
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="表示順" htmlFor={`variant-group-sort-${group?.id ?? 'new'}`} errors={e.sort_order}>
              <Input
                id={`variant-group-sort-${group?.id ?? 'new'}`}
                name="sort_order"
                type="number"
                min={0}
                defaultValue={group?.sort_order ?? groups.length}
              />
            </Field>
            <div className="flex items-end">
              <Checkbox
                checked={customerVisible}
                onChange={(event) => setCustomerVisible(event.target.checked)}
                label="お客様に表示する"
              />
            </div>
          </div>

          <Field label="補足" htmlFor={`variant-group-note-${group?.id ?? 'new'}`} hint="お客様画面の選択項目の下に表示します" errors={e.note}>
            <Textarea
              id={`variant-group-note-${group?.id ?? 'new'}`}
              name="note"
              defaultValue={group?.note ?? ''}
              className="min-h-20"
              placeholder="任意"
            />
          </Field>

          <Checkbox
            name="is_required"
            defaultChecked={group?.is_required ?? true}
            label="この選択項目を必須にする"
          />

          <details className="rounded-xl border border-line bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold">表示条件（必要な場合だけ）</summary>
            <p className="mt-2 text-xs text-muted">
              例：「壁プラン」で「アクセント1面」を選んだときだけ「壁色」を表示する、といった条件です。
            </p>
            <div className="mt-4 space-y-4">
              <Field
                label="条件となる選択項目"
                htmlFor={`variant-group-parent-${group?.id ?? 'new'}`}
                errors={e.depends_on_group_code}
              >
                <Select
                  id={`variant-group-parent-${group?.id ?? 'new'}`}
                  name="depends_on_group_code"
                  value={parentCode}
                  onChange={(event) => setParentCode(event.target.value)}
                >
                  <option value="">条件なし</option>
                  {groups
                    .filter((row) => row.id !== group?.id)
                    .map((row) => (
                      <option key={row.id} value={row.code}>{row.name}</option>
                    ))}
                </Select>
              </Field>
              {parent && (
                <div>
                  <p className="label">この選択肢のとき表示</p>
                  {e.depends_on_choice_codes && <p className="mt-1 text-xs text-danger">{e.depends_on_choice_codes[0]}</p>}
                  {parentChoices.length ? (
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                      {parentChoices.map((choice) => (
                        <Checkbox
                          key={choice.id}
                          name="depends_on_choice_codes"
                          value={choice.code}
                          defaultChecked={(group?.depends_on_choice_codes ?? []).includes(choice.code)}
                          label={choice.name}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted">条件元の選択肢がまだありません。</p>
                  )}
                </div>
              )}
            </div>
          </details>
        </div>
      </details>

      <PendingButton pending={pending}>{isNew ? 'この選択項目を作成' : '選択項目を保存'}</PendingButton>
    </form>
  );
}

function ChoiceEditor({
  optionId,
  group,
  choice,
  choiceCount,
}: {
  optionId: string;
  group: OptionVariantGroup;
  choice: OptionVariantChoice | null;
  choiceCount: number;
}) {
  const [state, action, pending] = useActionState(saveVariantChoiceAction, initial);
  const [kind, setKind] = useState<OptionVariantChoice['kind']>(choice?.kind ?? 'option');
  const [customerVisible, setCustomerVisible] = useState(choice?.status !== 'draft');
  const e = state.fieldErrors ?? {};
  const isNew = !choice;

  const form = (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={choice?.id ?? ''} />
      <input type="hidden" name="option_id" value={optionId} />
      <input type="hidden" name="group_id" value={group.id} />
      <input type="hidden" name="status" value={customerVisible ? 'published' : 'draft'} />
      <ActionStatus state={state} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <Field label="選択肢" htmlFor={`variant-choice-name-${choice?.id ?? group.id}`} hint="例：ホワイト／ベージュ／ブラック" required errors={e.name}>
          <Input
            id={`variant-choice-name-${choice?.id ?? group.id}`}
            name="name"
            defaultValue={choice?.name ?? ''}
            placeholder="例：ホワイト"
            required
          />
        </Field>
        <Field label="追加金額（税別・円）" htmlFor={`variant-choice-price-${choice?.id ?? group.id}`} errors={e.extra_price}>
          <Input
            id={`variant-choice-price-${choice?.id ?? group.id}`}
            name="extra_price"
            type="number"
            min={0}
            step={100}
            defaultValue={choice?.extra_price ?? 0}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-start">
        <div className="space-y-4">
          <Field label="画像" htmlFor={`variant-choice-image-${choice?.id ?? group.id}`} hint="任意。色見本・柄・仕様が分かる画像を登録できます">
            <Input
              id={`variant-choice-image-${choice?.id ?? group.id}`}
              name="image_file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="py-2"
            />
            <input type="hidden" name="image_url" value={choice?.image_url ?? ''} />
          </Field>

          <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-line bg-ivory/30 px-4 py-3">
            <Checkbox
              checked={kind === 'standard'}
              disabled={kind === 'fixed'}
              onChange={(event) => setKind(event.target.checked ? 'standard' : 'option')}
              label="標準の選択肢にする"
            />
            <Checkbox
              checked={customerVisible}
              onChange={(event) => setCustomerVisible(event.target.checked)}
              label="お客様に表示する"
            />
            <Checkbox name="price_on_request" defaultChecked={choice?.price_on_request ?? false} label="別途見積" />
          </div>
        </div>

        <div className="w-28 max-w-full justify-self-start rounded-lg border border-line bg-sand/40 p-2 sm:justify-self-end">
          {choice?.image_url ? (
            <div className="relative aspect-square overflow-hidden rounded-md bg-white">
              <SmartImage src={choice.image_url} alt={choice.name} fill sizes="112px" className="object-contain" />
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-line bg-white px-2 text-center text-xs text-muted">
              <span>画像なし<br />文字カードで表示</span>
            </div>
          )}
        </div>
      </div>

      <details className="rounded-xl border border-line bg-ivory/30 p-4">
        <summary className="cursor-pointer text-sm font-semibold">詳細設定</summary>
        <p className="mt-2 text-xs text-muted">
          通常は変更不要です。固定仕様・表示順・補足を設定するときだけ使用します。
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="扱い" htmlFor={`variant-choice-kind-${choice?.id ?? group.id}`} errors={e.kind}>
            <Select
              id={`variant-choice-kind-${choice?.id ?? group.id}`}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as OptionVariantChoice['kind'])}
            >
              <option value="standard">標準</option>
              <option value="option">追加・変更可能</option>
              <option value="fixed">固定（変更不可）</option>
            </Select>
          </Field>
          <Field label="表示順" htmlFor={`variant-choice-sort-${choice?.id ?? group.id}`} errors={e.sort_order}>
            <Input
              id={`variant-choice-sort-${choice?.id ?? group.id}`}
              name="sort_order"
              type="number"
              min={0}
              defaultValue={choice?.sort_order ?? choiceCount}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="補足" htmlFor={`variant-choice-note-${choice?.id ?? group.id}`} errors={e.note}>
              <Input
                id={`variant-choice-note-${choice?.id ?? group.id}`}
                name="note"
                defaultValue={choice?.note ?? ''}
                placeholder="任意"
              />
            </Field>
          </div>
        </div>
      </details>

      <PendingButton pending={pending}>{isNew ? 'この選択肢を追加' : '選択肢を保存'}</PendingButton>
    </form>
  );

  if (isNew) return <div className="rounded-xl border border-dashed border-line bg-white p-4">{form}</div>;

  return (
    <details className="rounded-xl border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="font-semibold text-ink">{choice.name}</span>
          {choice.kind === 'standard' && <span className="ml-2 text-xs text-success">標準</span>}
          {!choice.price_on_request && choice.extra_price > 0 && (
            <span className="ml-2 text-xs text-ink-soft">+¥{choice.extra_price.toLocaleString('ja-JP')}</span>
          )}
          {choice.price_on_request && <span className="ml-2 text-xs text-warn">別途見積</span>}
        </span>
        <span className="shrink-0 text-xs text-muted">{choice.status === 'published' ? 'お客様に表示' : '非表示'}・編集</span>
      </summary>
      <div className="border-t border-line p-4">{form}</div>
    </details>
  );
}

export function OptionVariantManager({
  option,
  groups,
  choices,
}: {
  option: ProductOption;
  groups: OptionVariantGroup[];
  choices: OptionVariantChoice[];
}) {
  const orderedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

  return (
    <section id="customer-selection" className="space-y-6 scroll-mt-6">
      <div>
        <h2 className="text-xl font-semibold">お客様が選べる色・仕様</h2>
        <p className="mt-1 text-sm text-muted">
          商品詳細でお客様が選ぶ内容を登録します。例：「カラー」を作り、その中に「ホワイト」「ベージュ」などの選択肢を追加します。
        </p>
        <p className="mt-2 text-xs text-muted">
          画像は任意です。画像がない選択肢は文字カードで表示します。追加金額・標準・お客様表示も各選択肢でまとめて設定できます。
        </p>
      </div>

      {orderedGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white px-5 py-7">
          <p className="font-semibold">色・仕様はまだ登録されていません。</p>
          <p className="mt-2 text-sm text-muted">
            下の「＋ 色・仕様を追加」から、まず「カラー」「扉色」などお客様が選ぶ項目を作成してください。
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {orderedGroups.map((group) => {
            const groupChoices = choices
              .filter((choice) => choice.group_id === group.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
            return (
              <article key={group.id} className="card space-y-5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-muted">お客様が選ぶ項目</p>
                    <h3 className="mt-1 text-lg font-semibold">{group.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {groupChoices.length}選択肢・{group.status === 'published' ? 'お客様に表示' : '非表示'}
                    </p>
                  </div>
                  {group.depends_on_group_code && (
                    <span className="rounded-full bg-ivory px-2.5 py-1 text-xs text-ink-soft">
                      表示条件あり
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold">選択肢</h4>
                    <p className="mt-1 text-xs text-muted">
                      選択肢ごとに画像・追加金額・標準・お客様への表示を設定します。
                    </p>
                  </div>

                  {groupChoices.length > 0 ? (
                    groupChoices.map((choice) => (
                      <ChoiceEditor
                        key={choice.id}
                        optionId={option.id}
                        group={group}
                        choice={choice}
                        choiceCount={groupChoices.length}
                      />
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-line bg-ivory/20 px-4 py-5 text-sm text-muted">
                      選択肢がありません。「＋ 選択肢を追加」から最初の選択肢を登録してください。
                    </div>
                  )}

                  <details className="rounded-xl border border-dashed border-line bg-ivory/20">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">＋ 選択肢を追加</summary>
                    <div className="border-t border-line p-4">
                      <ChoiceEditor
                        optionId={option.id}
                        group={group}
                        choice={null}
                        choiceCount={groupChoices.length}
                      />
                    </div>
                  </details>
                </div>

                <details className="rounded-xl border border-line bg-ivory/30 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">この選択項目の名前・詳細設定</summary>
                  <div className="mt-4">
                    <GroupFields optionId={option.id} group={group} groups={groups} choices={choices} />
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">＋ 色・仕様を追加</summary>
        <p className="mt-2 text-xs text-muted">
          「カラー」「扉色」「浴槽色」など、お客様が選ぶ項目を追加します。
        </p>
        <div className="mt-5">
          <GroupFields optionId={option.id} group={null} groups={groups} choices={choices} />
        </div>
      </details>

      <p className="text-xs text-muted">
        使用済みの見積・保存仕様との整合を守るため、物理削除を行いません。不要になった項目や選択肢は「お客様に表示する」をOFFにして管理します。
      </p>
    </section>
  );
}

