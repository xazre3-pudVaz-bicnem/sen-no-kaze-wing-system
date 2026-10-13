'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  createVariantGroupWithFirstChoiceAction,
  type ProductVariantCreateState,
} from '@/lib/actions/product-registration-variants';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

const initialState: ProductVariantCreateState = { ok: false };

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
    <div className="mt-2 rounded-lg border border-line bg-white p-3">
      <p className="text-xs font-semibold text-ink-soft">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className="rounded-full border border-line bg-ivory/30 px-2.5 py-1 text-xs text-ink-soft hover:border-brown hover:text-ink"
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
  const [standardIndex, setStandardIndex] = useState(0);
  const [activeSuggestions, setActiveSuggestions] = useState<'group' | number | null>(null);
  const categoryName = normalizeCategoryLabel(categoryLabel);
  const suggestions = suggestionsForCategory(categoryLabel);

  const resetChoiceForm = () => {
    setGroupName('');
    setChoiceNames(['']);
    setStandardIndex(0);
    setActiveSuggestions(null);
  };

  const updateChoice = (index: number, value: string) => {
    setChoiceNames((rows) => rows.map((row, rowIndex) => (rowIndex === index ? value : row)));
  };

  const removeChoice = (index: number) => {
    if (choiceNames.length <= 1) return;
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
    <div className="space-y-3" data-combined-create-root="true">
      <div>
        <p className="text-sm font-semibold">選択項目を追加</p>
        <p className="mt-1 text-xs text-muted">カテゴリーに合う候補から選ぶか、そのまま自由入力できます。</p>
      </div>

      {!open ? (
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => {
            setState(initialState);
            resetChoiceForm();
            setOpen(true);
          }}
        >
          ＋ 選択項目を追加
        </button>
      ) : (
        <div className="rounded-xl border border-dashed border-line bg-ivory/20 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">選択項目を追加</p>
              {categoryName && <p className="mt-1 text-xs text-muted">{categoryName}の入力候補を表示します。</p>}
            </div>
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

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
            <input type="hidden" name="option_id" value={optionId} />
            <input type="hidden" name="first_choice_name" value={choiceNames[standardIndex] ?? ''} />
            {choiceNames.map((value, index) =>
              index === standardIndex ? null : (
                <input key={`additional-choice-hidden-${index}`} type="hidden" name="additional_choice_name" value={value} />
              )
            )}

            <Field
              label="選択項目名"
              htmlFor="registration-variant-group-name"
              hint="例：床／周辺パネル／アクセントパネル／浴槽。候補外も自由入力できます。"
              required
              errors={state.fieldErrors?.name}
            >
              <Input
                id="registration-variant-group-name"
                name="name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                onFocus={() => setActiveSuggestions('group')}
                placeholder="例：周辺パネル"
                autoComplete="off"
                required
              />
              {activeSuggestions === 'group' && (
                <SuggestionButtons
                  title="選択項目名の候補"
                  values={suggestions.groups}
                  onSelect={(value) => {
                    setGroupName(value);
                    setActiveSuggestions(0);
                  }}
                />
              )}
            </Field>

            <div className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">選択肢 <span className="text-red-700">必須</span></p>
                  <p className="mt-1 text-xs text-muted">お客様が選べる候補をまとめて入力し、その中から標準にするものを1つ選びます。</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={pending}
                  onClick={() => {
                    setChoiceNames((rows) => [...rows, '']);
                    setActiveSuggestions(choiceNames.length);
                  }}
                >
                  ＋ 選択肢を追加
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {choiceNames.map((value, index) => {
                  const isStandard = standardIndex === index;
                  return (
                    <div
                      key={`choice-${index}`}
                      className={`rounded-lg border p-3 ${isStandard ? 'border-brown bg-ivory/40' : 'border-line bg-white'}`}
                    >
                      <div className="flex items-start gap-3">
                        <label className="mt-7 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-soft">
                          <input
                            type="radio"
                            name="standard_choice_index"
                            value={index}
                            checked={isStandard}
                            onChange={() => setStandardIndex(index)}
                          />
                          標準
                        </label>
                        <div className="min-w-0 flex-1">
                          <Field
                            label={`選択肢 ${index + 1}`}
                            htmlFor={`registration-choice-${index}`}
                            required={isStandard}
                            errors={
                              isStandard
                                ? state.fieldErrors?.first_choice_name
                                : state.fieldErrors?.additional_choice_name
                            }
                          >
                            <Input
                              id={`registration-choice-${index}`}
                              value={value}
                              onChange={(event) => updateChoice(index, event.target.value)}
                              onFocus={() => setActiveSuggestions(index)}
                              placeholder="例：ホワイト／グレー／ブラック"
                              autoComplete="off"
                              required={isStandard}
                            />
                            {activeSuggestions === index && (
                              <SuggestionButtons
                                title="選択肢の候補"
                                values={suggestions.choices}
                                onSelect={(nextValue) => updateChoice(index, nextValue)}
                              />
                            )}
                          </Field>
                        </div>
                        {choiceNames.length > 1 && (
                          <button
                            type="button"
                            className="mt-7 shrink-0 text-xs text-muted underline underline-offset-4"
                            disabled={pending}
                            onClick={() => removeChoice(index)}
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-muted">
              候補は入力補助です。実際の商品で選べる名称はメーカー資料を優先してください。選択肢ごとの画像は登録しません。
            </p>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              この選択項目を作成
            </Button>
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
