'use client';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import {
  addProductImageAction,
  updateContactStatusAction,
  saveCategoryAction,
  saveModelAction,
  saveOptionAction,
  savePreviewRuleAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import {
  VIEW_KEYS,
  VIEW_LABELS,
  type BaseModel,
  type ModelPreset,
  type OptionCategory,
  type OptionConflict,
  type OptionDependency,
  type PreviewImageRule,
  type ProductOption,
  type ProductImageKind,
  type ViewKey,
} from '@/lib/domain/types';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { BASE_FLOORPLAN_NOTE, hasBaseFloorplanInternalMarker, presetFloorplanCode } from '@/lib/domain/preview-rule-meta';
import { customerPlanName, normalizePlanDisplaySize, planDisplaySizeFromSpecs, publicSpecs } from '@/lib/domain/plan-display';
import { findProductDuplicateCandidates } from '@/lib/domain/product-ledger';
import { useOptionRegistrationSave } from '@/components/admin/option-registration-save-boundary';
import { ProductDetailsFields } from '@/components/admin/product-details-fields';
import { productSizeMeta, productRegistrationGuidance, ProductCategoryGuidance } from '@/components/admin/product-category-guidance';
import { ProductSectionHeading } from '@/components/admin/product-section-heading';
import { ProductDuplicateStatus, ProductManagementNumber } from '@/components/admin/product-identity-status';

const initial: AdminFormState = { ok: false };

export function Status({ state }: { state: AdminFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.fieldErrors?._form) return <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

export function SubmitButton({ pending, label = '保存する' }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" disabled={pending} data-testid="admin-submit">
      {pending && <Spinner />}
      {label}
    </Button>
  );
}

/* ---------- ベースコンテナ ---------- */

type EditablePreset = ModelPreset & { _key: string };
type ModelFormMode = 'all' | 'basic' | 'plans';

export function ModelForm({ model, mode = 'all' }: { model: BaseModel | null; mode?: ModelFormMode }) {
  const [state, action, pending] = useActionState(saveModelAction, initial);
  const e = state.fieldErrors ?? {};
  const joinPairs = (arr: { [k: string]: string }[] | undefined, a: string, b: string) => (arr ?? []).map((x) => `${x[a]}|${x[b]}`).join('\n');

  const [planDisplaySize, setPlanDisplaySize] = useState(() =>
    normalizePlanDisplaySize(planDisplaySizeFromSpecs(model?.specs ?? []))
  );
  const [presets, setPresets] = useState<EditablePreset[]>(() =>
    (model?.presets ?? []).map((preset, index) => ({
      ...preset,
      display_name: preset.display_name ?? customerPlanName(preset, preset.name),
      _key: `${preset.code || 'plan'}-${index}`,
    }))
  );
  const [defaultPresetKey, setDefaultPresetKey] = useState(() => {
    const first = model?.presets?.[0];
    return first ? `${first.code || 'plan'}-0` : '';
  });

  const visibleSpecs = publicSpecs(model?.specs ?? []);
  const specsText = joinPairs(visibleSpecs, 'label', 'value');
  const featuresText = joinPairs(model?.features, 'title', 'body');
  const equipmentText = model?.standard_equipment.join('\n') ?? '';
  const useCasesText = model?.use_cases.join('\n') ?? '';
  const expenseRatePercent = Math.round((model?.expense_rate ?? 0.15) * 1000) / 10;

  const updatePreset = (key: string, patch: Partial<ModelPreset>) => {
    setPresets((rows) => rows.map((row) => (row._key === key ? { ...row, ...patch } : row)));
  };
  const addPreset = () => {
    const nextIndex = presets.length + 1;
    const key = `new-plan-${Date.now()}-${nextIndex}`;
    const next: EditablePreset = {
      _key: key,
      code: `plan-${nextIndex}`,
      name: '',
      display_name: '',
      description: '',
      option_codes: [],
    };
    setPresets((rows) => [...rows, next]);
    if (!defaultPresetKey) setDefaultPresetKey(key);
  };
  const removePreset = (key: string) => {
    setPresets((rows) => {
      const next = rows.filter((row) => row._key !== key);
      if (defaultPresetKey === key) setDefaultPresetKey(next[0]?._key ?? '');
      return next;
    });
  };

  const orderedPresets = useMemo(() => {
    const first = presets.find((preset) => preset._key === defaultPresetKey);
    return first ? [first, ...presets.filter((preset) => preset._key !== defaultPresetKey)] : presets;
  }, [defaultPresetKey, presets]);

  const serializedPresets = useMemo(
    () =>
      JSON.stringify(
        orderedPresets.map(({ _key: _ignored, ...preset }) => ({
          ...preset,
          code: preset.code.trim(),
          name: preset.name.trim(),
          display_name: preset.display_name?.trim() ?? '',
          description: preset.description.trim(),
          option_codes: preset.option_codes.map((code) => code.trim()).filter(Boolean),
        }))
      ),
    [orderedPresets]
  );

  const previewPreset = orderedPresets[0] ?? null;
  const previewName = customerPlanName(previewPreset, previewPreset?.name ?? '');
  const previewSize = normalizePlanDisplaySize(planDisplaySize);
  const showBasic = mode === 'all' || mode === 'basic';
  const showPlans = mode === 'all' || mode === 'plans';

  return (
    <form action={action} className="card space-y-6 p-6" noValidate>
      <input type="hidden" name="id" value={model?.id ?? ''} />
      <input type="hidden" name="presets_json" value={serializedPresets} />

      {!showBasic && (
        <>
          <input type="hidden" name="name" value={model?.name ?? ''} />
          <input type="hidden" name="slug" value={model?.slug ?? ''} />
          <input type="hidden" name="base_price" value={model?.base_price ?? 0} />
          <input type="hidden" name="expense_rate" value={expenseRatePercent} />
          <input type="hidden" name="status" value={model?.status ?? 'draft'} />
          <input type="hidden" name="sort_order" value={model?.sort_order ?? 0} />
          <input type="hidden" name="tagline" value={model?.tagline ?? ''} />
          <input type="hidden" name="description" value={model?.description ?? ''} />
          <input type="hidden" name="specs" value={specsText} />
          <input type="hidden" name="features" value={featuresText} />
          <input type="hidden" name="standard_equipment" value={equipmentText} />
          <input type="hidden" name="use_cases" value={useCasesText} />
        </>
      )}
      {!showPlans && <input type="hidden" name="plan_display_size" value={planDisplaySize} />}

      <Status state={state} />

      {showBasic && (
        <>
          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">基本情報</h2>
              <p className="mt-1 text-xs text-muted">商品名、価格、公開状態、説明文などを管理します。</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="商品名" htmlFor="name" required errors={e.name}><Input id="name" name="name" defaultValue={model?.name} required /></Field>
              <Field label="slug（URL）" htmlFor="slug" required hint="英小文字・数字・ハイフン" errors={e.slug}><Input id="slug" name="slug" defaultValue={model?.slug} required /></Field>
              <Field label="本体一式（諸費用別・税別・円）" htmlFor="base_price" required hint="見積書テンプレートの本体明細合計（諸費用を除く）" errors={e.base_price}><Input id="base_price" name="base_price" type="number" min={0} step={1} defaultValue={model?.base_price ?? 0} required data-testid="model-base-price" /></Field>
              <Field label="諸費用率（%）" htmlFor="expense_rate" required hint="本体・オプションそれぞれの小計に掛ける（テンプレート: 15%）" errors={e.expense_rate}><Input id="expense_rate" name="expense_rate" type="number" min={0} max={100} step={0.1} defaultValue={expenseRatePercent} required /></Field>
              <Field label="公開状態" htmlFor="status" required errors={e.status}>
                <Select id="status" name="status" defaultValue={model?.status ?? 'draft'}>
                  <option value="published">公開</option>
                  <option value="draft">非公開</option>
                </Select>
              </Field>
              <Field label="表示順" htmlFor="sort_order" errors={e.sort_order}><Input id="sort_order" name="sort_order" type="number" defaultValue={model?.sort_order ?? 0} /></Field>
            </div>
            <Field label="キャッチコピー" htmlFor="tagline" errors={e.tagline}><Input id="tagline" name="tagline" defaultValue={model?.tagline} /></Field>
            <Field label="説明文" htmlFor="description" errors={e.description}><Textarea id="description" name="description" defaultValue={model?.description} /></Field>
          </section>

          <section className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold">商品情報</h2>
              <p className="mt-1 text-xs text-muted">商品詳細ページなどで表示する仕様・特徴・標準装備・用途です。</p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="サイズ・仕様" htmlFor="specs" hint="1行1項目、「ラベル|値」。平面図表示サイズは「プラン・表示設定」で管理します。" errors={e.specs}>
                <Textarea id="specs" name="specs" defaultValue={specsText} className="min-h-48 font-mono text-xs" />
              </Field>
              <Field label="特徴" htmlFor="features" hint="1行1項目、「見出し|本文」" errors={e.features}><Textarea id="features" name="features" defaultValue={featuresText} className="min-h-48 font-mono text-xs" /></Field>
              <Field label="標準装備" htmlFor="standard_equipment" hint="1行1項目" errors={e.standard_equipment}><Textarea id="standard_equipment" name="standard_equipment" defaultValue={equipmentText} className="min-h-40 text-xs" /></Field>
              <Field label="用途" htmlFor="use_cases" hint="1行1項目" errors={e.use_cases}><Textarea id="use_cases" name="use_cases" defaultValue={useCasesText} className="min-h-40 text-xs" /></Field>
            </div>
          </section>
        </>
      )}

      {showPlans && (
        <>
          <section className="rounded-xl border border-line bg-ivory/50 p-4 sm:p-5">
            <div>
              <h2 className="text-lg font-semibold">お客様画面の表示設定</h2>
              <p className="mt-1 text-xs text-muted">シミュレーターの平面図見出しに表示する文言を管理します。</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="平面図表示サイズ"
                htmlFor="plan_display_size"
                hint="例：3,900×4,800。未入力なら「展開後」または「床面積」から自動表示します。"
              >
                <Input
                  id="plan_display_size"
                  name="plan_display_size"
                  value={planDisplaySize}
                  onChange={(event) => setPlanDisplaySize(event.target.value)}
                  placeholder="3,900×4,800"
                />
              </Field>
              <div>
                <p className="label">平面図タイトルのプレビュー</p>
                <div className="mt-2 rounded-lg border border-[#e8b100] bg-white px-4 py-3 text-base text-ink">
                  <span className="font-semibold">【平面図】</span>
                  {(previewName || previewSize) && (
                    <span className="ml-1">
                      {previewName}
                      {previewName && previewSize ? '/' : ''}
                      {previewSize}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted">初期仕様の「お客様表示名」を使ってプレビューします。</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">仕様（推奨構成）</h2>
                <p className="mt-1 text-xs text-muted">管理名とお客様表示名を分けて設定します。初期仕様はシミュレーターを開いたとき最初に選ばれます。見積テンプレートの「仕様」もここから選ばれます。</p>
              </div>
              <button type="button" onClick={addPreset} className="btn-secondary btn-sm">仕様を追加</button>
            </div>
            {e.presets && <p className="text-sm text-danger">{e.presets[0]}</p>}

            {presets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
                仕様がありません。「仕様を追加」から登録してください。
              </div>
            ) : (
              <div className="space-y-3">
                {presets.map((preset, index) => {
                  const displayName = customerPlanName(preset, preset.name);
                  return (
                    <div key={preset._key} className="rounded-xl border border-line bg-white p-4">
                      <div className="grid gap-4 lg:grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-ink">
                          <input
                            type="radio"
                            name="default_preset_ui"
                            checked={defaultPresetKey === preset._key}
                            onChange={() => setDefaultPresetKey(preset._key)}
                          />
                          初期
                        </label>
                        <Field label="管理名" htmlFor={`preset-name-${index}`} hint="管理画面・見積で使う名称">
                          <Input
                            id={`preset-name-${index}`}
                            value={preset.name}
                            onChange={(event) => updatePreset(preset._key, { name: event.target.value })}
                            placeholder="住宅仕様"
                          />
                        </Field>
                        <Field label="お客様表示名" htmlFor={`preset-display-${index}`} hint="平面図見出しにそのまま表示">
                          <Input
                            id={`preset-display-${index}`}
                            value={preset.display_name ?? ''}
                            onChange={(event) => updatePreset(preset._key, { display_name: event.target.value })}
                            placeholder="住宅用"
                          />
                        </Field>
                        <button type="button" className="text-sm text-danger hover:underline" onClick={() => removePreset(preset._key)}>
                          削除
                        </button>
                      </div>

                      <Field label="説明" htmlFor={`preset-description-${index}`} hint="この仕様の用途・構成を管理者向けに記載">
                        <Input
                          id={`preset-description-${index}`}
                          value={preset.description}
                          onChange={(event) => updatePreset(preset._key, { description: event.target.value })}
                          placeholder="住宅向け構成。"
                        />
                      </Field>

                      <div className="mt-3 rounded-lg bg-ivory px-3 py-2 text-sm text-ink-soft">
                        お客様表示：
                        <span className="ml-1 font-semibold text-ink">【平面図】{displayName}{displayName && previewSize ? '/' : ''}{previewSize}</span>
                      </div>

                      <details className="mt-3 rounded-lg border border-line bg-white">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-ink-soft">高度な設定</summary>
                        <div className="grid gap-4 border-t border-line p-3 sm:grid-cols-2">
                          <Field label="仕様コード" htmlFor={`preset-code-${index}`} hint="hotel / residence / office など。標準見積と連携するため通常は変更しません。">
                            <Input
                              id={`preset-code-${index}`}
                              value={preset.code}
                              onChange={(event) => updatePreset(preset._key, { code: event.target.value })}
                            />
                          </Field>
                          <Field label="オプションコード" htmlFor={`preset-options-${index}`} hint="カンマ区切り。通常は商品構成変更時だけ編集します。">
                            <Textarea
                              id={`preset-options-${index}`}
                              value={preset.option_codes.join(',')}
                              onChange={(event) =>
                                updatePreset(preset._key, {
                                  option_codes: event.target.value.split(',').map((code) => code.trim()).filter(Boolean),
                                })
                              }
                              className="min-h-20 font-mono text-xs"
                            />
                          </Field>
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <SubmitButton pending={pending} />
    </form>
  );
}

/* ---------- 商品画像 ---------- */

export function ProductImageForm({
  modelId,
  allowedKinds,
  title = '画像を追加',
}: {
  modelId: string;
  allowedKinds?: ProductImageKind[];
  title?: string;
}) {
  const [state, action, pending] = useActionState(addProductImageAction, initial);
  const e = state.fieldErrors ?? {};
  const kinds: ProductImageKind[] = allowedKinds ?? ['hero', 'exterior', 'interior', 'floorplan', 'elevation', 'transport', 'case'];
  const idPrefix = `${modelId}-${kinds.join('-')}`;
  const kindLabel = (kind: ProductImageKind) =>
    kind === 'hero'
      ? 'メイン'
      : kind === 'exterior'
        ? '外観'
        : kind === 'interior'
          ? '室内'
          : kind === 'floorplan'
            ? '平面図（商品紹介用）'
            : kind === 'elevation'
              ? '立面図'
              : kind === 'transport'
                ? '輸送・設置'
                : '施工事例';

  return (
    <form action={action} className="card space-y-4 p-6" noValidate>
      <input type="hidden" name="base_model_id" value={modelId} />
      <p className="font-semibold">{title}</p>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="種類" htmlFor={`img-kind-${idPrefix}`} required errors={e.kind}>
          <Select id={`img-kind-${idPrefix}`} name="kind" defaultValue={kinds[0] ?? 'exterior'}>
            {kinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
          </Select>
        </Field>
        <Field label="表示順" htmlFor={`img-sort-${idPrefix}`} errors={e.sort_order}><Input id={`img-sort-${idPrefix}`} name="sort_order" type="number" defaultValue={0} /></Field>
        <Field label="画像ファイル" htmlFor={`img-file-${idPrefix}`} hint="JPEG/PNG/WebP/AVIF、10MBまで"><Input id={`img-file-${idPrefix}`} name="file" type="file" accept="image/*" className="py-2" /></Field>
        <Field label="または画像URL" htmlFor={`img-url-${idPrefix}`} errors={e.url}><Input id={`img-url-${idPrefix}`} name="url" placeholder="/images/... または https://..." /></Field>
        <Field label="代替テキスト" htmlFor={`img-alt-${idPrefix}`} errors={e.alt}><Input id={`img-alt-${idPrefix}`} name="alt" /></Field>
        <Field label="キャプション" htmlFor={`img-caption-${idPrefix}`} hint="立面図は面の名称（例：正面（南））、施工事例は写真説明を入力"><Input id={`img-caption-${idPrefix}`} name="caption" /></Field>
      </div>
      <SubmitButton pending={pending} label="追加する" />
    </form>
  );
}

/* ---------- カテゴリー ---------- */

export function CategoryForm({ category }: { category: OptionCategory | null }) {
  const [state, action, pending] = useActionState(saveCategoryAction, initial);
  const e = state.fieldErrors ?? {};
  const p = category?.id ?? 'new';
  return (
    <form action={action} className="card space-y-4 p-5" noValidate>
      <input type="hidden" name="id" value={category?.id ?? ''} />
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="カテゴリー名" htmlFor={`cat-name-${p}`} required errors={e.name}><Input id={`cat-name-${p}`} name="name" defaultValue={category?.name} required /></Field>
        <Field label="分類フォルダ名" htmlFor={`cat-gname-${p}`} required hint="商品台帳の第1階層（内外装仕上げ・設備機器など）" errors={e.group_name}><Input id={`cat-gname-${p}`} name="group_name" defaultValue={category?.group_name ?? 'その他'} required /></Field>
        <Field label="分類コード" htmlFor={`cat-gcode-${p}`} required errors={e.group_code}><Input id={`cat-gcode-${p}`} name="group_code" defaultValue={category?.group_code ?? 'other'} required /></Field>
        <Field label="分類の表示順" htmlFor={`cat-gsort-${p}`} errors={e.group_sort}><Input id={`cat-gsort-${p}`} name="group_sort" type="number" defaultValue={category?.group_sort ?? 99} /></Field>
        <Field label="コード" htmlFor={`cat-code-${p}`} required errors={e.code}><Input id={`cat-code-${p}`} name="code" defaultValue={category?.code} required /></Field>
        <Field label="表示順" htmlFor={`cat-sort-${p}`} errors={e.sort_order}><Input id={`cat-sort-${p}`} name="sort_order" type="number" defaultValue={category?.sort_order ?? 0} /></Field>
        <Field label="注文範囲" htmlFor={`cat-level-${p}`} required hint="このカテゴリーを頼めるようになる範囲。本体のみ＝スケルトン注文にも必ず含まれる" errors={e.finish_level}>
          <Select id={`cat-level-${p}`} name="finish_level" defaultValue={category?.finish_level ?? 'full'}>
            <option value="shell">本体のみ（サッシ・外壁・防火・別途工事）</option>
            <option value="equipment">本体＋設備から</option>
            <option value="full">フル装備のみ（内装・造作）</option>
          </Select>
        </Field>
        <Field label="選択方式" htmlFor={`cat-mode-${p}`} required errors={e.selection_mode}>
          <Select id={`cat-mode-${p}`} name="selection_mode" defaultValue={category?.selection_mode ?? 'multi'}>
            <option value="multi">複数選択（チェックボックス）</option>
            <option value="single">1つ選択（ラジオ）</option>
          </Select>
        </Field>
        <Field label="公開状態" htmlFor={`cat-status-${p}`} required errors={e.status}>
          <Select id={`cat-status-${p}`} name="status" defaultValue={category?.status ?? 'published'}>
            <option value="published">公開</option><option value="draft">非公開</option>
          </Select>
        </Field>
        <div className="flex items-end pb-3"><Checkbox name="is_required" defaultChecked={category?.is_required} label="必ず1つ選ぶ（必須）" /></div>
        <div className="flex items-end pb-3"><Checkbox name="customer_visible" defaultChecked={category?.customer_visible ?? true} label="お客様のシミュレーターに表示（サッシ等の台帳専用はオフ）" /></div>
      </div>
      <Field label="説明" htmlFor={`cat-desc-${p}`} errors={e.description}><Input id={`cat-desc-${p}`} name="description" defaultValue={category?.description ?? ''} /></Field>
      <SubmitButton pending={pending} />
    </form>
  );
}

/* ---------- オプション ---------- */

interface OptionFormProps {
  option: ProductOption | null;
  categories: OptionCategory[];
  models: BaseModel[];
  allOptions: ProductOption[];
  dependencies: OptionDependency[];
  conflicts: OptionConflict[];
  /** 追加画面で最初に選ばれるカテゴリー（フリー商品からの導線で使う） */
  defaultCategoryId?: string;
  /** 必要に応じて商品情報の一部だけを編集するための表示モード */
  mode?: 'all' | 'product' | 'create' | 'identify' | 'details' | 'media' | 'pricing' | 'sales';
  /** 見積テンプレート等から商品登録へ移動した場合の戻り先 */
  returnTo?: string;
}

export function OptionForm({
  option,
  categories,
  models,
  allOptions,
  dependencies,
  conflicts,
  defaultCategoryId,
  mode = 'all',
  returnTo,
}: OptionFormProps) {
  const [state, action, pending] = useActionState(saveOptionAction, initial);
  const [autoSaveState, setAutoSaveState] = useState<AdminFormState>(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const {
    registerSaveHandler,
    markDirty,
    markClean,
  } = useOptionRegistrationSave();
  const autoSaveEnabled = mode === 'all' && Boolean(option);
  const hasAutoSaveState = autoSaveState.ok || Boolean(autoSaveState.error) || Boolean(autoSaveState.fieldErrors);
  const displayState = hasAutoSaveState ? autoSaveState : state;
  const e = displayState.fieldErrors ?? {};
  const others = allOptions.filter((o) => o.id !== option?.id);
  const depMap = new Map(dependencies.map((d) => [d.requires_option_id, d]));
  const confMap = new Map(conflicts.map((c) => [c.conflicts_with_option_id, c]));
  const initialCategoryId = option?.category_id ?? defaultCategoryId ?? '';
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialCategoryId);
  const [manufacturerValue, setManufacturerValue] = useState(option?.manufacturer ?? '');
  const [nameValue, setNameValue] = useState(option?.name ?? '');
  const [modelNoValue, setModelNoValue] = useState(option?.model_no ?? '');
  const [sizeNoteValue, setSizeNoteValue] = useState(option?.size_note ?? '');
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId);
  const categoryCode = selectedCategory?.code ?? '';
  const sizeMeta = productSizeMeta(categoryCode);
  const guidance = productRegistrationGuidance(categoryCode);
  const categoryOptions = allOptions.filter((row) => !selectedCategoryId || row.category_id === selectedCategoryId);
  const makerMatchedOptions = categoryOptions.filter(
    (row) => !manufacturerValue.trim() || row.manufacturer?.trim().toLocaleLowerCase('ja-JP') === manufacturerValue.trim().toLocaleLowerCase('ja-JP')
  );
  const nameMatchedOptions = makerMatchedOptions.filter(
    (row) => !nameValue.trim() || row.name.trim().toLocaleLowerCase('ja-JP') === nameValue.trim().toLocaleLowerCase('ja-JP')
  );
  const manufacturerSuggestions = Array.from(
    new Set(
      [...guidance.manufacturers, ...categoryOptions.map((row) => row.manufacturer?.trim() ?? '')].filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, 'ja'));
  const productNameSuggestions = Array.from(new Set(makerMatchedOptions.map((row) => row.name.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'ja')
  );
  const modelNoSuggestions = Array.from(
    new Set(nameMatchedOptions.map((row) => row.model_no?.trim() ?? '').filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'ja'));
  const sizeSuggestions = Array.from(
    new Set([...guidance.sizeCandidates, ...categoryOptions.map((row) => row.size_note?.trim() ?? '')].filter(Boolean))
  );
  const duplicateCandidates = useMemo(
    () =>
      findProductDuplicateCandidates(allOptions, {
        categoryId: selectedCategoryId,
        manufacturer: manufacturerValue,
        name: nameValue,
        modelNo: modelNoValue,
        excludeId: option?.id ?? null,
      }).slice(0, 3),
    [allOptions, manufacturerValue, modelNoValue, nameValue, option?.id, selectedCategoryId]
  );
  const duplicateCheckReady = Boolean(
    manufacturerValue.trim() && (modelNoValue.trim() || nameValue.trim())
  );

  const showIdentify = mode === 'all' || mode === 'product' || mode === 'create' || mode === 'identify';
  const showDetails = mode === 'all' || mode === 'product' || mode === 'details';
  const showMedia = mode === 'all' || mode === 'product' || mode === 'media';
  const showSales = mode === 'all' || mode === 'sales' || mode === 'pricing';

  const markOptionDirty = () => {
    if (!autoSaveEnabled) return;
    markDirty();
    if (hasAutoSaveState) setAutoSaveState(initial);
  };

  useEffect(() => {
    if (!autoSaveEnabled) return;
    return registerSaveHandler(async () => {
      const form = formRef.current;
      if (!form) return false;

      const result = await saveOptionAction(initial, new FormData(form));
      if (result.ok) {
        const imageUrlInput = form.elements.namedItem('image_url');
        if (imageUrlInput instanceof HTMLInputElement && result.savedImageUrl !== undefined) {
          imageUrlInput.value = result.savedImageUrl;
        }
        const imageFileInput = form.elements.namedItem('image_file');
        if (imageFileInput instanceof HTMLInputElement) imageFileInput.value = '';
        setAutoSaveState({ ...result, message: '変更内容を自動保存しました。' });
        markClean();
        return true;
      }

      setAutoSaveState(result);
      return false;
    });
  }, [autoSaveEnabled, markClean, registerSaveHandler]);

  const preserveIdentifyFields = !showIdentify && option ? (
    <>
      <input type="hidden" name="name" value={option.name} />
      <input type="hidden" name="category_id" value={option.category_id} />
      <input type="hidden" name="manufacturer" value={option.manufacturer ?? ''} />
      <input type="hidden" name="model_no" value={option.model_no ?? ''} />
    </>
  ) : null;

  const preserveDetailFields = !showDetails && option ? (
    <>
      <input type="hidden" name="size_note" value={option.size_note ?? ''} />
      <input type="hidden" name="highlight" value={option.highlight ?? ''} />
      <input type="hidden" name="description" value={option.description ?? ''} />
    </>
  ) : null;

  const preserveMediaFields = !showMedia && option ? (
    <input type="hidden" name="image_url" value={option.image_url ?? ''} />
  ) : null;

  const preserveSalesFields = !showSales && option ? (
    <>
      <input type="hidden" name="base_model_id" value={option.base_model_id ?? ''} />
      <input type="hidden" name="status" value={option.status} />
      <input type="hidden" name="sort_order" value={option.sort_order} />
      <input type="hidden" name="selection_type" value={option.selection_type} />
      {option.spec_codes.map((code) => <input key={`spec-${code}`} type="hidden" name="spec_codes" value={code} />)}
      {option.is_default && <input type="hidden" name="is_default" value="true" />}
      {option.is_required && <input type="hidden" name="is_required" value="true" />}
      {option.is_installation && <input type="hidden" name="is_installation" value="true" />}
      <input type="hidden" name="list_price" value={option.list_price ?? ''} />
      <input type="hidden" name="price" value={option.price} />
      {option.price_on_request && <input type="hidden" name="price_on_request" value="true" />}
      <input type="hidden" name="preview_key" value={option.preview_key ?? ''} />
      {option.affects_views.map((view) => <input key={`view-${view}`} type="hidden" name="affects_views" value={view} />)}
      {dependencies.map((dep) => (
        <span key={`dep-${dep.requires_option_id}`} className="hidden">
          <input type="hidden" name="requires" value={dep.requires_option_id} />
          <input type="hidden" name={`requires_message_${dep.requires_option_id}`} value={dep.message ?? ''} />
        </span>
      ))}
      {conflicts.map((conflict) => (
        <span key={`conf-${conflict.conflicts_with_option_id}`} className="hidden">
          <input type="hidden" name="conflicts" value={conflict.conflicts_with_option_id} />
          <input type="hidden" name={`conflicts_message_${conflict.conflicts_with_option_id}`} value={conflict.message ?? ''} />
        </span>
      ))}
    </>
  ) : null;

  const createDefaults = mode === 'create' && !option ? (
    <>
      <input type="hidden" name="base_model_id" value="" />
      <input type="hidden" name="description" value="" />
      <input type="hidden" name="highlight" value="" />
      <input type="hidden" name="image_url" value="" />
      <input type="hidden" name="price" value="0" />
      <input type="hidden" name="selection_type" value="radio" />
      <input type="hidden" name="preview_key" value="" />
      <input type="hidden" name="list_price" value="" />
      <input type="hidden" name="sort_order" value="0" />
      <input type="hidden" name="status" value="draft" />
    </>
  ) : null;

  return (
    <form
      ref={formRef}
      id={autoSaveEnabled ? 'option-main-form' : undefined}
      action={action}
      className="space-y-6"
      noValidate
      onChangeCapture={autoSaveEnabled ? markOptionDirty : undefined}
    >
      <input type="hidden" name="id" value={option?.id ?? ''} />
      <input type="hidden" name="owner_id" value={option?.owner_id ?? ''} />
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      {preserveIdentifyFields}
      {preserveDetailFields}
      {preserveMediaFields}
      {preserveSalesFields}
      {createDefaults}
      <Status state={displayState} />

      {showIdentify && (
        <section id="product-identify" className="card space-y-4 p-4 sm:p-5 scroll-mt-6">
          <ProductSectionHeading
            label={mode === 'identify' ? '商品特定' : '1. 基本情報'}
            description={mode === 'create'
              ? 'まず商品を特定する基本情報だけ入力します。「次へ」で商品を作成し、続けて画像・資料や価格を登録します。'
              : 'カテゴリー、メーカー、商品名、シリーズ・型番／品番で商品を特定します。商品管理番号は保存時に自動で割り当てます。'}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="カテゴリー" htmlFor={`category_id-${mode}`} required errors={e.category_id}>
              <Select
                id={`category_id-${mode}`}
                name="category_id"
                defaultValue={initialCategoryId}
                onChange={(event) => setSelectedCategoryId(event.target.value)}
              >
                {!initialCategoryId && <option value="" disabled>カテゴリーを選択してください</option>}
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
            </Field>
            <Field label="メーカー" htmlFor={`manufacturer-${mode}`} hint="カテゴリー別候補＋登録済みメーカーから選べます。候補外も直接入力できます" errors={e.manufacturer}>
              <Input
                id={`manufacturer-${mode}`}
                name="manufacturer"
                list="option-manufacturer-suggestions"
                defaultValue={option?.manufacturer ?? ''}
                onChange={(event) => setManufacturerValue(event.target.value)}
                placeholder="例：TOTO"
              />
              <datalist id="option-manufacturer-suggestions">
                {manufacturerSuggestions.map((value) => <option key={value} value={value} />)}
              </datalist>
            </Field>
            <Field label="商品名" htmlFor={`name-${mode}`} hint="選んだカテゴリー・メーカーの登録済み商品名を候補表示します" required errors={e.name}>
              <Input
                id={`name-${mode}`}
                name="name"
                list="option-product-name-suggestions"
                defaultValue={option?.name}
                onChange={(event) => setNameValue(event.target.value)}
                required
                data-testid="option-name"
              />
              <datalist id="option-product-name-suggestions">
                {productNameSuggestions.map((value) => <option key={value} value={value} />)}
              </datalist>
            </Field>
            <Field
              label="シリーズ・型番／品番"
              htmlFor={`model_no-${mode}`}
              hint="現在の商品マスターではシリーズ名と型番・品番を1項目で管理します。カテゴリー・メーカー・商品名に合う既存値を候補表示します"
              errors={e.model_no}
            >
              <Input
                id={`model_no-${mode}`}
                name="model_no"
                list="option-model-no-suggestions"
                defaultValue={option?.model_no ?? ''}
                onChange={(event) => setModelNoValue(event.target.value)}
                placeholder="例：サザナ HTシリーズ / HTV1616"
              />
              <datalist id="option-model-no-suggestions">
                {modelNoSuggestions.map((value) => <option key={value} value={value} />)}
              </datalist>
            </Field>
            {mode === 'create' && (
              <Field
                label={sizeMeta.label}
                htmlFor="size_note-create"
                hint={sizeSuggestions.length > 0 ? '候補から選ぶか、そのまま自由入力できます' : undefined}
                errors={e.size_note}
              >
                <Input
                  id="size_note-create"
                  name="size_note"
                  list="option-size-note-suggestions-create"
                  value={sizeNoteValue}
                  onChange={(event) => setSizeNoteValue(event.target.value)}
                  placeholder={sizeMeta.placeholder}
                />
                <datalist id="option-size-note-suggestions-create">
                  {sizeSuggestions.map((value) => <option key={value} value={value} />)}
                </datalist>
                {guidance.sizeCandidates.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2" aria-label="カテゴリー別の入力候補">
                    {guidance.sizeCandidates.slice(0, 10).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft hover:border-brown hover:text-ink"
                        onClick={() => {
                          setSizeNoteValue(value);
                          markOptionDirty();
                        }}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            )}
            {mode === 'all' && (
              <ProductManagementNumber
                number={option?.product_no}
                fallback={option ? '未採番' : '保存時に自動採番'}
              />
            )}
          </div>

          <ProductDuplicateStatus
            testId="option-duplicate-status"
            warningTestId="option-duplicate-warning"
            ready={duplicateCheckReady}
            candidates={duplicateCandidates.map(({ option: candidate, reason }) => ({
              id: candidate.id,
              name: candidate.name,
              productNo: candidate.product_no ?? null,
              reason,
              modelNo: candidate.model_no,
              manufacturer: candidate.manufacturer,
            }))}
          />

          {mode === 'create' && <SubmitButton pending={pending} label="次へ：画像・資料" />}
          {mode === 'identify' && <SubmitButton pending={pending} label="商品特定を保存" />}
        </section>
      )}

      {showDetails && (
        <section id="product-details" className="card space-y-4 p-4 sm:p-5 scroll-mt-6">
          <ProductSectionHeading
            label="2. 商品の詳細"
            description="サイズ、説明、メーカー資料に記載された特徴など、商品を理解するための情報を整理します。"
          />

          <ProductCategoryGuidance categoryCode={categoryCode} />

          <ProductDetailsFields
            sizeField={
                <Field label={sizeMeta.label} htmlFor={`size_note-${mode}`} hint={sizeSuggestions.length > 0 ? '候補から選ぶか、そのまま自由入力できます' : undefined} errors={e.size_note}>
                  <Input
                    id={`size_note-${mode}`}
                    name="size_note"
                    list="option-size-note-suggestions"
                    value={sizeNoteValue}
                    onChange={(event) => setSizeNoteValue(event.target.value)}
                    placeholder={sizeMeta.placeholder}
                  />
                  <datalist id="option-size-note-suggestions">
                    {sizeSuggestions.map((value) => <option key={value} value={value} />)}
                  </datalist>
                  {guidance.sizeCandidates.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2" aria-label="カテゴリー別の入力候補">
                      {guidance.sizeCandidates.slice(0, 10).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className="rounded-full border border-line bg-white px-2.5 py-1 text-xs text-ink-soft hover:border-brown hover:text-ink"
                          onClick={() => {
                            setSizeNoteValue(value);
                            markOptionDirty();
                          }}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
            }
            highlightId={`highlight-${mode}`}
            highlight={option?.highlight ?? ''}
            highlightErrors={e.highlight}
            descriptionId={`description-${mode}`}
            description={option?.description ?? ''}
            descriptionErrors={e.description}
          />

          <p className="text-xs text-muted">
            固定の商品構成・標準装備は、メーカー資料で確認できるものまで無理に個別登録する必要はありません。
            お客様が選ぶ項目、価格に影響する項目、発注に必要な項目を優先してください。
          </p>

          {mode === 'details' && <SubmitButton pending={pending} label="商品の詳細を保存" />}
        </section>
      )}

      {showMedia && (
        <section id="product-main-media" className="card space-y-4 p-4 sm:p-5 scroll-mt-6">
          <ProductSectionHeading
            label="3. 商品画像"
            description="ここでは商品一覧・商品詳細の先頭に表示するメイン画像を設定します。追加画像は下の専用欄で登録します。"
          />

          <div className="rounded-xl border border-line bg-ivory/35 p-4 sm:p-5">
            <div>
              <p className="font-semibold">メイン画像</p>
              <p className="mt-1 text-xs text-muted">サブ画像とメーカーPDFは、この商品の「お客様資料」画面で続けて登録できます。</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="画像URL" htmlFor={`image_url-${mode}`} errors={e.image_url}>
                <Input id={`image_url-${mode}`} name="image_url" defaultValue={option?.image_url ?? ''} />
              </Field>
              <Field label="または画像ファイル" htmlFor={`image_file-${mode}`}>
                <Input id={`image_file-${mode}`} name="image_file" type="file" accept="image/*" className="py-2" />
              </Field>
            </div>
          </div>

          {mode === 'media' && <SubmitButton pending={pending} label="メイン画像を保存" />}
        </section>
      )}

      {mode === 'product' && <SubmitButton pending={pending} label="商品情報を保存" />}

      {showSales && (
        <section id="sales-settings" className="card space-y-4 p-4 sm:p-5 scroll-mt-6">
          <ProductSectionHeading
            label={mode === 'sales' ? '販売・詳細設定' : '6. 価格・対象モデル'}
            description="商品価格、対象モデル・公開状態を確認します。色・仕様ごとの価格も同じ商品情報画面で設定します。"
          />

          <div className="rounded-xl border border-line bg-white p-4 sm:p-5">
            <p className="font-semibold">価格</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="商品価格（税別・円）" htmlFor={`price-${mode}`} required hint="価格未確認なら0円のまま下書き保存できます。0円で公開する場合はSTEP 2で確認します。標準品との差額は別途の計算で扱います" errors={e.price}>
                <Input id={`price-${mode}`} name="price" type="number" min={0} step={1000} defaultValue={option?.price ?? 0} required data-testid="option-price" />
              </Field>
              <Field label="メーカー参考価格（税別・表示のみ）" htmlFor={`list_price-${mode}`} errors={e.list_price}>
                <Input id={`list_price-${mode}`} name="list_price" type="number" min={0} step={1} defaultValue={option?.list_price ?? ''} />
              </Field>
            </div>
            <div className="mt-4">
              <Checkbox name="price_on_request" defaultChecked={option?.price_on_request} label="価格は別途見積（0円扱い）" />
              <p className="mt-2 text-xs leading-5 text-muted">
                単に価格が未確認なだけの場合は「別途見積」にせず、0円の下書きとして保存してください。
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-white p-4 sm:p-5" data-testid="option-normal-settings">
            <div>
              <p className="font-semibold">通常設定</p>
              <p className="mt-1 text-xs text-muted">通常の商品登録では、対象モデルと公開状態だけ確認します。</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="対象モデル" htmlFor={`base_model_id-${mode}`} hint="通常は全モデル共通。特定モデル専用の商品だけ変更します" errors={e.base_model_id}>
                <Select id={`base_model_id-${mode}`} name="base_model_id" defaultValue={option?.base_model_id ?? ''}>
                  <option value="">全モデル共通</option>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </Select>
              </Field>
              {option?.status === 'published' ? (
                <Field
                  label="公開状態"
                  htmlFor={`status-${mode}`}
                  required
                  hint="公開中の商品を下書きへ戻すことはできます。下書きからの再公開はSTEP 2で行います"
                  errors={e.status}
                >
                  <Select id={`status-${mode}`} name="status" defaultValue="published">
                    <option value="published">公開</option>
                    <option value="draft">下書きへ戻す</option>
                  </Select>
                </Field>
              ) : (
                <div>
                  <p className="label">公開状態</p>
                  <input type="hidden" name="status" value="draft" />
                  <div className="input flex min-h-11 items-center bg-sand/35 text-sm font-semibold text-ink-soft">下書き</div>
                  <p className="mt-1 text-xs text-muted">
                    {option
                      ? '下書き商品の公開はSTEP 2のお客様表示を確認してから行います。'
                      : '新規商品は下書きで保存し、STEP 2のお客様表示を確認してから公開します。'}
                  </p>
                </div>
              )}
            </div>
          </div>

          <details className="rounded-xl border border-line bg-ivory/30">
            <summary className="cursor-pointer px-4 py-4 font-semibold sm:px-5">
              詳細設定
              <span className="ml-2 text-xs font-normal text-muted">通常は変更不要</span>
            </summary>
            <div className="space-y-6 border-t border-line p-4 sm:p-5">
              <section className="space-y-4" data-testid="option-advanced-display-settings">
                <div>
                  <p className="font-semibold">シミュレーター表示条件</p>
                  <p className="mt-1 text-xs text-muted">通常は変更不要です。表示順・仕様限定・標準選択などを調整する場合だけ使用します。</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="表示順" htmlFor={`sort_order-${mode}`} errors={e.sort_order}>
                    <Input id={`sort_order-${mode}`} name="sort_order" type="number" defaultValue={option?.sort_order ?? 0} />
                  </Field>
                  <div>
                    <p className="label">対応する仕様</p>
                    <p className="mb-2 text-xs text-muted">未選択なら全仕様で表示します。</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {[['hotel', 'ホテル仕様'], ['residence', '住宅仕様'], ['office', '事務所・店舗用']].map(([code, label]) => (
                        <Checkbox key={code} name="spec_codes" value={code} defaultChecked={option?.spec_codes.includes(code)} label={label} />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Checkbox name="is_default" defaultChecked={option?.is_default} label="初期状態で選択" />
                  <Checkbox name="is_required" defaultChecked={option?.is_required} label="必須（解除不可）" />
                  <Checkbox name="is_installation" defaultChecked={option?.is_installation} label="設置関連費用として集計" />
                </div>
              </section>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="選択方式（表示）" htmlFor={`selection_type-${mode}`} errors={e.selection_type}>
                  <Select id={`selection_type-${mode}`} name="selection_type" defaultValue={option?.selection_type ?? 'checkbox'}>
                    <option value="checkbox">チェックボックス</option>
                    <option value="radio">ラジオボタン</option>
                  </Select>
                </Field>
                <Field label="プレビューキー" htmlFor={`preview_key-${mode}`} hint="完成イメージ切替の識別子。空なら画像に影響しません" errors={e.preview_key}>
                  <Input id={`preview_key-${mode}`} name="preview_key" defaultValue={option?.preview_key ?? ''} />
                </Field>
                <div>
                  <p className="label">反映するビュー</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
                    {VIEW_KEYS.map((view) => (
                      <Checkbox key={view} name="affects_views" value={view} defaultChecked={option?.affects_views.includes(view)} label={VIEW_LABELS[view]} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-line bg-white p-4">
                  <p className="font-semibold">選択に必要な前提オプション</p>
                  <p className="text-xs text-muted">特殊な組み合わせ条件がある場合だけ設定します。</p>
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {others.map((other) => (
                      <li key={other.id} className="space-y-1">
                        <Checkbox name="requires" value={other.id} defaultChecked={depMap.has(other.id)} label={other.name} />
                        <Input name={`requires_message_${other.id}`} defaultValue={depMap.get(other.id)?.message ?? ''} placeholder="表示メッセージ（任意）" className="min-h-9 text-xs" />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-3 rounded-xl border border-line bg-white p-4">
                  <p className="font-semibold">同時に選択できないオプション</p>
                  <p className="text-xs text-muted">特殊な排他条件がある場合だけ設定します。</p>
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {others.map((other) => (
                      <li key={other.id} className="space-y-1">
                        <Checkbox name="conflicts" value={other.id} defaultChecked={confMap.has(other.id)} label={other.name} />
                        <Input name={`conflicts_message_${other.id}`} defaultValue={confMap.get(other.id)?.message ?? ''} placeholder="表示メッセージ（任意）" className="min-h-9 text-xs" />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </details>

          {!(mode === 'all' && option) && (
            <SubmitButton
              pending={pending}
              label={
                mode === 'pricing'
                  ? '価格・公開設定を保存'
                  : mode === 'all'
                    ? '下書きを作成してSTEP 1を続ける'
                    : '販売・詳細設定を保存'
              }
            />
          )}
        </section>
      )}
    </form>
  );
}

/* ---------- プレビュー画像ルール ---------- */

export function PreviewRuleForm({
  rule,
  models,
  previewKeys,
  defaults,
}: {
  rule: PreviewImageRule | null;
  models: BaseModel[];
  previewKeys: { key: string; label: string }[];
  defaults?: { base_model_id?: string; view?: ViewKey; keys?: string[]; alt?: string; internalNote?: string; presetCode?: string };
}) {
  const [state, action, pending] = useActionState(savePreviewRuleAction, initial);
  const e = state.fieldErrors ?? {};
  const selectedKeys = new Set(rule?.preview_keys ?? defaults?.keys ?? []);
  const selectedKeyLabels = previewKeys.filter((k) => selectedKeys.has(k.key)).map((k) => k.label);
  const internalNote = rule && hasBaseFloorplanInternalMarker(rule) ? BASE_FLOORPLAN_NOTE : defaults?.internalNote;
  const protectedPresetCode = (rule ? presetFloorplanCode(rule) : null) ?? defaults?.presetCode ?? null;
  const hasProtectedInternalNote = internalNote === BASE_FLOORPLAN_NOTE;
  const hasProtectedPreset = Boolean(protectedPresetCode);
  const hasProtectedFloorplanIdentity = hasProtectedInternalNote || hasProtectedPreset;
  const protectedModelId = rule?.base_model_id ?? defaults?.base_model_id ?? models[0]?.id ?? '';

  return (
    <form action={action} className="card space-y-5 p-6" noValidate>
      <input type="hidden" name="id" value={rule?.id ?? ''} />
      {hasProtectedFloorplanIdentity && (
        <>
          {hasProtectedInternalNote && <input type="hidden" name="internal_note" value={BASE_FLOORPLAN_NOTE} />}
          {protectedPresetCode && <input type="hidden" name="preset_code" value={protectedPresetCode} />}
          <input type="hidden" name="base_model_id" value={protectedModelId} />
          <input type="hidden" name="view" value="floorplan" />
          <input type="hidden" name="kind" value="composite" />
        </>
      )}
      <Status state={state} />

      <div>
        <p className="font-semibold">{rule ? '画像を変更' : '画像を登録'}</p>
        <p className="mt-1 text-xs text-muted">
          {selectedKeyLabels.length > 0 ? `対応条件：${selectedKeyLabels.join(' + ')}` : '対応条件：標準状態'}
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="新しい画像ファイル" htmlFor="pr-file" hint={rule ? 'ファイルを選ぶと現在の画像を差し替えます。JPEG/PNG/WebP/AVIF、10MBまで' : 'JPEG/PNG/WebP/AVIF、10MBまで'}>
          <Input id="pr-file" name="file" type="file" accept="image/*" className="py-2" />
        </Field>
        <Field label="代替テキスト" htmlFor="pr-alt" errors={e.alt}>
          <Input id="pr-alt" name="alt" defaultValue={rule?.alt ?? defaults?.alt ?? ''} />
        </Field>
        {hasProtectedFloorplanIdentity ? (
          <div className="rounded-lg border border-line bg-ivory/60 px-3 py-2 text-xs text-muted">
            {hasProtectedInternalNote
              ? '本体専用平面図の識別情報は内部で固定されています。通常の補足欄からは変更できません。'
              : 'この標準仕様専用平面図の識別情報は内部で固定されています。通常は変更不要です。'}
          </div>
        ) : (
          <Field label="補足" htmlFor="pr-note" hint="必要な場合だけ画面に小さく表示します" errors={e.note}>
            <Input id="pr-note" name="note" defaultValue={rule?.note ?? ''} />
          </Field>
        )}
        <Field label="公開状態" htmlFor="pr-status" errors={e.status}>
          <Select id="pr-status" name="status" defaultValue={rule?.status ?? 'published'}>
            <option value="published">公開</option>
            <option value="draft">非公開</option>
          </Select>
        </Field>
      </div>

      <details className="rounded-xl border border-line bg-ivory/50 p-4">
        <summary className="cursor-pointer text-sm font-semibold">詳細設定</summary>
        <p className="mt-2 text-xs text-muted">通常の画像差し替えでは変更不要です。表示条件やレイヤー方式を調整するときだけ使用します。</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Field label="ベースコンテナ" htmlFor="pr-model" required errors={e.base_model_id}>
            <Select
              id="pr-model"
              name="base_model_id"
              defaultValue={protectedModelId}
              disabled={hasProtectedFloorplanIdentity}
            >
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="ビュー" htmlFor="pr-view" required errors={e.view}>
            <Select
              id="pr-view"
              name="view"
              defaultValue={hasProtectedFloorplanIdentity ? 'floorplan' : (rule?.view ?? defaults?.view ?? 'exterior')}
              disabled={hasProtectedInternalNote}
            >
              {VIEW_KEYS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
            </Select>
          </Field>
          <Field label="方式" htmlFor="pr-kind" required hint="完成画像は通常こちら。レイヤーは透過PNGを重ねる場合に使用" errors={e.kind}>
            <Select
              id="pr-kind"
              name="kind"
              defaultValue={hasProtectedFloorplanIdentity ? 'composite' : (rule?.kind ?? 'composite')}
              disabled={hasProtectedInternalNote}
            >
              <option value="composite">完成画像</option>
              <option value="layer">レイヤー</option>
            </Select>
          </Field>
          <Field label="重ね順（レイヤー用）" htmlFor="pr-z" errors={e.z_index}>
            <Input id="pr-z" name="z_index" type="number" defaultValue={rule?.z_index ?? 0} />
          </Field>
          <Field label="画像URL" htmlFor="pr-url" hint="ファイルを選ばない場合に使用します" errors={e.url}>
            <Input id="pr-url" name="url" defaultValue={rule?.url ?? ''} placeholder="/images/... または https://..." data-testid="preview-rule-url" />
          </Field>
        </div>
        <div className="mt-5">
          <p className="label">対応するプレビューキー（画像に写っている設備）</p>
          {hasProtectedFloorplanIdentity ? (
            <p className="mt-2 text-xs text-muted">
              {hasProtectedInternalNote
                ? '本体専用平面図はプレビューキーなし（空配列）で固定されています。'
                : 'この標準仕様専用平面図はプレビューキーなし（空配列）で固定されています。'}
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted">何も選ばなければ標準状態です。レイヤー方式では通常1つだけ選びます。</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {previewKeys.map((k) => (
                  <Checkbox key={k.key} name="preview_keys" value={k.key} defaultChecked={selectedKeys.has(k.key)} label={<>{k.label} <span className="text-xs text-muted">({k.key})</span></>} />
                ))}
              </div>
            </>
          )}
        </div>
      </details>

      <SubmitButton pending={pending} label={rule ? '画像を変更する' : '登録する'} />
    </form>
  );
}

/* ---------- お問い合わせ ---------- */

export function ContactStatusForm({ id, status }: { id: string; status: 'new' | 'handled' }) {
  const [state, action, pending] = useActionState(updateContactStatusAction, initial);
  const next = status === 'new' ? 'handled' : 'new';
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" disabled={pending} className="text-xs underline underline-offset-4 hover:text-ink disabled:opacity-50">
        {next === 'handled' ? '対応済みにする' : '未対応に戻す'}
      </button>
      {state.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
