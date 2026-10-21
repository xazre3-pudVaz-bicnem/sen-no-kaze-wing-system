'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { saveOptionAction, type AdminFormState } from '@/lib/actions/admin';
import { OptionCustomerPreview } from '@/components/admin/option-customer-preview';
import { ProductHighlightTextarea } from '@/components/admin/product-highlight-textarea';
import { SmartImage } from '@/components/ui/smart-image';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { introducesUnconfirmedZeroPrice } from '@/lib/domain/product-publication';
import {
  VIEW_KEYS,
  VIEW_LABELS,
  VARIANT_KIND_LABELS,
  type BaseModel,
  type OptionCategory,
  type OptionConflict,
  type OptionDependency,
  type OptionVariantChoice,
  type OptionVariantGroup,
  type ProductOption,
} from '@/lib/domain/types';

const initialState: AdminFormState = { ok: false };

type DuplicateCandidateSummary = {
  id: string;
  name: string;
  productNo: string | null;
  reason: 'manufacturer-model' | 'category-manufacturer-name';
  modelNo: string | null;
  manufacturer: string | null;
};

type Props = {
  option: ProductOption;
  categories: OptionCategory[];
  models: BaseModel[];
  dependencies: OptionDependency[];
  conflicts: OptionConflict[];
  variantGroups: OptionVariantGroup[];
  variantChoices: OptionVariantChoice[];
  returnTo?: string;
  financialTools: ReactNode;
  duplicateCandidates?: DuplicateCandidateSummary[];
};

type ReviewState = {
  formData: FormData;
  option: ProductOption;
  imagePreviewUrl: string | null;
};

type DiffItem = {
  key: string;
  label: string;
  before: string;
  after: string;
  kind?: 'long' | 'image';
};

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text || null;
}

function checked(data: FormData, key: string) {
  return data.get(key) !== null;
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : null;
}

function yen(value: number | null) {
  if (value === null) return '—';
  return `¥${Math.round(value).toLocaleString('ja-JP')}`;
}

function yesNo(value: boolean) {
  return value ? 'あり' : 'なし';
}

function specLabel(codes: string[]) {
  if (!codes.length) return '全仕様';
  const labels: Record<string, string> = {
    hotel: 'ホテル仕様',
    residence: '住宅仕様',
    office: '事務所・店舗用',
    'hotel-single': 'ホテル単身者仕様',
  };
  return codes.map((code) => labels[code] ?? code).join('・');
}

function viewLabel(codes: string[]) {
  if (!codes.length) return 'なし';
  return codes.map((code) => VIEW_LABELS[code as keyof typeof VIEW_LABELS] ?? code).join('・');
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function ReviewValue({ value }: { value: string }) {
  return <div className="min-h-11 whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-lg border border-line bg-white px-3 py-2 text-sm leading-6 text-ink-soft">{value || '—'}</div>;
}

function ImagePreview({ src, label }: { src: string | null; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-3">
      <p className="mb-2 text-xs font-semibold text-muted">{label}</p>
      <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-lg border border-line bg-sand/40 text-xs text-muted sm:h-36">
        {src ? <SmartImage src={src} alt="" fill sizes="360px" className="object-contain" /> : '画像なし'}
      </div>
    </div>
  );
}

export function RegisteredOptionEditFlow({
  option,
  categories,
  models,
  dependencies,
  conflicts,
  variantGroups,
  variantChoices,
  returnTo,
  financialTools,
  duplicateCandidates,
}: Props) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [screen, setScreen] = useState<'edit' | 'review'>('edit');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [state, setState] = useState<AdminFormState>(initialState);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [identityChanged, setIdentityChanged] = useState(false);
  const duplicateCheckReady = Boolean(option.manufacturer?.trim() && (option.model_no?.trim() || option.name.trim()));
  const [imageUrlInput, setImageUrlInput] = useState(option.image_url ?? '');
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
  const imagePreviewRequest = useRef(0);

  const updateImageFilePreview = (file: File | null) => {
    const request = ++imagePreviewRequest.current;
    setImagePreviewError(null);
    setSelectedImagePreview(null);
    if (!file || file.size === 0) return;
    void fileToDataUrl(file).then((preview) => {
      if (imagePreviewRequest.current === request) setSelectedImagePreview(preview);
    }).catch(() => {
      if (imagePreviewRequest.current === request) setImagePreviewError('選択した画像を読み込めませんでした。');
    });
  };
  const mainImagePreview = selectedImagePreview ?? (imageUrlInput.trim() || null);

  const galleryImages = useMemo(
    () => [...(option.gallery_images ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    [option.gallery_images]
  );
  const orderedVariantGroups = useMemo(
    () => [...variantGroups].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    [variantGroups]
  );
  const orderedVariantChoices = useMemo(
    () => [...variantChoices].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    [variantChoices]
  );

  const categoryMap = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories]);
  const modelMap = useMemo(() => new Map(models.map((row) => [row.id, row])), [models]);

  const buildReviewOption = async (data: FormData): Promise<ReviewState> => {
    const imageFile = data.get('image_file');
    const imagePreviewUrl = imageFile instanceof File && imageFile.size > 0
      ? await fileToDataUrl(imageFile)
      : nullable(data.get('image_url'));

    const next: ProductOption = {
      ...option,
      category_id: String(data.get('category_id') ?? option.category_id),
      name: String(data.get('name') ?? '').trim(),
      description: nullable(data.get('description')),
      price: numberOrNull(data.get('price')) ?? 0,
      image_url: imagePreviewUrl,
      selection_type: String(data.get('selection_type') ?? 'checkbox') === 'radio' ? 'radio' : 'checkbox',
      is_required: checked(data, 'is_required'),
      is_default: checked(data, 'is_default'),
      is_installation: checked(data, 'is_installation'),
      price_on_request: checked(data, 'price_on_request'),
      spec_codes: data.getAll('spec_codes').map(String),
      base_model_id: nullable(data.get('base_model_id')),
      manufacturer: nullable(data.get('manufacturer')),
      model_no: nullable(data.get('model_no')),
      size_note: nullable(data.get('size_note')),
      list_price: numberOrNull(data.get('list_price')),
      highlight: nullable(data.get('highlight')),
      preview_key: nullable(data.get('preview_key')),
      affects_views: data.getAll('affects_views').map(String) as ProductOption['affects_views'],
      sort_order: numberOrNull(data.get('sort_order')) ?? 0,
      status: 'published',
    };

    return { formData: data, option: next, imagePreviewUrl };
  };

  const openReview = async () => {
    const form = formRef.current;
    if (!form) return;
    setReviewError(null);
    setState(initialState);
    try {
      const data = new FormData(form);
      const next = await buildReviewOption(data);
      if (!next.option.name.trim()) {
        setReviewError('商品名を入力してください。');
        return;
      }
      if (!next.option.category_id) {
        setReviewError('カテゴリーを選択してください。');
        return;
      }
      setReview(next);
      setScreen('review');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setReviewError('変更内容を確認用に読み込めませんでした。');
    }
  };

  const diffs = useMemo<DiffItem[]>(() => {
    if (!review) return [];
    const next = review.option;
    const rows: DiffItem[] = [
      { key: 'name', label: '商品名', before: option.name, after: next.name },
      { key: 'category', label: 'カテゴリー', before: categoryMap.get(option.category_id)?.name ?? '—', after: categoryMap.get(next.category_id)?.name ?? '—' },
      { key: 'manufacturer', label: 'メーカー', before: option.manufacturer ?? '—', after: next.manufacturer ?? '—' },
      { key: 'model_no', label: 'シリーズ・型番／品番', before: option.model_no ?? '—', after: next.model_no ?? '—' },
      { key: 'size_note', label: 'サイズ・仕様', before: option.size_note ?? '—', after: next.size_note ?? '—' },
      { key: 'price', label: '商品価格（税別）', before: option.price_on_request ? '別途見積' : yen(option.price), after: next.price_on_request ? '別途見積' : yen(next.price) },
      { key: 'list_price', label: 'メーカー参考価格（税別）', before: yen(option.list_price), after: yen(next.list_price) },
      { key: 'base_model', label: '対象モデル', before: option.base_model_id ? modelMap.get(option.base_model_id)?.name ?? '特定モデル' : '全モデル共通', after: next.base_model_id ? modelMap.get(next.base_model_id)?.name ?? '特定モデル' : '全モデル共通' },
      { key: 'spec_codes', label: '対応する仕様', before: specLabel(option.spec_codes), after: specLabel(next.spec_codes) },
      { key: 'selection_type', label: '選択方式', before: option.selection_type === 'radio' ? 'ラジオボタン' : 'チェックボックス', after: next.selection_type === 'radio' ? 'ラジオボタン' : 'チェックボックス' },
      { key: 'is_default', label: '初期状態で選択', before: yesNo(option.is_default), after: yesNo(next.is_default) },
      { key: 'is_required', label: '必須（解除不可）', before: yesNo(option.is_required), after: yesNo(next.is_required) },
      { key: 'is_installation', label: '設置関連費用として集計', before: yesNo(option.is_installation), after: yesNo(next.is_installation) },
      { key: 'preview_key', label: 'プレビューキー', before: option.preview_key ?? '—', after: next.preview_key ?? '—' },
      { key: 'affects_views', label: '反映するビュー', before: viewLabel(option.affects_views), after: viewLabel(next.affects_views) },
      { key: 'sort_order', label: '表示順', before: String(option.sort_order), after: String(next.sort_order) },
      { key: 'highlight', label: 'メーカー記載の特徴', before: option.highlight ?? '—', after: next.highlight ?? '—', kind: 'long' },
      { key: 'description', label: '商品説明', before: option.description ?? '—', after: next.description ?? '—', kind: 'long' },
    ];
    const imageChanged = Boolean(review.formData.get('image_file') instanceof File && (review.formData.get('image_file') as File).size > 0) || (option.image_url ?? '') !== (nullable(review.formData.get('image_url')) ?? '');
    if (imageChanged) rows.push({ key: 'image', label: 'メイン画像', before: option.image_url ?? '', after: review.imagePreviewUrl ?? '', kind: 'image' });
    return rows.filter((row) => row.kind === 'image' || row.before !== row.after);
  }, [categoryMap, modelMap, option, review]);

  const zeroPriceNeedsServerContract = Boolean(review && introducesUnconfirmedZeroPrice(option, review.option));
  const nextCategory = review ? categoryMap.get(review.option.category_id) : undefined;

  const applyChanges = async () => {
    if (!review || pending || zeroPriceNeedsServerContract) return;
    setPending(true);
    setState(initialState);
    const result = await saveOptionAction(initialState, review.formData);
    setPending(false);
    setState(result);
    if (result.ok) {
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5" aria-label="商品変更の2ステップ" data-testid="registered-option-change-steps">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-semibold">商品変更の流れ</h2>
            <p className="mt-1 text-xs text-muted">STEP 1で商品情報を変更し、STEP 2で変更点とお客様表示を確認します。入力中は自動保存されません。</p>
          </div>
          <span className="text-xs font-semibold text-brown">現在：STEP {screen === 'edit' ? 1 : 2}</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="商品変更ステップ">
          <div
            aria-current={screen === 'edit' ? 'step' : undefined}
            className={`rounded-xl border px-3 py-3 ${screen === 'edit' ? 'border-brown bg-ivory/80 ring-1 ring-brown/20' : 'border-line bg-white'}`}
          >
            <span className="block text-xs font-semibold text-brown">STEP 1</span>
            <span className="mt-1 block text-sm font-semibold">商品情報の変更</span>
            <span className="mt-1 block text-xs text-muted">基本情報・画像・資料・お客様選択・価格を確認</span>
          </div>
          <div
            aria-current={screen === 'review' ? 'step' : undefined}
            className={`rounded-xl border px-3 py-3 ${screen === 'review' ? 'border-brown bg-ivory/80 ring-1 ring-brown/20' : 'border-line bg-white'}`}
          >
            <span className="block text-xs font-semibold text-brown">STEP 2</span>
            <span className="mt-1 block text-sm font-semibold">変更内容確認</span>
            <span className="mt-1 block text-xs text-muted">差分とシミュレーター共通の商品詳細で確認</span>
          </div>
        </div>
      </section>
      {review && (
        <section hidden={screen !== 'review'} className="space-y-6" data-testid="registered-option-change-review">
          <section className="card p-4 sm:p-5" aria-label="変更内容確認">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold tracking-wide text-brown">登録済み商品</p>
                <h2 className="mt-1 text-xl font-semibold">変更内容確認</h2>
                <p className="mt-1 text-sm text-muted">変更した項目だけを確認します。「この変更を反映」を押すまで、登録済みの商品情報には反映されません。</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => { setScreen('edit'); setState(initialState); }}>編集に戻る</Button>
            </div>
          </section>

          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.fieldErrors?._form?.[0] && <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>}
          {state.ok && <Alert tone="success">変更を反映しました。最新の登録内容を読み直しています。</Alert>}

          <section className="card p-4 sm:p-5" aria-label="変更点一覧">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">変更点</h3>
                <p className="mt-1 text-xs text-muted">変更前と変更後が異なる項目だけを表示しています。</p>
              </div>
              <span className="rounded-full bg-ivory px-3 py-1 text-xs font-semibold text-brown">{diffs.length}件</span>
            </div>

            {diffs.length === 0 ? (
              <p className="mt-4 rounded-xl border border-line bg-sand/30 px-4 py-4 text-sm text-muted">変更された項目はありません。</p>
            ) : (
              <div className="mt-4 space-y-4">
                {diffs.map((diff) => diff.kind === 'image' ? (
                  <div key={diff.key}>
                    <p className="mb-2 text-sm font-semibold">{diff.label}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <ImagePreview src={diff.before || null} label="現在の内容" />
                      <ImagePreview src={diff.after || null} label="変更後の内容" />
                    </div>
                  </div>
                ) : diff.kind === 'long' ? (
                  <div key={diff.key} className="rounded-xl border border-line bg-sand/20 p-3 sm:p-4">
                    <p className="mb-3 text-sm font-semibold">{diff.label}</p>
                    <div className="space-y-3">
                      <div><p className="mb-1 text-xs font-semibold text-muted">現在の内容</p><ReviewValue value={diff.before} /></div>
                      <div><p className="mb-1 text-xs font-semibold text-muted">変更後の内容</p><ReviewValue value={diff.after} /></div>
                    </div>
                  </div>
                ) : (
                  <div key={diff.key} className="rounded-xl border border-line bg-sand/20 p-3 sm:p-4">
                    <p className="mb-3 text-sm font-semibold">{diff.label}</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><p className="mb-1 text-xs font-semibold text-muted">変更前</p><ReviewValue value={diff.before} /></div>
                      <div><p className="mb-1 text-xs font-semibold text-muted">変更後</p><ReviewValue value={diff.after} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3" aria-label="変更後のお客様表示プレビュー">
            <div>
              <h3 className="text-lg font-semibold">変更後のお客様表示プレビュー</h3>
              <p className="mt-1 text-sm text-muted">変更後の内容で、お客様に見える商品詳細を確認します。このプレビュー操作では登録内容は変わりません。</p>
            </div>
            {nextCategory ? (
              <>
                <div className="[&>div>p:last-child]:hidden">
                  <OptionCustomerPreview
                    category={nextCategory}
                    option={review.option}
                    groups={variantGroups}
                    choices={variantChoices}
                  />
                </div>
                <p className="text-xs leading-5 text-muted">
                  実際のお客様画面と同じ内容で表示しています。追加金額や「この内容に変更する」操作は、実際の選択内容によって変わるため、この確認画面では表示していません。
                </p>
              </>
            ) : (
              <Alert tone="danger">変更後のカテゴリーが見つからないため、お客様表示を確認できません。</Alert>
            )}
          </section>

          {zeroPriceNeedsServerContract && (
            <Alert tone="warn">
              登録済み商品の通常価格を0円へ変更する正式確認経路は、現在のサーバー側ルールとの接続待ちです。この変更はまだ反映できません。
            </Alert>
          )}

          <section className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5" aria-label="変更反映">
            <div>
              <h3 className="font-semibold">変更を反映</h3>
              <p className="mt-1 text-xs text-muted">このボタンを押した時点で、確認した変更を登録済み商品へ反映します。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => { setScreen('edit'); setState(initialState); }}>編集に戻る</Button>
              <Button type="button" onClick={applyChanges} disabled={pending || diffs.length === 0 || zeroPriceNeedsServerContract || state.ok}>
                {pending && <Spinner />}
                この変更を反映
              </Button>
            </div>
          </section>
        </section>
      )}

      <section hidden={screen !== 'edit'} className="space-y-4" data-testid="registered-option-edit-flow">
        <div className="space-y-1" aria-label="商品を編集">
          <h2 className="text-lg font-semibold">STEP 1 商品情報を編集</h2>
          <p className="text-xs leading-5 text-muted">登録済みの商品です。変更内容とお客様表示を確認するまで、入力した内容は反映されません。</p>
        </div>

        {reviewError && <Alert tone="danger">{reviewError}</Alert>}

        <form id="registered-option-main-edit-form" ref={formRef} className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void openReview(); }}>
          <input type="hidden" name="id" value={option.id} />
          <input type="hidden" name="owner_id" value={option.owner_id ?? ''} />
          <input type="hidden" name="status" value="published" />
          {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
          {dependencies.map((dep) => (
            <span key={dep.requires_option_id} className="hidden">
              <input type="hidden" name="requires" value={dep.requires_option_id} />
              <input type="hidden" name={`requires_message_${dep.requires_option_id}`} value={dep.message ?? ''} />
            </span>
          ))}
          {conflicts.map((conflict) => (
            <span key={conflict.conflicts_with_option_id} className="hidden">
              <input type="hidden" name="conflicts" value={conflict.conflicts_with_option_id} />
              <input type="hidden" name={`conflicts_message_${conflict.conflicts_with_option_id}`} value={conflict.message ?? ''} />
            </span>
          ))}

          <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-product-identify">
            <div>
              <h3 className="text-lg font-semibold">1. 基本情報</h3>
              <p className="mt-1 text-sm text-muted">カテゴリー、メーカー、商品名、シリーズ・型番／品番を確認・変更します。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="カテゴリー" htmlFor="registered-category" required>
                <Select id="registered-category" name="category_id" defaultValue={option.category_id} onChange={() => setIdentityChanged(true)} required>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </Select>
              </Field>
              <Field label="メーカー" htmlFor="registered-manufacturer">
                <Input id="registered-manufacturer" name="manufacturer" defaultValue={option.manufacturer ?? ''} onChange={() => setIdentityChanged(true)} />
              </Field>
              <Field label="商品名" htmlFor="registered-name" required>
                <Input id="registered-name" name="name" defaultValue={option.name} onChange={() => setIdentityChanged(true)} required />
              </Field>
              <Field label="シリーズ・型番／品番" htmlFor="registered-model-no">
                <Input id="registered-model-no" name="model_no" defaultValue={option.model_no ?? ''} onChange={() => setIdentityChanged(true)} />
              </Field>
            </div>
            <div className="rounded-lg border border-line bg-sand/25 px-3 py-2" data-testid="registered-option-product-number">
              <p className="text-xs font-semibold text-muted">商品管理番号</p>
              <p className="mt-1 font-mono text-sm font-semibold text-ink">{option.product_no ?? '商品管理番号は未反映'}</p>
              <p className="mt-1 text-xs text-muted">登録済みの管理番号はこの画面から変更できません。</p>
            </div>
            {duplicateCandidates && (
              <section
                className={`rounded-lg border px-3 py-3 ${!identityChanged && duplicateCandidates.length ? 'border-[#d9a441] bg-[#fff8e8]' : 'border-line bg-ivory/30'}`}
                aria-label="既存商品チェック"
                data-testid="registered-option-duplicate-status"
                aria-live="polite"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">既存商品チェック</p>
                  <span className="text-xs font-semibold text-muted">
                    {identityChanged
                      ? '入力変更後の重複は未確認'
                      : duplicateCandidates.length
                        ? '要確認：重複候補あり'
                        : duplicateCheckReady ? '重複候補なし' : '確認に必要な情報が不足'}
                  </span>
                </div>
                {identityChanged ? (
                  <p className="mt-2 text-xs text-muted">変更前の登録内容に対する確認結果です。入力した変更内容の重複判定はここでは行いません。</p>
                ) : duplicateCandidates.length ? (
                  <div className="mt-2">
                    <p className="text-xs text-ink-soft">同じ商品を重複登録していないか確認してください。この表示だけで保存を停止しません。</p>
                    <ul className="mt-2 space-y-2">
                      {duplicateCandidates.map((candidate) => (
                        <li key={candidate.id} className="rounded border border-line bg-white px-3 py-2 text-xs">
                          <a href={`/admin/options/${candidate.id}`} className="font-semibold underline underline-offset-4 hover:text-brown">{candidate.name}</a>
                          <span className="ml-2 text-muted">{candidate.productNo ?? '商品番号未反映'}</span>
                          <p className="mt-1 text-muted">
                            {candidate.reason === 'manufacturer-model'
                              ? 'メーカー＋シリーズ・型番／品番が一致'
                              : '同一カテゴリー＋メーカー＋商品名が一致'}
                            {candidate.modelNo ? ` ／ ${candidate.manufacturer ?? 'メーカー未設定'} ／ ${candidate.modelNo}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">
                    {duplicateCheckReady
                      ? '現在登録されているメーカー・商品名・型番について、重複候補は見つかっていません。'
                      : 'メーカーと商品名または型番を確認してください。'}
                  </p>
                )}
              </section>
            )}
          </section>

          <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-product-details">
            <div>
              <h3 className="text-lg font-semibold">2. 商品の詳細</h3>
              <p className="mt-1 text-sm text-muted">サイズ・仕様、メーカー記載の特徴、商品説明を確認・変更します。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="サイズ・仕様" htmlFor="registered-size-note">
                <Input id="registered-size-note" name="size_note" defaultValue={option.size_note ?? ''} />
              </Field>
              <Field label="メーカー記載の特徴（任意）" htmlFor="registered-highlight">
                <ProductHighlightTextarea id="registered-highlight" initialValue={option.highlight ?? ''} />
              </Field>
            </div>
            <Field label="商品説明" htmlFor="registered-description">
              <Textarea id="registered-description" name="description" defaultValue={option.description ?? ''} className="min-h-28" />
            </Field>
          </section>

          <section className="card space-y-4 p-4 sm:p-5" data-testid="registered-product-main-media">
            <div>
              <h3 className="text-lg font-semibold">3. 商品画像</h3>
              <p className="mt-1 text-sm text-muted">下書き画面と同じように、メイン画像と追加画像を確認できます。追加画像は改版機能の準備ができるまで参照専用です。</p>
            </div>
            <div className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-ivory/30 p-3" data-testid="registered-option-main-image-preview">
              <div className="w-40 max-w-full sm:w-48">
                <ImagePreview src={mainImagePreview} label="メイン画像プレビュー" />
              </div>
              <div className="min-w-44 flex-1 space-y-2 pt-1">
                <p className="text-xs text-muted">選択した画像URLまたは画像ファイルをここで確認できます。ファイルを選んだ場合はファイルの画像を優先して表示します。</p>
                <p className="text-xs text-muted">画像を選んだだけでは保存されません。変更内容確認を経て反映します。</p>
                {imagePreviewError && <Alert tone="danger">{imagePreviewError}</Alert>}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="画像URL" htmlFor="registered-image-url">
                <Input id="registered-image-url" name="image_url" value={imageUrlInput} onChange={(event) => setImageUrlInput(event.target.value)} />
              </Field>
              <Field label="または画像ファイル" htmlFor="registered-image-file">
                <Input id="registered-image-file" name="image_file" type="file" accept="image/*" className="py-2" onChange={(event) => updateImageFilePreview(event.target.files?.[0] ?? null)} />
              </Field>
            </div>
            <div className="border-t border-line pt-3">
              <div className="space-y-2" data-testid="registered-option-current-gallery">
                <p className="text-sm font-semibold">追加画像（{galleryImages.length}枚）</p>
                {galleryImages.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {galleryImages.map((image, index) => (
                      <li key={image.id} className="min-w-0 rounded-lg border border-line bg-white p-2">
                        <div className="relative aspect-square overflow-hidden rounded bg-sand/30">
                          <SmartImage
                            src={image.url}
                            alt={image.alt || `追加画像${index + 1}`}
                            fill
                            sizes="(max-width: 640px) 160px, 120px"
                            className="object-contain"
                          />
                        </div>
                        <p className="mt-1 line-clamp-2 break-words text-xs text-ink-soft">
                          {image.caption || image.alt || `追加画像${index + 1}`}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">追加画像は未登録です。</p>
                )}
              </div>
            </div>
          </section>

          <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-option-pending-subedit">
            <div>
              <h3 className="text-lg font-semibold">4. メーカー資料</h3>
              <p className="mt-1 text-sm text-muted">メーカー資料PDFの登録状況を確認できます。変更・解除はまだできません。</p>
            </div>
            <p className="rounded-lg border border-line bg-ivory/40 px-3 py-2 text-xs leading-5 text-muted">
              サブ画像・メーカーPDF・お客様が選ぶ仕様は、登録済み商品の変更確認フローへの接続待ちです。確認前に正式データへ反映しない仕組みが整うまで、この編集画面からの変更は停止しています。
            </p>
            <div className="space-y-2">
              <p className="text-sm font-semibold">メーカー資料PDF</p>
              {option.manufacturer_document_url ? (
                <a
                  href={option.manufacturer_document_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-2 text-sm text-brown underline underline-offset-2 hover:bg-ivory"
                >
                  登録済みPDFを別タブで確認
                </a>
              ) : (
                <p className="text-sm text-muted">メーカー資料PDFは未登録です。</p>
              )}
            </div>
          </section>

          <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-option-current-choices">
            <div>
              <h3 className="text-lg font-semibold">5. お客様選択</h3>
              <p className="mt-1 text-sm text-muted">選択項目と選択肢の現在の設定を確認できます。追加・編集・価格変更はまだできません。</p>
            </div>
            {orderedVariantGroups.length > 0 ? (
              <div className="space-y-3">
                {orderedVariantGroups.map((group) => {
                  const choices = orderedVariantChoices.filter((choice) => choice.group_id === group.id);
                  return (
                    <div key={group.id} className="rounded-lg border border-line bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-semibold">{group.name}</h4>
                        <span className="text-xs text-muted">{group.status === 'published' ? '公開中' : '非公開'}</span>
                        {group.is_required && <span className="text-xs text-muted">必須</span>}
                      </div>
                      {group.note && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{group.note}</p>}
                      {choices.length > 0 ? (
                        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                          {choices.map((choice) => (
                            <li key={choice.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-line/70 bg-ivory/20 p-2">
                              {choice.image_url && (
                                <div className="relative size-12 shrink-0 overflow-hidden rounded border border-line bg-white">
                                  <SmartImage
                                    src={choice.image_url}
                                    alt={`${choice.name}の画像`}
                                    fill
                                    sizes="48px"
                                    className="object-contain"
                                  />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold">{choice.name}</p>
                                <p className="text-xs text-muted">
                                  {VARIANT_KIND_LABELS[choice.kind]}・{choice.price_on_request ? '別途見積' : `追加金額 ${yen(choice.extra_price)}（税別）`}
                                  {choice.status === 'draft' ? '・非公開' : ''}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-sm text-muted">選択肢は未登録です。</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted">お客様選択の項目は未登録です。</p>
            )}
          </section>

          <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-product-pricing">
            <div>
              <h3 className="text-lg font-semibold">6. 価格・対象モデル</h3>
              <p className="mt-1 text-sm text-muted">登録状態は「登録済み」のままです。この画面から下書きへ戻す操作は行いません。</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="商品価格（税別・円）" htmlFor="registered-price" required>
                <Input id="registered-price" name="price" type="number" min={0} step={1000} defaultValue={option.price} required />
              </Field>
              <Field label="メーカー参考価格（税別・表示のみ）" htmlFor="registered-list-price">
                <Input id="registered-list-price" name="list_price" type="number" min={0} step={1} defaultValue={option.list_price ?? ''} />
              </Field>
              <Field label="対象モデル" htmlFor="registered-base-model">
                <Select id="registered-base-model" name="base_model_id" defaultValue={option.base_model_id ?? ''}>
                  <option value="">全モデル共通</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </Select>
              </Field>
              <div>
                <p className="label">登録状態</p>
                <div className="input flex min-h-11 items-center bg-sand/35 text-sm font-semibold text-ink-soft">登録済み</div>
              </div>
            </div>
            <Checkbox name="price_on_request" defaultChecked={option.price_on_request} label="価格は別途見積（0円扱い）" />
            <div className="border-t border-line pt-3">
  <section className="space-y-3 rounded-xl border border-line bg-ivory/30 p-3 sm:p-4" data-testid="registered-product-display-settings">
              <h3 className="text-lg font-semibold">主要仕様・表示設定</h3>
              <div className="space-y-3">
                <div>
                  <p className="label">対応する仕様</p>
                  <p className="mb-2 text-xs text-muted">未選択なら全仕様で表示します。</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {[['hotel', 'ホテル仕様'], ['residence', '住宅仕様'], ['office', '事務所・店舗用'], ['hotel-single', 'ホテル単身者仕様']].map(([code, label]) => (
                      <Checkbox key={code} name="spec_codes" value={code} defaultChecked={option.spec_codes.includes(code)} label={label} />
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="表示順" htmlFor="registered-sort-order"><Input id="registered-sort-order" name="sort_order" type="number" defaultValue={option.sort_order} /></Field>
                  <Field label="選択方式（表示）" htmlFor="registered-selection-type">
                    <Select id="registered-selection-type" name="selection_type" defaultValue={option.selection_type}>
                      <option value="checkbox">チェックボックス</option>
                      <option value="radio">ラジオボタン</option>
                    </Select>
                  </Field>
                  <Field label="プレビューキー" htmlFor="registered-preview-key"><Input id="registered-preview-key" name="preview_key" defaultValue={option.preview_key ?? ''} /></Field>
                  <div>
                    <p className="label">反映するビュー</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
                      {VIEW_KEYS.map((view) => <Checkbox key={view} name="affects_views" value={view} defaultChecked={option.affects_views.includes(view)} label={VIEW_LABELS[view]} />)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Checkbox name="is_default" defaultChecked={option.is_default} label="初期状態で選択" />
                  <Checkbox name="is_required" defaultChecked={option.is_required} label="必須（解除不可）" />
                  <Checkbox name="is_installation" defaultChecked={option.is_installation} label="設置関連費用として集計" />
                </div>
              </div>
            </section>
            </div>
          </section>



        </form>
        <section className="space-y-3" data-testid="registered-product-financial-tools" aria-label="価格単位と本部基準原価">
          <p className="px-1 text-xs leading-5 text-muted">
            価格単位と本部商品基準原価は別々に保存します。商品価格の「変更内容を確認」では保存されません。
          </p>
          {financialTools}
        </section>

        <section className="card space-y-3 p-4 sm:p-5" data-testid="registered-product-change-check">
          <div>
            <h3 className="font-semibold">7. 変更内容の確認</h3>
            <p className="mt-1 text-xs text-muted">商品情報の変更は自動保存されません。変更内容とお客様表示を確認してから反映します。価格単位・本部基準原価は上の専用ボタンで別途保存します。</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" form="registered-option-main-edit-form">変更内容を確認</Button>
          </div>
        </section>
      </section>
    </div>
  );
}
