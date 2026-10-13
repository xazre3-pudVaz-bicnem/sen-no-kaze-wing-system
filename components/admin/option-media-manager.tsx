'use client';

import { useActionState, useState, type ChangeEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  addOptionImageAction,
  deleteOptionImageAction,
  deleteOptionManufacturerDocumentAction,
  updateOptionImageAction,
  uploadOptionManufacturerDocumentAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import type { OptionImage, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';

const initial: AdminFormState = { ok: false };

function ActionStatus({ state }: { state: AdminFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.fieldErrors?._form) return <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function PendingButton({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Spinner />}
      {children}
    </Button>
  );
}

function OptionImageEditor({ optionId, image }: { optionId: string; image: OptionImage }) {
  const [state, action, pending] = useActionState(updateOptionImageAction, initial);
  return (
    <li className="card overflow-hidden">
      <div className="relative aspect-[4/3] bg-sand">
        <SmartImage src={image.url} alt={image.alt} fill sizes="(min-width: 1024px) 16rem, 45vw" className="object-contain" />
      </div>
      <div className="space-y-3 p-3">
        <ActionStatus state={state} />
        <form action={action} className="space-y-3">
          <input type="hidden" name="id" value={image.id} />
          <input type="hidden" name="option_id" value={optionId} />
          <input type="hidden" name="alt" value={image.alt} />
          <Field label="画像の説明" htmlFor={`caption-${image.id}`} errors={state.fieldErrors?.caption}>
            <Input id={`caption-${image.id}`} name="caption" defaultValue={image.caption ?? ''} placeholder="例：水栓側／収納部分" />
          </Field>
          <Field label="表示順" htmlFor={`sort-${image.id}`} errors={state.fieldErrors?.sort_order}>
            <Input id={`sort-${image.id}`} name="sort_order" type="number" min={0} defaultValue={image.sort_order} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <PendingButton pending={pending}>表示設定を更新</PendingButton>
          </div>
        </form>
        <form action={deleteOptionImageAction}>
          <input type="hidden" name="id" value={image.id} />
          <input type="hidden" name="option_id" value={optionId} />
          <button type="submit" className="text-xs text-danger underline underline-offset-4 hover:no-underline">
            このサブ画像を削除
          </button>
        </form>
      </div>
    </li>
  );
}

export function OptionMediaManager({ option }: { option: ProductOption }) {
  const router = useRouter();
  const { saveIfDirty } = useOptionRegistrationSave();
  const images = option.gallery_images ?? [];
  const [imageState, setImageState] = useState<AdminFormState>(initial);
  const [docState, setDocState] = useState<AdminFormState>(initial);
  const [imagePending, setImagePending] = useState(false);
  const [docPending, setDocPending] = useState(false);

  const handleSubImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length || imagePending) return;

    setImagePending(true);
    setImageState(initial);
    let savedCount = 0;

    try {
      const mainSaved = await saveIfDirty();
      if (!mainSaved) {
        setImageState({ ok: false, error: '商品情報を保存できなかったため、サブ画像の登録を中止しました。' });
        return;
      }

      for (const [index, file] of files.entries()) {
        const formData = new FormData();
        formData.set('option_id', option.id);
        formData.set('file', file);
        formData.set('caption', '');
        formData.set('sort_order', String(images.length + index));

        const result = await addOptionImageAction(initial, formData);
        if (!result.ok) {
          if (savedCount > 0) {
            const detail = result.error ?? result.fieldErrors?.file?.[0] ?? '残りの画像を保存できませんでした。';
            setImageState({
              ok: false,
              error: `${savedCount}枚は保存済みです。続く画像の保存に失敗しました。 ${detail}`,
            });
            router.refresh();
          } else {
            setImageState(result);
          }
          return;
        }
        savedCount += 1;
      }

      setImageState({ ok: true, message: `${savedCount}枚のサブ画像を保存しました。` });
      router.refresh();
    } catch {
      setImageState({
        ok: false,
        error: savedCount > 0
          ? `${savedCount}枚は保存済みです。続く画像の保存中にエラーが発生しました。`
          : 'サブ画像の保存中にエラーが発生しました。',
      });
      if (savedCount > 0) router.refresh();
    } finally {
      input.value = '';
      setImagePending(false);
    }
  };

  const handleManufacturerDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || docPending) return;

    setDocPending(true);
    setDocState(initial);

    try {
      const mainSaved = await saveIfDirty();
      if (!mainSaved) {
        setDocState({ ok: false, error: '商品情報を保存できなかったため、メーカー資料の登録を中止しました。' });
        return;
      }

      const formData = new FormData();
      formData.set('option_id', option.id);
      formData.set('file', file);
      const result = await uploadOptionManufacturerDocumentAction(initial, formData);
      setDocState(result);
      if (result.ok) router.refresh();
    } catch {
      setDocState({ ok: false, error: 'メーカー資料PDFの保存中にエラーが発生しました。' });
    } finally {
      input.value = '';
      setDocPending(false);
    }
  };

  return (
    <div id="product-media" className="space-y-6">
      <section id="product-sub-images" className="card space-y-5 p-5 sm:p-6 scroll-mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">サブ画像 <span className="text-xs font-normal text-muted">任意</span></h2>
            <p className="mt-1 text-xs text-muted">商品詳細で見せたい追加画像がある場合だけ登録します。</p>
          </div>
          <span className="rounded-full bg-ivory px-3 py-1 text-xs font-semibold text-ink-soft">{images.length}枚</span>
        </div>

        {images.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <OptionImageEditor key={image.id} optionId={option.id} image={image} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-muted">
            サブ画像はまだ登録されていません。
          </div>
        )}

        <div className="border-t border-line pt-5">
          <ActionStatus state={imageState} />
          <div className="mt-3">
            <Field
              label="サブ画像ファイル"
              htmlFor="option-sub-image"
              hint="複数選択可・1枚10MBまで。選択すると自動保存します。"
              errors={imageState.fieldErrors?.file}
            >
              <Input
                id="option-sub-image"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="py-2"
                multiple
                disabled={imagePending}
                onChange={(event) => void handleSubImages(event)}
              />
            </Field>
            {imagePending && (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted">
                <Spinner />
                サブ画像を保存しています…
              </p>
            )}
          </div>
        </div>
      </section>

      <section id="manufacturer-documents" className="card space-y-5 p-5 sm:p-6 scroll-mt-6" data-testid="manufacturer-document-section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">4. メーカー資料</h2>
              <span className="rounded-full bg-ivory px-2.5 py-1 text-[0.7rem] font-semibold text-brown">原則登録</span>
            </div>
            <p className="mt-1 text-sm text-muted">
              商品の仕様・機能・色・柄などを確認するための資料です。原則1商品につき1PDFを登録します。
            </p>
          </div>
          <span
            data-testid="manufacturer-document-status"
            data-registered={option.manufacturer_document_url ? 'true' : 'false'}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${option.manufacturer_document_url ? 'bg-[#eaf6f1] text-[#245a48]' : 'bg-[#fff8e8] text-[#7c5a18]'}`}
          >
            {option.manufacturer_document_url ? '登録済み' : '未登録'}
          </span>
        </div>

        <p className="text-xs leading-5 text-ink-soft">
          メーカー資料が用意されていない商品は未登録のまま進められます。その場合は登録前チェックで確認事項として表示します。
        </p>

        {option.manufacturer_document_url ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ivory/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">メーカー資料PDF 登録済み</p>
              <a
                href={option.manufacturer_document_url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-brown underline underline-offset-4"
              >
                現在の資料を確認
              </a>
            </div>
            <form action={deleteOptionManufacturerDocumentAction}>
              <input type="hidden" name="option_id" value={option.id} />
              <button type="submit" className="text-xs text-danger underline underline-offset-4 hover:no-underline">
                登録を解除
              </button>
            </form>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-4 py-4 text-sm text-muted">
            メーカー資料PDFはまだ登録されていません。
          </div>
        )}

        <ActionStatus state={docState} />
        <Field
          label={option.manufacturer_document_url ? 'メーカー資料PDFを差し替える' : 'メーカー資料PDFを登録'}
          htmlFor="manufacturer-document"
          hint="PDFのみ・20MBまで。ファイルを選択すると自動保存します。"
          errors={docState.fieldErrors?.file}
        >
          <Input
            id="manufacturer-document"
            name="file"
            type="file"
            accept="application/pdf,.pdf"
            className="py-2"
            disabled={docPending}
            onChange={(event) => void handleManufacturerDocument(event)}
          />
        </Field>
        {docPending && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Spinner />
            メーカー資料PDFを保存しています…
          </p>
        )}
      </section>
    </div>
  );
}