'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { SmartImage } from '@/components/ui/smart-image';
import { ProductVariantGroupHeading } from '@/components/admin/product-variant-group-heading';
import { ProductSectionHeading } from '@/components/admin/product-section-heading';
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
        label="選択項目名"
        htmlFor={`variant-group-name-${group?.id ?? 'new'}`}
        hint="例：床／カウンター／アクセントパネル／浴槽"
        required
        errors={e.name}
      >
        <Input
          id={`variant-group-name-${group?.id ?? 'new'}`}
          name="name"
          defaultValue={group?.name ?? ''}
          placeholder="例：アクセントパネル"
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
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageUrl, setImageUrl] = useState(choice?.image_url ?? '');
  const [selectedImage, setSelectedImage] = useState<{ url: string; fileName: string } | null>(null);
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = selectedImage?.url ?? (imageRemoved ? null : imageUrl.trim() || null);
  useEffect(() => {
    return () => {
      if (selectedImage) URL.revokeObjectURL(selectedImage.url);
    };
  }, [selectedImage]);
  const e = state.fieldErrors ?? {};
  const isNew = !choice;

  const onImageUrlChange = (value: string) => {
    // URL とファイルの二重指定を避ける。行は既存の choice ID と紐づけたまま。
    if (imageInputRef.current) imageInputRef.current.value = '';
    setSelectedImage(null);
    setImageUrl(value);
    setImageRemoved(!value.trim() && Boolean(choice?.image_url));
    setFailedPreviewUrl(null);
  };

  const onImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedImage(null);
      if (!imageUrl.trim() && !imageRemoved) {
        setImageUrl(choice?.image_url ?? '');
      }
      return;
    }
    setImageUrl('');
    setImageRemoved(false);
    setFailedPreviewUrl(null);
    setSelectedImage({ url: URL.createObjectURL(file), fileName: file.name });
  };

  const clearImage = () => {
    setSelectedImage(null);
    setImageUrl('');
    setImageRemoved(true);
    setFailedPreviewUrl(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const restoreImage = () => {
    clearImage();
    setImageUrl(choice?.image_url ?? '');
    setImageRemoved(false);
  };

  const form = (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={choice?.id ?? ''} />
      <input type="hidden" name="option_id" value={optionId} />
      <input type="hidden" name="group_id" value={group.id} />
      <input type="hidden" name="status" value={customerVisible ? 'published' : 'draft'} />
      <ActionStatus state={state} />

      <div className="space-y-2 border-b border-line/70 pb-3" data-testid="draft-choice-unified-two-row">
        <div className="flex flex-wrap items-end gap-3" data-testid="draft-choice-main-row">
          <div className="min-w-0 flex-[1_1_12rem]">
            <Field label="選択肢名" htmlFor={`variant-choice-name-${choice?.id ?? group.id}`} hint="例：ホワイト／ベージュ／ブラック" required errors={e.name}>
              <Input
                id={`variant-choice-name-${choice?.id ?? group.id}`}
                name="name"
                defaultValue={choice?.name ?? ''}
                placeholder="例：ホワイト"
                required
              />
            </Field>
          </div>
          <div className="w-36 shrink-0">
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
          <div className="pb-2">
            <Checkbox
              checked={kind === 'standard'}
              disabled={kind === 'fixed'}
              onChange={(event) => setKind(event.target.checked ? 'standard' : 'option')}
              label="標準の選択肢にする"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="draft-choice-image-row">
          <label className="sr-only" htmlFor={`variant-choice-image-url-${choice?.id ?? group.id}`}>画像URL（任意）</label>
          <Input
            id={`variant-choice-image-url-${choice?.id ?? group.id}`}
            name="image_url"
            value={imageUrl}
            onChange={(event) => onImageUrlChange(event.target.value)}
            placeholder="画像URL（https://...）"
            className="min-w-0 max-w-[22rem] flex-[1_1_12rem]"
            disabled={pending}
          />
          <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-ink-soft hover:border-brown">
            ファイル選択
            <input
              ref={imageInputRef}
              id={`variant-choice-image-${choice?.id ?? group.id}`}
              name="image_file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              onChange={onImageChange}
              className="sr-only"
              disabled={pending}
            />
          </label>
          {previewUrl && (
            <span className="relative size-11 shrink-0 overflow-hidden rounded border border-line bg-white" title="画像プレビュー">
              {failedPreviewUrl === previewUrl ? (
                <span className="flex h-full items-center justify-center text-[9px] text-muted">表示不可</span>
              ) : (
                <SmartImage
                  src={previewUrl}
                  alt={`${choice?.name ?? '選択肢'}の画像プレビュー`}
                  fill
                  sizes="44px"
                  className="object-contain"
                  onError={() => setFailedPreviewUrl(previewUrl)}
                />
              )}
            </span>
          )}
          {(imageUrl.trim() || selectedImage) && (
            <button type="button" className="text-xs text-brown underline underline-offset-2" disabled={pending} onClick={clearImage}>
              解除
            </button>
          )}
          {imageRemoved && choice?.image_url && (
            <button type="button" className="text-xs text-brown underline underline-offset-2" disabled={pending} onClick={restoreImage}>
              元に戻す
            </button>
          )}
        </div>
        {selectedImage && <p className="break-all text-xs text-muted">選択中：{selectedImage.fileName}（保存すると反映）</p>}
        {imageRemoved && choice?.image_url && <p className="text-xs text-muted">保存すると画像の関連付けを解除します。</p>}
        <p className="text-xs text-muted">画像は任意（JPEG / PNG / WebP / AVIF、10MB以下）。メーカーの掲載条件を確認してください。</p>
      </div>

      <details className="rounded-xl border border-line bg-ivory/30 p-4">
        <summary className="cursor-pointer text-sm font-semibold">表示などの詳細設定</summary>
        <p className="mt-2 text-xs text-muted">
          お客様表示、別途見積、表示順などを調整するときだけ使用します。
        </p>
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-line bg-white px-4 py-3">
            <Checkbox
              checked={customerVisible}
              onChange={(event) => setCustomerVisible(event.target.checked)}
              label="お客様に表示する"
            />
            <Checkbox name="price_on_request" defaultChecked={choice?.price_on_request ?? false} label="別途見積" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
        <span className="shrink-0 text-xs text-muted">{choice.status === 'published' ? '表示' : '非表示'}・編集</span>
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
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const orderedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));

  return (
    <section id="customer-selection" className="space-y-5 scroll-mt-6">
      <ProductSectionHeading
        label="5. お客様選択"
        description="お客様が選べる部位・色・仕様などがある場合だけ設定します。"
        level="h2"
      />

      <div className="rounded-xl border border-line bg-white p-4 sm:p-5" data-testid="variant-quick-add" aria-label="選択項目を追加">
        <p className="text-sm font-semibold">選択項目を追加</p>
        <p className="mt-1 text-xs text-muted">例：床、カウンター、アクセントパネル、浴槽など</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setNewGroupOpen(true)}>
            ＋ 選択項目を追加
          </button>
        </div>

        {newGroupOpen && (
          <div className="mt-4 rounded-xl border border-dashed border-line bg-ivory/20 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">選択項目を追加</p>
              <button type="button" className="text-xs text-muted underline underline-offset-4" onClick={() => setNewGroupOpen(false)}>
                閉じる
              </button>
            </div>
            <GroupFields
              optionId={option.id}
              group={null}
              groups={groups}
              choices={choices}
            />
          </div>
        )}
      </div>

      {orderedGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white px-5 py-5 text-sm text-muted">
          お客様が選ぶ項目はまだありません。必要な場合だけ上の「選択項目を追加」から登録してください。
        </div>
      ) : (
        <div className="space-y-4">
          {orderedGroups.map((group) => {
            const groupChoices = choices
              .filter((choice) => choice.group_id === group.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
            const firstChoice = groupChoices.length === 0;
            return (
              <article key={group.id} className="card space-y-4 p-4 sm:p-5">
                <ProductVariantGroupHeading group={group} choiceCount={groupChoices.length} />

                <div className="space-y-2">
                  {groupChoices.map((choice) => (
                    <ChoiceEditor
                      key={`${choice.id}:${choice.image_url ?? ''}`}
                      optionId={option.id}
                      group={group}
                      choice={choice}
                      choiceCount={groupChoices.length}
                    />
                  ))}

                  <details className="rounded-xl border border-dashed border-line bg-ivory/20" open={firstChoice}>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                      {firstChoice ? '最初の選択肢を追加' : '＋ 選択肢を追加'}
                    </summary>
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
                  <summary className="cursor-pointer text-sm font-semibold">この項目の名前・詳細設定</summary>
                  <div className="mt-4">
                    <GroupFields optionId={option.id} group={group} groups={groups} choices={choices} />
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted">
        使用済みの見積・保存仕様との整合を守るため、物理削除は行いません。不要になった項目や選択肢は「お客様に表示する」をOFFにして管理します。
      </p>
    </section>
  );
}
