'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  createVariantGroupWithFirstChoiceAction,
  type ProductVariantCreateState,
} from '@/lib/actions/product-registration-variants';
import { Alert, Button, Input, Spinner } from '@/components/ui';
import { SmartImage } from '@/components/ui/smart-image';

const initialState: ProductVariantCreateState = { ok: false };

function canPreviewChoiceImageUrl(value: string): boolean {
  const url = value.trim();
  if (url.startsWith('/images/')) return !/[\\\s<>]/.test(url);
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

type SuggestionSet = {
  groups: readonly string[];
  choices: readonly string[];
};

const CATEGORY_SUGGESTIONS: readonly { match: RegExp; suggestions: SuggestionSet }[] = [
  {
    match: /ユニットバス|\bUB\b|シャワー/i,
    suggestions: {
      groups: ['床', 'カウンター', 'アクセントパネル', '周辺パネル', '浴槽', '水栓'],
      choices: ['ホワイト', 'ブラック', 'グレー', 'ベージュ', '木目調', '石目調'],
    },
  },
  {
    match: /キッチン/i,
    suggestions: {
      groups: ['扉カラー', 'ワークトップ', 'シンク', '水栓', '取手'],
      choices: ['ホワイト', 'ブラック', 'グレー', 'ベージュ', '木目調', 'ステンレス'],
    },
  },
  {
    match: /洗面/i,
    suggestions: {
      groups: ['扉カラー', 'カウンター', 'ボウル', '水栓', 'ミラー'],
      choices: ['ホワイト', 'ブラック', 'グレー', 'ベージュ', '木目調'],
    },
  },
  {
    match: /トイレ/i,
    suggestions: {
      groups: ['本体カラー', '便座', 'リモコン', '手洗い'],
      choices: ['ホワイト', 'アイボリー', 'グレー', 'ブラック'],
    },
  },
  {
    match: /給湯/i,
    suggestions: {
      groups: ['号数', '設置方式', 'リモコン', '給湯方式'],
      choices: ['標準仕様', '屋外壁掛', '屋外据置'],
    },
  },
  {
    match: /外壁/i,
    suggestions: {
      groups: ['色', '柄', '張り方', '仕上げ'],
      choices: ['ホワイト', 'グレー', 'ブラック', 'ベージュ', '木目調', '石目調'],
    },
  },
  {
    match: /屋根/i,
    suggestions: {
      groups: ['色', '形状', '仕上げ'],
      choices: ['ブラック', 'グレー', 'ブラウン', 'シルバー'],
    },
  },
  {
    match: /断熱/i,
    suggestions: {
      groups: ['断熱材', '厚み', '仕様'],
      choices: ['標準仕様', '高断熱仕様'],
    },
  },
  {
    match: /玄関ドア/i,
    suggestions: {
      groups: ['デザイン', '色', 'ハンドル', 'ガラス'],
      choices: ['ホワイト', 'ブラック', 'ブラウン', '木目調'],
    },
  },
  {
    match: /勝手口/i,
    suggestions: {
      groups: ['デザイン', '色', 'ガラス'],
      choices: ['ホワイト', 'ブラック', 'ブラウン', 'シルバー'],
    },
  },
  {
    match: /サッシ|窓/i,
    suggestions: {
      groups: ['枠色', 'ガラス', '開き方'],
      choices: ['ホワイト', 'ブラック', 'ブラウン', 'シルバー'],
    },
  },
  {
    match: /室内建具|内部建具|建具/i,
    suggestions: {
      groups: ['デザイン', '色', '取手', 'ガラス'],
      choices: ['ホワイト', 'ブラック', '木目調', 'ナチュラル'],
    },
  },
  {
    match: /床/i,
    suggestions: {
      groups: ['色', '柄', '仕上げ'],
      choices: ['ホワイト', 'グレー', 'ブラウン', 'ナチュラル', '木目調'],
    },
  },
  {
    match: /壁|天井/i,
    suggestions: {
      groups: ['色', '柄', '仕上げ'],
      choices: ['ホワイト', 'グレー', 'ベージュ', '木目調', '石目調'],
    },
  },
  {
    match: /玄関収納|クローゼット|収納/i,
    suggestions: {
      groups: ['扉色', '扉柄', '取手', '内部仕様'],
      choices: ['ホワイト', 'ブラック', 'ブラウン', '木目調'],
    },
  },
  {
    match: /エアコン/i,
    suggestions: {
      groups: ['容量', '本体カラー', '機能'],
      choices: ['ホワイト', '標準仕様'],
    },
  },
  {
    match: /照明/i,
    suggestions: {
      groups: ['器具色', '光色', '形状'],
      choices: ['ホワイト', 'ブラック', '電球色', '昼白色'],
    },
  },
  {
    match: /スマートロック/i,
    suggestions: {
      groups: ['本体色', '解錠方法', '仕様'],
      choices: ['ブラック', 'シルバー', '標準仕様'],
    },
  },
  {
    match: /ベッド/i,
    suggestions: {
      groups: ['色', 'サイズ', '仕上げ'],
      choices: ['ホワイト', 'ブラウン', 'ナチュラル', '木目調'],
    },
  },
  {
    match: /家具|備品|家電|事務用品/i,
    suggestions: {
      groups: ['色', 'サイズ', '仕様'],
      choices: ['ホワイト', 'ブラック', 'グレー', '標準仕様'],
    },
  },
  {
    match: /外構|外部|現地工事/i,
    suggestions: {
      groups: ['色', '仕上げ', '仕様'],
      choices: ['ブラック', 'グレー', 'ブラウン', '標準仕様'],
    },
  },
];

const DEFAULT_SUGGESTIONS: SuggestionSet = {
  groups: ['色', '柄', 'サイズ', '仕上げ', '仕様'],
  choices: [],
};

function normalizeCategoryLabel(label: string) {
  return label.replace(/^【[^】]+】/, '').trim();
}

function suggestionsForCategory(label: string): SuggestionSet {
  const normalized = normalizeCategoryLabel(label);
  return CATEGORY_SUGGESTIONS.find((row) => row.match.test(normalized))?.suggestions ?? DEFAULT_SUGGESTIONS;
}

function refineProductImages() {
  const main = document.querySelector<HTMLElement>('.registration-step1-sections #product-main-media');
  const extra = document.querySelector<HTMLElement>('.registration-step1-sections #product-sub-images');
  if (!main || !extra) return;

  const wrapper = extra.parentElement?.parentElement;
  if (!(wrapper instanceof HTMLElement)) return;

  main.style.borderBottomLeftRadius = '0';
  main.style.borderBottomRightRadius = '0';
  main.style.borderBottomWidth = '0px';
  extra.style.borderTopLeftRadius = '0';
  extra.style.borderTopRightRadius = '0';

  const gap = extra.getBoundingClientRect().top - main.getBoundingClientRect().bottom;
  if (gap > 0.5) {
    const currentMargin = Number.parseFloat(window.getComputedStyle(wrapper).marginTop) || 0;
    wrapper.style.marginTop = `${currentMargin - gap}px`;
  }
}

function SuggestionButtons({
  title,
  values,
  onSelect,
}: {
  title: string;
  values: readonly string[];
  onSelect: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <div className="mt-1.5 max-w-[34rem] rounded-lg bg-ivory/40 px-2 py-2">
      <p className="text-xs font-semibold text-ink-soft">{title}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft hover:border-brown hover:text-ink"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}

function VariantCreatePortal({
  target,
  optionId,
  categoryLabel,
}: {
  target: HTMLElement;
  optionId: string;
  categoryLabel: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ProductVariantCreateState>(initialState);
  const [pending, setPending] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [choiceNames, setChoiceNames] = useState<string[]>(['']);
  const [choiceRowIds, setChoiceRowIds] = useState<number[]>([0]);
  const nextChoiceRowId = useRef(1);
  const imageInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const imageUrls = useRef<Record<number, string>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<number, string>>({});
  const [choiceImageUrls, setChoiceImageUrls] = useState<Record<number, string>>({});
  const [standardIndex, setStandardIndex] = useState(0);
  const [activeSuggestions, setActiveSuggestions] = useState<'group' | number | null>(null);
  const suggestions = suggestionsForCategory(categoryLabel);
  const groupPlaceholder = `例：${suggestions.groups.slice(0, 3).join('／')}`;

  useEffect(() => {
    const urls = imageUrls.current;
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const clearChoiceImage = (rowId: number) => {
    if (imageUrls.current[rowId]) URL.revokeObjectURL(imageUrls.current[rowId]);
    delete imageUrls.current[rowId];
    if (imageInputs.current[rowId]) imageInputs.current[rowId]!.value = '';
    setImagePreviews({ ...imageUrls.current });
  };

  const clearChoiceMedia = (rowId: number) => {
    clearChoiceImage(rowId);
    setChoiceImageUrls((urls) => {
      const next = { ...urls };
      delete next[rowId];
      return next;
    });
  };

  const onChoiceImageUrlChange = (rowId: number, value: string) => {
    if (value.trim()) clearChoiceImage(rowId);
    setChoiceImageUrls((urls) => ({ ...urls, [rowId]: value }));
    setState(initialState);
  };

  const onChoiceImageChange = (rowId: number, file: File | null) => {
    if (file && (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
      clearChoiceImage(rowId);
      setState({ ok: false, fieldErrors: { _form: ['画像はJPEG / PNG / WebP / AVIF、1枚10MB以下にしてください。'] } });
      return;
    }
    if (imageUrls.current[rowId]) URL.revokeObjectURL(imageUrls.current[rowId]);
    if (file && file.size > 0) {
      imageUrls.current[rowId] = URL.createObjectURL(file);
      setChoiceImageUrls((urls) => ({ ...urls, [rowId]: '' }));
    } else {
      delete imageUrls.current[rowId];
    }
    setImagePreviews({ ...imageUrls.current });
    setState(initialState);
  };

  const resetChoiceForm = () => {
    Object.values(imageUrls.current).forEach((url) => URL.revokeObjectURL(url));
    Object.keys(imageUrls.current).forEach((id) => { delete imageUrls.current[Number(id)]; });
    imageInputs.current = {};
    setImagePreviews({});
    setChoiceImageUrls({});
    setGroupName('');
    setChoiceNames(['']);
    setChoiceRowIds([0]);
    nextChoiceRowId.current = 1;
    setStandardIndex(0);
    setActiveSuggestions(null);
  };

  const updateChoice = (index: number, value: string) => {
    setChoiceNames((rows) => rows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };

  const removeChoice = (index: number) => {
    if (choiceNames.length <= 1) return;
    clearChoiceMedia(choiceRowIds[index]);
    setChoiceRowIds((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setChoiceNames((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setStandardIndex((current) => {
      if (current === index) return 0;
      return current > index ? current - 1 : current;
    });
    setActiveSuggestions(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    setPending(true);
    setState(initialState);
    const result = await createVariantGroupWithFirstChoiceAction(initialState, new FormData(form));
    setPending(false);
    setState(result);

    if (!result.ok) {
      router.refresh();
      return;
    }
    form.reset();
    resetChoiceForm();
    setOpen(false);
    router.refresh();
  };

  return createPortal(
    <div className="w-full max-w-[44rem] space-y-2" data-combined-create-root="true">
      {!open && (
        <button
          type="button"
          className="btn-secondary btn-sm"
          aria-expanded={false}
          onClick={() => {
            setState(initialState);
            resetChoiceForm();
            setOpen(true);
          }}
        >
          ＋ 選択項目を追加
        </button>
      )}

      {open && (
        <div className="border-t border-line/70 pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">選択項目を追加</p>
            <button
              type="button"
              className="text-xs text-muted underline underline-offset-4"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              閉じる
            </button>
          </div>

          {state.error && <Alert tone="danger">{state.error}</Alert>}
          {state.fieldErrors?._form?.[0] && <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>}

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-2" noValidate>
            <input type="hidden" name="option_id" value={optionId} />
            <input type="hidden" name="first_choice_name" value={choiceNames[standardIndex] ?? ''} />
            {choiceNames.map((value, index) =>
              index === standardIndex ? null : (
                <input key={`additional-choice-hidden-${index}`} type="hidden" name="additional_choice_name" value={value} />
              )
            )}

            <div className="grid gap-1.5 sm:grid-cols-[7rem_minmax(0,26rem)] sm:items-center" data-testid="compact-variant-group-field">
              <label htmlFor="registration-variant-group-name" className="text-sm font-semibold">
                選択項目名 <span className="text-xs text-red-700">必須</span>
              </label>
              <div className="min-w-0 max-w-[26rem]">
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id="registration-variant-group-name"
                    name="name"
                    className="min-w-0 flex-1"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    placeholder={groupPlaceholder}
                    title="候補外も自由入力できます。"
                    aria-invalid={Boolean(state.fieldErrors?.name?.length)}
                    autoComplete="off"
                    required
                  />
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold text-brown underline underline-offset-2"
                    aria-expanded={activeSuggestions === 'group'}
                    onClick={() => setActiveSuggestions((current) => current === 'group' ? null : 'group')}
                  >
                    候補を見る
                  </button>
                </div>
                {state.fieldErrors?.name?.[0] && (
                  <p className="mt-1 text-xs text-danger" role="alert">{state.fieldErrors.name[0]}</p>
                )}
                {activeSuggestions === 'group' && (
                  <SuggestionButtons
                    title="選択項目名の候補"
                    values={suggestions.groups}
                    onSelect={(value) => {
                      setGroupName(value);
                      setActiveSuggestions(null);
                    }}
                  />
                )}
              </div>
            </div>

            <div className="space-y-2" data-testid="compact-variant-choices">
              <p className="text-sm font-semibold">選択肢 <span className="text-red-700">必須</span> <span className="font-normal text-muted">（標準を1つ選択）</span></p>

              <div className="space-y-1.5">
                {choiceNames.map((value, index) => {
                  const isStandard = standardIndex === index;
                  const rowId = choiceRowIds[index];
                  const imageUrl = choiceImageUrls[rowId] ?? '';
                  const previewUrl = imagePreviews[rowId] || (canPreviewChoiceImageUrl(imageUrl) ? imageUrl.trim() : '');
                  return (
                    <div key={rowId} data-testid="two-line-choice" className={isStandard
                      ? 'space-y-1.5 border-b border-line/70 bg-ivory/20 py-2'
                      : 'space-y-1.5 border-b border-line/70 py-2'}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-ink-soft">
                          <input
                            type="radio"
                            name="standard_choice_index"
                            value={index}
                            checked={isStandard}
                            disabled={pending}
                            onChange={() => setStandardIndex(index)}
                          />
                          標準
                        </label>
                        <label htmlFor={`registration-choice-${rowId}`} className="sr-only">選択肢 {index + 1}</label>
                        <Input
                          id={`registration-choice-${rowId}`}
                          className="min-w-0 max-w-[22rem] flex-[1_1_14rem]"
                          value={value}
                          disabled={pending}
                          onChange={(event) => updateChoice(index, event.target.value)}
                          placeholder={`選択肢 ${index + 1}：ホワイトなど`}
                          autoComplete="off"
                          required={isStandard}
                        />
                        {suggestions.choices.length > 0 && (
                          <button
                            type="button"
                            className="shrink-0 px-1 text-xs font-semibold text-brown underline underline-offset-2"
                            aria-expanded={activeSuggestions === index}
                            onClick={() => setActiveSuggestions((current) => current === index ? null : index)}
                          >
                            候補を見る
                          </button>
                        )}
                        {choiceNames.length > 1 && (
                          <button
                            type="button"
                            className="shrink-0 px-1 text-xs text-muted underline"
                            disabled={pending}
                            onClick={() => removeChoice(index)}
                          >
                            削除
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:pl-14" data-testid="choice-image-inputs">
                        <label htmlFor={`registration-choice-image-url-${rowId}`} className="sr-only">
                          {value || `選択肢 ${index + 1}`} の画像URL（任意）
                        </label>
                        <Input
                          id={`registration-choice-image-url-${rowId}`}
                          name={`choice_image_url_${index}`}
                          value={imageUrl}
                          onChange={(event) => onChoiceImageUrlChange(rowId, event.target.value)}
                          placeholder="画像URL（https://...）"
                          className="min-w-0 max-w-[22rem] flex-[1_1_12rem]"
                          disabled={pending}
                          autoComplete="off"
                        />
                        <label className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-lg border border-line bg-white px-2.5 text-xs font-semibold text-ink-soft hover:border-brown">
                          ファイル選択
                          <input
                            ref={(node) => { imageInputs.current[rowId] = node; }}
                            name={`choice_image_file_${index}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/avif"
                            className="sr-only"
                            disabled={pending}
                            onChange={(event) => onChoiceImageChange(rowId, event.currentTarget.files?.[0] ?? null)}
                          />
                        </label>
                        {previewUrl ? (
                          <span className="relative size-9 shrink-0 overflow-hidden rounded border border-line bg-white" title="画像プレビュー">
                            <SmartImage src={previewUrl} alt={`${value || '選択肢'}の画像`} fill sizes="36px" className="object-contain" />
                          </span>
                        ) : (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded border border-line bg-white text-[9px] text-muted">
                            画像なし
                          </span>
                        )}
                        {(imagePreviews[rowId] || imageUrl.trim()) && (
                          <button type="button" className="text-xs text-muted underline" disabled={pending} onClick={() => clearChoiceMedia(rowId)}>解除</button>
                        )}
                      </div>
                      {activeSuggestions === index && (
                        <SuggestionButtons
                          title="選択肢の候補"
                          values={suggestions.choices}
                          onSelect={(nextValue) => {
                            updateChoice(index, nextValue);
                            setActiveSuggestions(null);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="mt-1 inline-flex items-center rounded-md px-2 py-1.5 text-sm font-semibold text-brown hover:bg-ivory/50"
                  disabled={pending}
                  onClick={() => {
                    setChoiceNames((rows) => [...rows, '']);
                    setChoiceRowIds((rows) => [...rows, nextChoiceRowId.current++]);
                    setActiveSuggestions(null);
                  }}
                >
                  ＋ 選択肢を追加
                </button>
                {(state.fieldErrors?.first_choice_name || state.fieldErrors?.additional_choice_name) && (
                  <p className="text-xs text-danger">
                    {[...(state.fieldErrors.first_choice_name ?? []), ...(state.fieldErrors.additional_choice_name ?? [])].join(' / ')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2" data-testid="compact-variant-footer">
              <p className="text-xs text-muted">
                メーカー資料を優先してください。画像は任意（10MB以下）。
              </p>
              <Button type="submit" disabled={pending} className="ml-auto">
                {pending && <Spinner />}
                この選択項目を作成
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>,
    target
  );
}

export function ProductRegistrationFinalRefinements() {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [optionId, setOptionId] = useState('');
  const [categoryLabel, setCategoryLabel] = useState('');

  useEffect(() => {
    let raf = 0;

    const enhance = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => {
        refineProductImages();

        const target = document.querySelector<HTMLElement>(
          '.registration-step1-sections #customer-selection [data-testid="variant-quick-add"]'
        );
        const optionInput = document.querySelector<HTMLInputElement>(
          '.registration-step1-sections #option-main-form input[name="id"]'
        );
        const categorySelect = document.querySelector<HTMLSelectElement>(
          '.registration-step1-sections #option-main-form select[name="category_id"]'
        );
        if (!target || !optionInput?.value) {
          setPortalTarget(null);
          setOptionId('');
          setCategoryLabel('');
          return;
        }

        target.dataset.registrationCombinedCreate = 'true';
        setPortalTarget(target);
        setOptionId(optionInput.value);
        setCategoryLabel(categorySelect?.selectedOptions[0]?.textContent?.trim() ?? '');
      });
    };

    const handleChange = (event: Event) => {
      const element = event.target;
      if (element instanceof HTMLSelectElement && element.name === 'category_id') enhance();
    };

    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', handleChange, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('change', handleChange, true);
      window.cancelAnimationFrame(raf);
    };
  }, []);

  if (!portalTarget || !optionId) return null;
  return (
    <VariantCreatePortal
      target={portalTarget}
      optionId={optionId}
      categoryLabel={categoryLabel}
    />
  );
}
