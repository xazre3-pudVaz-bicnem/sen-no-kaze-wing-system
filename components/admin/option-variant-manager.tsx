'use client';

import { useActionState, useState } from 'react';
import {
  saveVariantChoiceAction,
  saveVariantGroupAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import {
  VARIANT_KIND_LABELS,
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
  const e = state.fieldErrors ?? {};
  const parent = groups.find((row) => row.code === parentCode && row.id !== group?.id) ?? null;
  const parentChoices = parent ? choices.filter((choice) => choice.group_id === parent.id) : [];
  const isNew = !group;

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={group?.id ?? ''} />
      <input type="hidden" name="option_id" value={optionId} />
      <ActionStatus state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="選択項目名" htmlFor={`variant-group-name-${group?.id ?? 'new'}`} required errors={e.name}>
          <Input
            id={`variant-group-name-${group?.id ?? 'new'}`}
            name="name"
            defaultValue={group?.name ?? ''}
            placeholder="例：壁色／扉色／カラー"
            required
          />
        </Field>
        <Field
          label="コード"
          htmlFor={`variant-group-code-${group?.id ?? 'new'}`}
          required
          hint={isNew ? '英小文字・数字・ハイフン。登録後は変更できません' : '登録後は変更できません'}
          errors={e.code}
        >
          {isNew ? (
            <Input
              id="variant-group-code-new"
              name="code"
              placeholder="例：wall-color"
              pattern="[a-z0-9-]+"
              required
            />
          ) : (
            <>
              <input type="hidden" name="code" value={group.code} />
              <Input id={`variant-group-code-${group.id}`} value={group.code} readOnly />
            </>
          )}
        </Field>
        <Field label="表示順" htmlFor={`variant-group-sort-${group?.id ?? 'new'}`} errors={e.sort_order}>
          <Input
            id={`variant-group-sort-${group?.id ?? 'new'}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={group?.sort_order ?? groups.length}
          />
        </Field>
        <Field label="公開状態" htmlFor={`variant-group-status-${group?.id ?? 'new'}`} errors={e.status}>
          <Select
            id={`variant-group-status-${group?.id ?? 'new'}`}
            name="status"
            defaultValue={group?.status ?? 'published'}
          >
            <option value="published">公開</option>
            <option value="draft">非公開</option>
          </Select>
        </Field>
      </div>

      <Field label="補足" htmlFor={`variant-group-note-${group?.id ?? 'new'}`} hint="お客様画面の選択項目の下に表示します" errors={e.note}>
        <Textarea
          id={`variant-group-note-${group?.id ?? 'new'}`}
          name="note"
          defaultValue={group?.note ?? ''}
          className="min-h-20"
          placeholder="例：アクセント壁を選んだ場合だけ選択できます"
        />
      </Field>

      <Checkbox
        name="is_required"
        defaultChecked={group?.is_required ?? true}
        label="この選択項目を必須にする"
      />

      <details className="rounded-xl border border-line bg-ivory/40 p-4">
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

      <PendingButton pending={pending}>{isNew ? '選択項目を追加' : '選択項目を更新'}</PendingButton>
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
  const e = state.fieldErrors ?? {};
  const isNew = !choice;

  const form = (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={choice?.id ?? ''} />
      <input type="hidden" name="option_id" value={optionId} />
      <input type="hidden" name="group_id" value={group.id} />
      <ActionStatus state={state} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="選択肢名" htmlFor={`variant-choice-name-${choice?.id ?? group.id}`} required errors={e.name}>
          <Input
            id={`variant-choice-name-${choice?.id ?? group.id}`}
            name="name"
            defaultValue={choice?.name ?? ''}
            placeholder="例：ホワイト"
            required
          />
        </Field>
        <Field
          label="コード"
          htmlFor={`variant-choice-code-${choice?.id ?? group.id}`}
          required
          hint={isNew ? '登録後は変更できません' : '登録後は変更できません'}
          errors={e.code}
        >
          {isNew ? (
            <Input
              id={`variant-choice-code-new-${group.id}`}
              name="code"
              placeholder="例：white"
              pattern="[a-z0-9-]+"
              required
            />
          ) : (
            <>
              <input type="hidden" name="code" value={choice.code} />
              <Input id={`variant-choice-code-${choice.id}`} value={choice.code} readOnly />
            </>
          )}
        </Field>
        <Field label="区分" htmlFor={`variant-choice-kind-${choice?.id ?? group.id}`} errors={e.kind}>
          <Select id={`variant-choice-kind-${choice?.id ?? group.id}`} name="kind" defaultValue={choice?.kind ?? 'option'}>
            <option value="standard">標準</option>
            <option value="option">追加</option>
            <option value="fixed">固定（変更不可）</option>
          </Select>
        </Field>
        <input type="hidden" name="extra_price" value={choice?.extra_price ?? 0} />
        <Field label="表示順" htmlFor={`variant-choice-sort-${choice?.id ?? group.id}`} errors={e.sort_order}>
          <Input
            id={`variant-choice-sort-${choice?.id ?? group.id}`}
            name="sort_order"
            type="number"
            min={0}
            defaultValue={choice?.sort_order ?? choiceCount}
          />
        </Field>
        <Field label="公開状態" htmlFor={`variant-choice-status-${choice?.id ?? group.id}`} errors={e.status}>
          <Select
            id={`variant-choice-status-${choice?.id ?? group.id}`}
            name="status"
            defaultValue={choice?.status ?? 'published'}
          >
            <option value="published">公開</option>
            <option value="draft">非公開</option>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem]">
        <div className="space-y-4">
          <Field label="画像" htmlFor={`variant-choice-image-${choice?.id ?? group.id}`} hint="任意。色見本・柄・仕様画像など">
            <Input
              id={`variant-choice-image-${choice?.id ?? group.id}`}
              name="image_file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="py-2"
            />
            <input type="hidden" name="image_url" value={choice?.image_url ?? ''} />
          </Field>
          <Field label="補足" htmlFor={`variant-choice-note-${choice?.id ?? group.id}`} errors={e.note}>
            <Input
              id={`variant-choice-note-${choice?.id ?? group.id}`}
              name="note"
              defaultValue={choice?.note ?? ''}
              placeholder="任意"
            />
          </Field>
          {choice?.price_on_request && <input type="hidden" name="price_on_request" value="on" />}
          <p className="text-xs text-muted">追加金額・別途見積の設定は STEP 5「価格設定」で行います。</p>
        </div>
        <div className="rounded-lg border border-line bg-sand/40 p-2">
          {choice?.image_url ? (
            <div className="relative aspect-square overflow-hidden rounded-md bg-white">
              <SmartImage src={choice.image_url} alt={choice.name} fill sizes="160px" className="object-contain" />
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-line bg-white px-2 text-center text-xs text-muted">
              <span>画像なし<br />文字カードで表示</span>
            </div>
          )}
        </div>
      </div>

      <PendingButton pending={pending}>{isNew ? '選択肢を追加' : '選択肢を更新'}</PendingButton>
    </form>
  );

  if (isNew) return <div className="rounded-xl border border-dashed border-line bg-white p-4">{form}</div>;

  return (
    <details className="rounded-xl border border-line bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="font-semibold text-ink">{choice.name}</span>
          <span className="ml-2 text-xs text-muted">{VARIANT_KIND_LABELS[choice.kind]}</span>
          {!choice.price_on_request && choice.extra_price > 0 && (
            <span className="ml-2 text-xs text-ink-soft">+¥{choice.extra_price.toLocaleString('ja-JP')}</span>
          )}
          {choice.price_on_request && <span className="ml-2 text-xs text-warn">別途見積</span>}
        </span>
        <span className="shrink-0 text-xs text-muted">{choice.status === 'published' ? '公開' : '非公開'}・編集</span>
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
        <h2 className="text-xl font-semibold">STEP 4 お客様選択</h2>
        <p className="mt-1 text-sm text-muted">
          お客様が商品詳細で選ぶ色・柄・仕様を管理します。画像は任意で、画像を登録しない選択肢は文字カードとして表示できます。
        </p>
        <p className="mt-2 text-xs text-muted">
          使用済みの見積・保存仕様との整合を守るため、この画面では物理削除を行いません。不要になった項目・選択肢は「非公開」にしてください。
        </p>
      </div>

      {orderedGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white px-5 py-8 text-center text-sm text-muted">
          色・仕様はまだ登録されていません。下の「選択項目を追加」から登録できます。
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
                    <h3 className="font-semibold">{group.name}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {group.code}・{groupChoices.length}選択肢・{group.status === 'published' ? '公開' : '非公開'}
                    </p>
                  </div>
                  {group.depends_on_group_code && (
                    <span className="rounded-full bg-ivory px-2.5 py-1 text-xs text-ink-soft">
                      表示条件あり
                    </span>
                  )}
                </div>

                <details className="rounded-xl border border-line bg-ivory/30 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">選択項目の設定を編集</summary>
                  <div className="mt-4">
                    <GroupFields optionId={option.id} group={group} groups={groups} choices={choices} />
                  </div>
                </details>

                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold">選択肢</h4>
                    <p className="mt-1 text-xs text-muted">標準・追加・固定、画像または文字カード、公開状態を設定します。追加金額は STEP 5 で設定します。</p>
                  </div>
                  {groupChoices.map((choice) => (
                    <ChoiceEditor
                      key={choice.id}
                      optionId={option.id}
                      group={group}
                      choice={choice}
                      choiceCount={groupChoices.length}
                    />
                  ))}
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
              </article>
            );
          })}
        </div>
      )}

      <details className="card p-5">
        <summary className="cursor-pointer font-semibold">＋ 選択項目を追加</summary>
        <p className="mt-2 text-xs text-muted">
          「色」「壁プラン」「扉色」など、お客様が選ぶ単位を追加します。
        </p>
        <div className="mt-5">
          <GroupFields optionId={option.id} group={null} groups={groups} choices={choices} />
        </div>
      </details>
    </section>
  );
}
function ChoicePriceEditor({
  optionId,
  group,
  choice,
}: {
  optionId: string;
  group: OptionVariantGroup;
  choice: OptionVariantChoice;
}) {
  const [state, action, pending] = useActionState(saveVariantChoiceAction, initial);
  const e = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4 rounded-xl border border-line bg-white p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" noValidate>
      <input type="hidden" name="id" value={choice.id} />
      <input type="hidden" name="option_id" value={optionId} />
      <input type="hidden" name="group_id" value={group.id} />
      <input type="hidden" name="name" value={choice.name} />
      <input type="hidden" name="code" value={choice.code} />
      <input type="hidden" name="kind" value={choice.kind} />
      <input type="hidden" name="sort_order" value={choice.sort_order} />
      <input type="hidden" name="status" value={choice.status} />
      <input type="hidden" name="image_url" value={choice.image_url ?? ''} />
      <input type="hidden" name="note" value={choice.note ?? ''} />

      <div>
        <ActionStatus state={state} />
        <p className="font-semibold text-ink">{choice.name}</p>
        <p className="mt-1 text-xs text-muted">{group.name}・{VARIANT_KIND_LABELS[choice.kind]}</p>
      </div>
      <div className="space-y-2">
        <Field label="追加金額（税別・円）" htmlFor={`variant-price-only-${choice.id}`} errors={e.extra_price}>
          <Input
            id={`variant-price-only-${choice.id}`}
            name="extra_price"
            type="number"
            min={0}
            step={100}
            defaultValue={choice.extra_price}
          />
        </Field>
        <Checkbox name="price_on_request" defaultChecked={choice.price_on_request} label="別途見積" />
      </div>
      <PendingButton pending={pending}>保存</PendingButton>
    </form>
  );
}

export function OptionVariantPricing({
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
    <section id="variant-pricing" className="card space-y-5 p-5 sm:p-6 scroll-mt-6">
      <div>
        <h2 className="text-lg font-semibold">色・仕様ごとの追加金額</h2>
        <p className="mt-1 text-sm text-muted">
          STEP 4 で登録した文字カード・画像カードごとの追加金額を設定します。0円の標準選択肢も明示しておくと確認しやすくなります。
        </p>
      </div>

      {choices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-4 py-7 text-center text-sm text-muted">
          価格を設定する選択肢がありません。先に STEP 4「お客様選択」で色・仕様を登録してください。
        </div>
      ) : (
        <div className="space-y-5">
          {orderedGroups.map((group) => {
            const rows = choices
              .filter((choice) => choice.group_id === group.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
            if (rows.length === 0) return null;
            return (
              <div key={group.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{group.name}</h3>
                  <span className="text-xs text-muted">{rows.length}選択肢</span>
                </div>
                <div className="space-y-2">
                  {rows.map((choice) => (
                    <ChoicePriceEditor key={choice.id} optionId={option.id} group={group} choice={choice} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

