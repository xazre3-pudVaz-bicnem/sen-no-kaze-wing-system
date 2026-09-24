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
    <section id="product-media" className="card space-y-6 p-5 sm:p-6 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">サブ画像・メーカー資料</h2>
          <p className="mt-1 text-sm text-muted">
            商品画像とメーカーPDFを同じ商品情報画面で確認できます。メーカーPDFは1商品につき1ファイルを基本とし、PDF内の複数ページはそのまま利用できます。
          </p>
        </div>
        <div className="rounded-lg border border-line bg-ivory/50 px-3 py-2 text-xs text-ink-soft">
          サブ画像 {images.length}枚 ／ メーカー資料 {option.manufacturer_document_url ? '登録済み' : '未登録'}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">商品画像</p>
          <p className="mt-1 text-xs text-muted">メイン画像＋必要なサブ画像。商品の見た目を確認するための資料です。</p>
          <p className="mt-3 text-xs text-ink-soft">メイン画像：{option.image_url ? '登録済み' : '未登録'} ／ サブ画像：{images.length}枚</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">メーカー資料</p>
          <p className="mt-1 text-xs text-muted">仕様・固定構成・標準装備などを確認するPDFです。自動解析は必須ではなく、必要事項は手入力で補えます。</p>
          {option.manufacturer_document_url ? (
            <a href={option.manufacturer_document_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-semibold text-brown underline underline-offset-4">
              登録済みPDFを確認
            </a>
          ) : (
            <p className="mt-3 text-xs text-muted">PDFはまだ登録されていません。</p>
          )}
        </div>
      </div>

      <div className="space-y-6">
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
          <div className="mt-3">
            <Field
              label="サブ画像ファイル"
              htmlFor="option-sub-image"
              hint="複数選択可・1枚10MBまで。選択すると自動で保存します。説明と表示順は保存後に各画像から変更できます。"
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
        <div>
          <Field
            label={option.manufacturer_document_url ? 'メーカー資料PDFを差し替える' : 'メーカー資料PDFを登録'}
            htmlFor="manufacturer-document"
            hint="PDFのみ・20MBまで。ファイルを選択すると自動で保存します。"
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
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Spinner />
              メーカー資料PDFを保存しています…
            </p>
          )}
        </div>
      </div>
      </div>
    </section>
  );
}
