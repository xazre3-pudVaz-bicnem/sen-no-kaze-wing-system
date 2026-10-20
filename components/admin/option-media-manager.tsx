'use client';

import { useActionState, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  addOptionImageAction,
  deleteOptionImageAction,
  deleteOptionManufacturerDocumentAction,
  updateOptionImageAction,
  uploadOptionManufacturerDocumentAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import {
  addOptionImageFromUrlAction,
  uploadOptionManufacturerDocumentFromUrlAction,
} from '@/lib/actions/product-media-url';
import type { OptionImage, ProductOption } from '@/lib/domain/types';
import { SmartImage } from '@/components/ui/smart-image';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';

const initial: AdminFormState = { ok: false };

type ExpandedImage = { src: string; alt: string };

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

function OptionImageEditor({
  optionId,
  image,
  onPreview,
}: {
  optionId: string;
  image: OptionImage;
  onPreview: (preview: ExpandedImage) => void;
}) {
  const [state, action, pending] = useActionState(updateOptionImageAction, initial);
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-white">
      <button
        type="button"
        className="relative block h-32 w-full cursor-zoom-in bg-sand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:h-36"
        aria-label={`${image.caption?.trim() || '追加画像'}を拡大表示`}
        onClick={() => onPreview({ src: image.url, alt: image.alt || image.caption?.trim() || '追加画像' })}
      >
        <SmartImage src={image.url} alt={image.alt} fill sizes="160px" className="object-contain" />
      </button>
      <div className="space-y-2 p-3">
        <ActionStatus state={state} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-ink">{image.caption?.trim() || '追加画像'}</p>
            <p className="mt-0.5 text-[0.7rem] text-muted">表示順 {image.sort_order}</p>
          </div>
          <form action={deleteOptionImageAction}>
            <input type="hidden" name="id" value={image.id} />
            <input type="hidden" name="option_id" value={optionId} />
            <button type="submit" className="shrink-0 text-xs text-danger underline underline-offset-4 hover:no-underline">
              削除
            </button>
          </form>
        </div>
        <details className="rounded-lg border border-line bg-ivory/35 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold text-ink-soft">表示設定</summary>
          <form action={action} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={image.id} />
            <input type="hidden" name="option_id" value={optionId} />
            <input type="hidden" name="alt" value={image.alt} />
            <Field label="画像の説明" htmlFor={`caption-${image.id}`} errors={state.fieldErrors?.caption}>
              <Input id={`caption-${image.id}`} name="caption" defaultValue={image.caption ?? ''} placeholder="例：水栓側／収納部分" />
            </Field>
            <Field label="表示順" htmlFor={`sort-${image.id}`} errors={state.fieldErrors?.sort_order}>
              <Input id={`sort-${image.id}`} name="sort_order" type="number" min={0} defaultValue={image.sort_order} />
            </Field>
            <PendingButton pending={pending}>表示設定を更新</PendingButton>
          </form>
        </details>
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
  const [imageUrl, setImageUrl] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfReplaceOpen, setPdfReplaceOpen] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImage | null>(null);
  const imageCloseButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const section = document.getElementById('product-main-media');
    const fileInput = section?.querySelector<HTMLInputElement>('input[name="image_file"]');
    const urlInput = section?.querySelector<HTMLInputElement>('input[name="image_url"]');
    if (!section || !fileInput || !urlInput) return;

    const grid = fileInput.closest('.grid');
    if (!(grid instanceof HTMLElement)) return;

    const preview = document.createElement('div');
    preview.dataset.mainImageSelectionPreview = 'true';
    preview.className = 'mt-4 flex flex-wrap items-start gap-3';

    const frame = document.createElement('button');
    frame.type = 'button';
    frame.disabled = true;
    frame.setAttribute('aria-label', 'メイン画像を拡大表示');
    frame.className = 'flex h-40 w-56 items-center justify-center overflow-hidden rounded-lg border border-line bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-default';

    const image = document.createElement('img');
    image.alt = 'メイン画像プレビュー';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.className = 'max-h-full max-w-full object-contain';

    const empty = document.createElement('p');
    empty.className = 'px-3 text-center text-xs text-muted';
    empty.textContent = 'メイン画像はまだ登録されていません。';

    const controls = document.createElement('div');
    controls.className = 'space-y-2 pt-1';

    const label = document.createElement('p');
    label.className = 'text-xs font-semibold text-ink';
    label.textContent = 'メイン画像プレビュー';

    const note = document.createElement('p');
    note.className = 'max-w-64 text-xs leading-5 text-muted';
    note.textContent = '選択した画像を確認できます。間違えた場合は保存前に選択を解除できます。';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'text-xs text-brown underline underline-offset-4 hover:no-underline';
    clearButton.textContent = '選択を解除';
    clearButton.hidden = true;

    frame.append(empty, image);
    controls.append(label, note, clearButton);
    preview.append(frame, controls);
    grid.insertAdjacentElement('beforebegin', preview);

    let objectUrl: string | null = null;

    const revokeObjectUrl = () => {
      if (!objectUrl) return;
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };

    const renderPreview = (url: string, isLocalSelection: boolean) => {
      const normalized = url.trim();
      image.hidden = !normalized;
      empty.hidden = Boolean(normalized);
      clearButton.hidden = !isLocalSelection;
      frame.disabled = !normalized;
      frame.classList.toggle('cursor-zoom-in', Boolean(normalized));
      if (normalized) image.src = normalized;
      else image.removeAttribute('src');
    };

    const handleFileChange = () => {
      revokeObjectUrl();
      const file = fileInput.files?.[0];
      if (file) {
        objectUrl = URL.createObjectURL(file);
        renderPreview(objectUrl, true);
      } else {
        renderPreview(urlInput.value, false);
      }
    };

    const handleUrlInput = () => {
      if (!fileInput.files?.length) renderPreview(urlInput.value, false);
    };

    const handleClearSelection = () => {
      fileInput.value = '';
      revokeObjectUrl();
      renderPreview(urlInput.value, false);
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const handleExpandMainImage = () => {
      const src = image.getAttribute('src');
      if (src && !frame.disabled) setExpandedImage({ src, alt: 'メイン画像' });
    };

    frame.addEventListener('click', handleExpandMainImage);
    fileInput.addEventListener('change', handleFileChange);
    urlInput.addEventListener('input', handleUrlInput);
    clearButton.addEventListener('click', handleClearSelection);
    renderPreview(urlInput.value || option.image_url || '', false);

    return () => {
      revokeObjectUrl();
      frame.removeEventListener('click', handleExpandMainImage);
      fileInput.removeEventListener('change', handleFileChange);
      urlInput.removeEventListener('input', handleUrlInput);
      clearButton.removeEventListener('click', handleClearSelection);
      preview.remove();
    };
  }, [option.id, option.image_url]);

  useEffect(() => {
    if (!pdfPreviewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPdfPreviewOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pdfPreviewOpen]);

  useEffect(() => {
    if (!expandedImage) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setExpandedImage(null);
      }
    };
    imageCloseButtonRef.current?.focus();
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      previouslyFocused?.focus();
    };
  }, [expandedImage]);

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

  const handleSubImageUrl = async () => {
    const url = imageUrl.trim();
    if (!url || imagePending) return;

    setImagePending(true);
    setImageState(initial);
    try {
      const mainSaved = await saveIfDirty();
      if (!mainSaved) {
        setImageState({ ok: false, error: '商品情報を保存できなかったため、画像URLからの登録を中止しました。' });
        return;
      }

      const formData = new FormData();
      formData.set('option_id', option.id);
      formData.set('source_url', url);
      formData.set('sort_order', String(images.length));
      const result = await addOptionImageFromUrlAction(initial, formData);
      setImageState(result);
      if (result.ok) {
        setImageUrl('');
        router.refresh();
      }
    } catch {
      setImageState({ ok: false, error: '画像URLからの登録中にエラーが発生しました。' });
    } finally {
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
      if (result.ok) {
        setPdfReplaceOpen(false);
        router.refresh();
      }
    } catch {
      setDocState({ ok: false, error: 'メーカー資料PDFの保存中にエラーが発生しました。' });
    } finally {
      input.value = '';
      setDocPending(false);
    }
  };

  const handleManufacturerDocumentUrl = async () => {
    const url = documentUrl.trim();
    if (!url || docPending) return;

    setDocPending(true);
    setDocState(initial);
    try {
      const mainSaved = await saveIfDirty();
      if (!mainSaved) {
        setDocState({ ok: false, error: '商品情報を保存できなかったため、PDF URLからの登録を中止しました。' });
        return;
      }

      const formData = new FormData();
      formData.set('option_id', option.id);
      formData.set('source_url', url);
      const result = await uploadOptionManufacturerDocumentFromUrlAction(initial, formData);
      setDocState(result);
      if (result.ok) {
        setDocumentUrl('');
        setPdfReplaceOpen(false);
        router.refresh();
      }
    } catch {
      setDocState({ ok: false, error: 'PDF URLからの登録中にエラーが発生しました。' });
    } finally {
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
          <ul className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {images.map((image) => (
              <OptionImageEditor key={image.id} optionId={option.id} image={image} onPreview={setExpandedImage} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-4 py-5 text-sm text-muted">
            サブ画像はまだ登録されていません。
          </div>
        )}

        <div className="border-t border-line pt-5">
          <ActionStatus state={imageState} />
          <div className="mt-3 grid gap-4 md:grid-cols-2 md:items-start" data-testid="additional-image-input-layout">
            <div className="min-w-0 rounded-lg border border-line bg-ivory/30 p-3">
              <Field
                label="画像URLから登録"
                htmlFor="option-sub-image-url"
                hint="Excelの追加画像URLを貼り付けて登録します。画像は千の風側へ保存します。"
                errors={imageState.fieldErrors?.source_url}
              >
                <div className="space-y-2">
                  <Input
                    id="option-sub-image-url"
                    type="url"
                    value={imageUrl}
                    onChange={(event) => setImageUrl(event.target.value)}
                    placeholder="https://www.example.com/image.jpg"
                    disabled={imagePending}
                  />
                  <div className="flex justify-start">
                    <Button type="button" disabled={imagePending || !imageUrl.trim()} onClick={() => void handleSubImageUrl()} className="w-full sm:w-auto">
                      {imagePending && <Spinner />}
                      URLから登録
                    </Button>
                  </div>
                </div>
              </Field>
            </div>
            <div className="min-w-0 rounded-lg border border-line bg-ivory/30 p-3">
              <Field
                label="または画像ファイルから登録"
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
            </div>
          </div>
          {imagePending && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <Spinner />
              追加画像を保存しています…
            </p>
          )}
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

        {!option.manufacturer_document_url && (
          <p className="text-xs leading-5 text-ink-soft">
            資料がない場合は未登録で進められます。登録前チェックに確認事項として表示します。
          </p>
        )}

        {option.manufacturer_document_url ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-ivory/50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">メーカー資料PDF 登録済み</p>
              <button
                type="button"
                aria-label="現在の資料を確認"
                onClick={() => setPdfPreviewOpen(true)}
                className="mt-1 text-xs text-brown underline underline-offset-4 hover:no-underline"
              >
                資料を確認
              </button>
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
        {option.manufacturer_document_url && (
          <button
            type="button"
            className="registration-pdf-replace-toggle"
            aria-expanded={pdfReplaceOpen}
            aria-controls="manufacturer-document-replace-fields"
            disabled={docPending}
            onClick={() => setPdfReplaceOpen((open) => !open)}
          >
            {pdfReplaceOpen ? 'PDFの差し替えを閉じる' : 'PDFを差し替える'}
          </button>
        )}
        <div
          id="manufacturer-document-replace-fields"
          className={option.manufacturer_document_url && !pdfReplaceOpen ? 'hidden' : 'grid gap-4 md:grid-cols-2 md:items-start'}
          data-testid="manufacturer-pdf-input-layout"
        >
          <div className="min-w-0 rounded-lg border border-line bg-ivory/30 p-3">
            <Field
              label={option.manufacturer_document_url ? 'PDFのURLから差し替える' : 'PDFのURLから登録'}
              htmlFor="manufacturer-document-url"
              hint="PDF本体のURLを入力してください。閲覧ページのURLでは登録できません。"
              errors={docState.fieldErrors?.source_url}
            >
              <div className="space-y-2">
                <Input
                  id="manufacturer-document-url"
                  type="url"
                  value={documentUrl}
                  onChange={(event) => setDocumentUrl(event.target.value)}
                  placeholder="https://www.example.com/catalog.pdf"
                  disabled={docPending}
                />
                <div className="flex justify-start">
                  <Button type="button" disabled={docPending || !documentUrl.trim()} onClick={() => void handleManufacturerDocumentUrl()} className="w-full sm:w-auto">
                    {docPending && <Spinner />}
                    URLから登録
                  </Button>
                </div>
              </div>
            </Field>
          </div>
          <div className="min-w-0 rounded-lg border border-line bg-ivory/30 p-3">
            <Field
              label={option.manufacturer_document_url ? 'またはPDFファイルで差し替える' : 'またはPDFファイルから登録'}
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
          </div>
        </div>

        {docPending && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Spinner />
            メーカー資料PDFを保存しています…
          </p>
        )}
      </section>

      {expandedImage && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="商品画像の拡大表示"
          data-testid="product-image-lightbox"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setExpandedImage(null);
          }}
        >
          <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="truncate text-sm font-semibold text-ink">{expandedImage.alt}</p>
              <button
                ref={imageCloseButtonRef}
                type="button"
                aria-label="拡大画像を閉じる"
                onClick={() => setExpandedImage(null)}
                className="shrink-0 rounded-md border border-line px-3 py-1 text-sm font-semibold text-ink hover:bg-ivory"
              >
                閉じる
              </button>
            </div>
            <button
              type="button"
              aria-label="拡大画像をクリックして閉じる"
              onClick={() => setExpandedImage(null)}
              className="relative block min-h-0 w-full flex-1 cursor-zoom-out bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              <SmartImage
                src={expandedImage.src}
                alt={expandedImage.alt}
                fill
                sizes="(max-width: 640px) 95vw, 1024px"
                className="object-contain p-3 sm:p-5"
                unoptimized
              />
            </button>
          </div>
        </div>
      )}

      {pdfPreviewOpen && option.manufacturer_document_url && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="メーカー資料PDFプレビュー"
          data-testid="manufacturer-document-modal"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPdfPreviewOpen(false);
          }}
        >
          <div className="flex h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="font-semibold text-ink">メーカー資料PDF</p>
              <div className="flex items-center gap-3">
                <a
                  href={option.manufacturer_document_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brown underline underline-offset-4 hover:no-underline"
                >
                  別タブで開く
                </a>
                <button
                  type="button"
                  aria-label="PDFプレビューを閉じる"
                  onClick={() => setPdfPreviewOpen(false)}
                  className="rounded-md border border-line px-2.5 py-1 text-sm font-semibold text-ink hover:bg-ivory"
                >
                  ×
                </button>
              </div>
            </div>
            <iframe
              src={option.manufacturer_document_url}
              title="メーカー資料PDF"
              className="min-h-0 flex-1 bg-white"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
