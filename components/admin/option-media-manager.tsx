'use client';

import { useActionState, type ReactNode } from 'react';
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
  const images = option.gallery_images ?? [];
  const [imageState, imageAction, imagePending] = useActionState(addOptionImageAction, initial);
  const [docState, docAction, docPending] = useActionState(uploadOptionManufacturerDocumentAction, initial);

  return (
    <details id="product-media" className="card overflow-hidden">
      <summary className="cursor-pointer list-none px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">画像・メーカー資料</h2>
            <p className="mt-1 text-xs text-muted">サブ画像 {images.length}枚・メーカー資料 {option.manufacturer_document_url ? '登録済み' : '未登録'}</p>
          </div>
          <span className="text-xs font-semibold text-brown">開いて編集</span>
        </div>
      </summary>

      <div className="space-y-6 border-t border-line p-5 sm:p-6">
      <div className="space-y-5">
        <div>
          <h3 className="font-semibold">サブ画像</h3>
          <p className="mt-1 text-xs text-muted">
            メイン画像は上の「商品情報」で管理します。ここでは商品詳細に追加する画像を登録します。
          </p>
        </div>

        {images.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image) => (
              <OptionImageEditor key={image.id} optionId={option.id} image={image} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-muted">
            サブ画像はまだ登録されていません。
          </div>
        )}

        <div className="border-t border-line pt-5">
          <ActionStatus state={imageState} />
          <form action={imageAction} className="mt-3 grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="option_id" value={option.id} />
            <Field label="サブ画像ファイル" htmlFor="option-sub-image" required errors={imageState.fieldErrors?.file}>
              <Input id="option-sub-image" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="py-2" required />
            </Field>
            <Field label="画像の説明" htmlFor="option-sub-caption" hint="任意。例：水栓側／収納部分" errors={imageState.fieldErrors?.caption}>
              <Input id="option-sub-caption" name="caption" />
            </Field>
            <Field label="表示順" htmlFor="option-sub-sort" errors={imageState.fieldErrors?.sort_order}>
              <Input id="option-sub-sort" name="sort_order" type="number" min={0} defaultValue={images.length} />
            </Field>
            <div className="flex items-end">
              <PendingButton pending={imagePending}>サブ画像を追加</PendingButton>
            </div>
          </form>
        </div>
      </div>

      <div className="space-y-5 border-t border-line pt-6">
        <div>
          <h3 className="font-semibold">メーカー資料</h3>
          <p className="mt-1 text-xs text-muted">
            1商品につき1つのPDFを登録します。登録したPDFは自社Storageに保存し、商品詳細の「メーカー資料」タブで表示します。
          </p>
        </div>

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
            メーカー資料は未登録です。
          </div>
        )}

        <ActionStatus state={docState} />
        <form action={docAction} className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="option_id" value={option.id} />
          <Field
            label={option.manufacturer_document_url ? 'メーカー資料PDFを差し替える' : 'メーカー資料PDFを登録'}
            htmlFor="manufacturer-document"
            hint="PDFのみ・20MBまで"
            errors={docState.fieldErrors?.file}
          >
            <Input id="manufacturer-document" name="file" type="file" accept="application/pdf,.pdf" className="py-2" required />
          </Field>
          <PendingButton pending={docPending}>{option.manufacturer_document_url ? '資料を差し替える' : '資料を登録'}</PendingButton>
        </form>
      </div>
      </div>
    </details>
  );
}
