'use client';

import { useActionState } from 'react';
import {
  addProductImageAction,
  updateContactStatusAction,
  saveCategoryAction,
  saveModelAction,
  saveOptionAction,
  savePreviewRuleAction,
  updateQuoteStatusAction,
  type AdminFormState,
} from '@/lib/actions/admin';
import {
  QUOTE_REQUEST_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  VIEW_KEYS,
  VIEW_LABELS,
  type BaseModel,
  type OptionCategory,
  type OptionConflict,
  type OptionDependency,
  type PreviewImageRule,
  type ProductOption,
  type Quote,
  type QuoteRequest,
  type ViewKey,
} from '@/lib/domain/types';
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Textarea } from '@/components/ui';

const initial: AdminFormState = { ok: false };

function Status({ state }: { state: AdminFormState }) {
  if (state.error) return <Alert tone="danger">{state.error}</Alert>;
  if (state.fieldErrors?._form) return <Alert tone="danger">{state.fieldErrors._form[0]}</Alert>;
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

function SubmitButton({ pending, label = '保存する' }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" disabled={pending} data-testid="admin-submit">
      {pending && <Spinner />}
      {label}
    </Button>
  );
}

/* ---------- ベースコンテナ ---------- */

export function ModelForm({ model }: { model: BaseModel | null }) {
  const [state, action, pending] = useActionState(saveModelAction, initial);
  const e = state.fieldErrors ?? {};
  const joinPairs = (arr: { [k: string]: string }[] | undefined, a: string, b: string) => (arr ?? []).map((x) => `${x[a]}|${x[b]}`).join('\n');
  return (
    <form action={action} className="card space-y-5 p-6" noValidate>
      <input type="hidden" name="id" value={model?.id ?? ''} />
      <Status state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="商品名" htmlFor="name" required errors={e.name}><Input id="name" name="name" defaultValue={model?.name} required /></Field>
        <Field label="slug（URL）" htmlFor="slug" required hint="英小文字・数字・ハイフン" errors={e.slug}><Input id="slug" name="slug" defaultValue={model?.slug} required /></Field>
        <Field label="本体一式（諸費用別・税別・円）" htmlFor="base_price" required hint="見積書テンプレートの本体明細合計（諸費用を除く）" errors={e.base_price}><Input id="base_price" name="base_price" type="number" min={0} step={1} defaultValue={model?.base_price ?? 0} required data-testid="model-base-price" /></Field>
        <Field label="諸費用率（%）" htmlFor="expense_rate" required hint="本体・オプションそれぞれの小計に掛ける（テンプレート: 15%）" errors={e.expense_rate}><Input id="expense_rate" name="expense_rate" type="number" min={0} max={100} step={0.1} defaultValue={Math.round((model?.expense_rate ?? 0.15) * 1000) / 10} required /></Field>
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
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="サイズ・仕様" htmlFor="specs" hint="1行1項目、「ラベル|値」" errors={e.specs}><Textarea id="specs" name="specs" defaultValue={joinPairs(model?.specs, 'label', 'value')} className="min-h-48 font-mono text-xs" /></Field>
        <Field label="特徴" htmlFor="features" hint="1行1項目、「見出し|本文」" errors={e.features}><Textarea id="features" name="features" defaultValue={joinPairs(model?.features, 'title', 'body')} className="min-h-48 font-mono text-xs" /></Field>
        <Field label="標準装備" htmlFor="standard_equipment" hint="1行1項目" errors={e.standard_equipment}><Textarea id="standard_equipment" name="standard_equipment" defaultValue={model?.standard_equipment.join('\n')} className="min-h-40 text-xs" /></Field>
        <Field label="用途" htmlFor="use_cases" hint="1行1項目" errors={e.use_cases}><Textarea id="use_cases" name="use_cases" defaultValue={model?.use_cases.join('\n')} className="min-h-40 text-xs" /></Field>
      </div>
      <Field label="プラン（推奨構成）" htmlFor="presets" hint="1行1プラン、「コード|プラン名|説明|オプションコード,オプションコード,…」。先頭のプランがシミュレーターの初期構成になります" errors={e.presets}>
        <Textarea id="presets" name="presets" defaultValue={(model?.presets ?? []).map((p) => `${p.code}|${p.name}|${p.description}|${p.option_codes.join(',')}`).join('\n')} className="min-h-32 font-mono text-xs" />
      </Field>
      <SubmitButton pending={pending} />
    </form>
  );
}

/* ---------- 商品画像 ---------- */

export function ProductImageForm({ modelId }: { modelId: string }) {
  const [state, action, pending] = useActionState(addProductImageAction, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="card space-y-4 p-6" noValidate>
      <input type="hidden" name="base_model_id" value={modelId} />
      <p className="font-semibold">画像を追加</p>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="種類" htmlFor="img-kind" required errors={e.kind}>
          <Select id="img-kind" name="kind" defaultValue="exterior">
            <option value="hero">メイン</option><option value="exterior">外観</option><option value="interior">室内</option><option value="floorplan">平面図</option><option value="transport">輸送・設置</option><option value="case">施工事例</option>
          </Select>
        </Field>
        <Field label="表示順" htmlFor="img-sort" errors={e.sort_order}><Input id="img-sort" name="sort_order" type="number" defaultValue={0} /></Field>
        <Field label="画像ファイル" htmlFor="img-file" hint="JPEG/PNG/WebP、10MBまで"><Input id="img-file" name="file" type="file" accept="image/*" className="py-2" /></Field>
        <Field label="または画像URL" htmlFor="img-url" errors={e.url}><Input id="img-url" name="url" placeholder="/images/... または https://..." /></Field>
        <Field label="代替テキスト" htmlFor="img-alt" errors={e.alt}><Input id="img-alt" name="alt" /></Field>
        <Field label="キャプション" htmlFor="img-caption" errors={e.caption}><Input id="img-caption" name="caption" /></Field>
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
}

export function OptionForm({ option, categories, models, allOptions, dependencies, conflicts }: OptionFormProps) {
  const [state, action, pending] = useActionState(saveOptionAction, initial);
  const e = state.fieldErrors ?? {};
  const others = allOptions.filter((o) => o.id !== option?.id);
  const depMap = new Map(dependencies.map((d) => [d.requires_option_id, d]));
  const confMap = new Map(conflicts.map((c) => [c.conflicts_with_option_id, c]));
  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="id" value={option?.id ?? ''} />
      <Status state={state} />
      <div className="card space-y-5 p-6">
        <p className="font-semibold">基本情報</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="名称" htmlFor="name" required errors={e.name}><Input id="name" name="name" defaultValue={option?.name} required data-testid="option-name" /></Field>
          <Field label="コード" htmlFor="code" required hint="英小文字・数字・ハイフン（一意）" errors={e.code}><Input id="code" name="code" defaultValue={option?.code} required /></Field>
          <Field label="カテゴリー" htmlFor="category_id" required errors={e.category_id}>
            <Select id="category_id" name="category_id" defaultValue={option?.category_id ?? categories[0]?.id}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="対象モデル" htmlFor="base_model_id" errors={e.base_model_id}>
            <Select id="base_model_id" name="base_model_id" defaultValue={option?.base_model_id ?? ''}>
              <option value="">全モデル共通</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="価格（税別・円）" htmlFor="price" required errors={e.price}><Input id="price" name="price" type="number" min={0} step={1000} defaultValue={option?.price ?? 0} required data-testid="option-price" /></Field>
          <Field label="表示順" htmlFor="sort_order" errors={e.sort_order}><Input id="sort_order" name="sort_order" type="number" defaultValue={option?.sort_order ?? 0} /></Field>
          <Field label="選択方式（表示）" htmlFor="selection_type" errors={e.selection_type}>
            <Select id="selection_type" name="selection_type" defaultValue={option?.selection_type ?? 'checkbox'}>
              <option value="checkbox">チェックボックス</option><option value="radio">ラジオボタン</option>
            </Select>
          </Field>
          <Field label="公開状態" htmlFor="status" required errors={e.status}>
            <Select id="status" name="status" defaultValue={option?.status ?? 'published'}>
              <option value="published">公開</option><option value="draft">非公開</option>
            </Select>
          </Field>
        </div>
        <Field label="説明" htmlFor="description" errors={e.description}><Textarea id="description" name="description" defaultValue={option?.description ?? ''} className="min-h-24" /></Field>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox name="is_default" defaultChecked={option?.is_default} label="初期状態で選択（おすすめ構成）" />
          <Checkbox name="is_required" defaultChecked={option?.is_required} label="必須（解除不可）" />
          <Checkbox name="is_installation" defaultChecked={option?.is_installation} label="設置関連費用として集計" />
          <Checkbox name="price_on_request" defaultChecked={option?.price_on_request} label="価格は別途見積（0円扱い）" />
        </div>
      </div>

      <div className="card space-y-5 p-6">
        <p className="font-semibold">画像・プレビュー</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="オプション画像（ファイル）" htmlFor="image_file"><Input id="image_file" name="image_file" type="file" accept="image/*" className="py-2" /></Field>
          <Field label="または画像URL" htmlFor="image_url" errors={e.image_url}><Input id="image_url" name="image_url" defaultValue={option?.image_url ?? ''} /></Field>
          <Field label="プレビューキー" htmlFor="preview_key" hint="完成イメージ切替の識別子（例: bath）。空なら画像に影響しない" errors={e.preview_key}><Input id="preview_key" name="preview_key" defaultValue={option?.preview_key ?? ''} /></Field>
          <div>
            <p className="label">反映するビュー</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
              {VIEW_KEYS.map((v) => <Checkbox key={v} name="affects_views" value={v} defaultChecked={option?.affects_views.includes(v)} label={VIEW_LABELS[v]} />)}
            </div>
          </div>
          <div>
            <p className="label">対応する仕様</p>
            <p className="mb-2 text-xs text-muted">すべて未選択なら全仕様で表示されます。</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {[['hotel', 'ホテル仕様'], ['residence', '住宅仕様'], ['office', '事務所・店舗用']].map(([code, label]) => (
                <Checkbox key={code} name="spec_codes" value={code} defaultChecked={option?.spec_codes.includes(code)} label={label} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3 p-6">
          <p className="font-semibold">選択に必要な前提オプション</p>
          <p className="text-xs text-muted">選択時に自動追加され、前提を先に外すことはできなくなります。</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {others.map((o) => (
              <li key={o.id} className="space-y-1">
                <Checkbox name="requires" value={o.id} defaultChecked={depMap.has(o.id)} label={o.name} />
                <Input name={`requires_message_${o.id}`} defaultValue={depMap.get(o.id)?.message ?? ''} placeholder="表示メッセージ（任意）" className="min-h-9 text-xs" />
              </li>
            ))}
          </ul>
        </div>
        <div className="card space-y-3 p-6">
          <p className="font-semibold">同時に選択できないオプション</p>
          <p className="text-xs text-muted">相手が選択中のとき、このオプションは理由付きで選べなくなります。</p>
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {others.map((o) => (
              <li key={o.id} className="space-y-1">
                <Checkbox name="conflicts" value={o.id} defaultChecked={confMap.has(o.id)} label={o.name} />
                <Input name={`conflicts_message_${o.id}`} defaultValue={confMap.get(o.id)?.message ?? ''} placeholder="表示メッセージ（任意）" className="min-h-9 text-xs" />
              </li>
            ))}
          </ul>
        </div>
      </div>
      <SubmitButton pending={pending} />
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
  defaults?: { base_model_id?: string; view?: ViewKey; keys?: string[] };
}) {
  const [state, action, pending] = useActionState(savePreviewRuleAction, initial);
  const e = state.fieldErrors ?? {};
  const selectedKeys = new Set(rule?.preview_keys ?? defaults?.keys ?? []);
  return (
    <form action={action} className="card space-y-5 p-6" noValidate>
      <input type="hidden" name="id" value={rule?.id ?? ''} />
      <Status state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="ベースコンテナ" htmlFor="pr-model" required errors={e.base_model_id}>
          <Select id="pr-model" name="base_model_id" defaultValue={rule?.base_model_id ?? defaults?.base_model_id ?? models[0]?.id}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="ビュー" htmlFor="pr-view" required errors={e.view}>
          <Select id="pr-view" name="view" defaultValue={rule?.view ?? defaults?.view ?? 'exterior'}>
            {VIEW_KEYS.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
          </Select>
        </Field>
        <Field label="方式" htmlFor="pr-kind" required hint="完成画像: キー集合が完全一致で表示／レイヤー: ベース層＋キーごとの透過PNGを重ねる" errors={e.kind}>
          <Select id="pr-kind" name="kind" defaultValue={rule?.kind ?? 'composite'}>
            <option value="composite">完成画像（composite）</option>
            <option value="layer">レイヤー（layer）</option>
          </Select>
        </Field>
        <Field label="重ね順（レイヤー用）" htmlFor="pr-z" errors={e.z_index}><Input id="pr-z" name="z_index" type="number" defaultValue={rule?.z_index ?? 0} /></Field>
      </div>
      <div>
        <p className="label">対応するプレビューキー（写っている設備）</p>
        <p className="mb-2 text-xs text-muted">何も選ばなければ「標準状態（ベース）」の画像になります。レイヤー方式では1つだけ選びます。</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {previewKeys.map((k) => (
            <Checkbox key={k.key} name="preview_keys" value={k.key} defaultChecked={selectedKeys.has(k.key)} label={<>{k.label} <span className="text-xs text-muted">({k.key})</span></>} />
          ))}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="画像ファイル" htmlFor="pr-file" hint="レイヤーは位置の揃った透過PNG"><Input id="pr-file" name="file" type="file" accept="image/*" className="py-2" /></Field>
        <Field label="または画像URL" htmlFor="pr-url" errors={e.url}><Input id="pr-url" name="url" defaultValue={rule?.url ?? ''} placeholder="/images/... または https://..." data-testid="preview-rule-url" /></Field>
        <Field label="代替テキスト" htmlFor="pr-alt" errors={e.alt}><Input id="pr-alt" name="alt" defaultValue={rule?.alt ?? ''} /></Field>
        <Field label="補足（画面に小さく表示）" htmlFor="pr-note" errors={e.note}><Input id="pr-note" name="note" defaultValue={rule?.note ?? ''} /></Field>
        <Field label="公開状態" htmlFor="pr-status" errors={e.status}>
          <Select id="pr-status" name="status" defaultValue={rule?.status ?? 'published'}>
            <option value="published">公開</option><option value="draft">非公開</option>
          </Select>
        </Field>
      </div>
      <SubmitButton pending={pending} />
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

/* ---------- 見積ステータス ---------- */

export function QuoteStatusForm({ quote, request }: { quote: Quote; request: QuoteRequest | null }) {
  const [state, action, pending] = useActionState(updateQuoteStatusAction, initial);
  return (
    <form action={action} className="card space-y-4 p-6" noValidate>
      <input type="hidden" name="quote_id" value={quote.id} />
      <p className="font-semibold">ステータス変更</p>
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="見積書の状態" htmlFor="q-status" required>
          <Select id="q-status" name="status" defaultValue={quote.status}>
            {Object.entries(QUOTE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="見積依頼の対応状況" htmlFor="q-req-status">
          <Select id="q-req-status" name="request_status" defaultValue={request?.status ?? ''}>
            <option value="">変更しない</option>
            {Object.entries(QUOTE_REQUEST_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
      </div>
      <SubmitButton pending={pending} label="更新する" />
    </form>
  );
}
