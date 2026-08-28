'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowRight, Save } from 'lucide-react';
import { saveConfigurationAction } from '@/lib/actions/configurations';
import { computePricing, formatYen } from '@/lib/domain/pricing';
import { resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { categoriesInScope, defaultSelection, explainBlocked, pruneToScope, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
import { baseBreakdownTotal, defaultVariantIdsFor, pruneHiddenVariantChoices } from '@/lib/domain/preset';
import { FINISH_LEVELS, FINISH_LEVEL_INFO, VIEW_KEYS, finishLevelRank, type CatalogBundle, type ConfigurationStatus, type FinishLevel, type ViewKey } from '@/lib/domain/types';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Alert, Breadcrumbs, Button } from '@/components/ui';
import { FinishLevelPicker } from './finish-level-picker';
import { PlanBoard } from './plan-board';
import { EquipmentBoard } from './equipment-board';
import { QuoteSheet } from './quote-sheet';
import { PreviewStage } from './preview-stage';
import { OptionPickerDialog } from './option-picker-dialog';
import { SaveDialog } from './save-dialog';
import { Toasts, type Toast } from './toasts';
import { cn } from '@/lib/utils';

export interface SimulatorInitial {
  id: string;
  name: string;
  option_ids: string[];
  variant_choice_ids: string[];
  status: ConfigurationStatus;
  finish_level: FinishLevel;
  /** 仕様（hotel / residence / office）。本体内訳の解決に使う */
  spec_code: string | null;
}

interface Props {
  bundle: CatalogBundle;
  /** 立面図（モデル共通の図面。現状は Wing のみ） */
  elevations: { url: string; label: string; alt: string }[];
  initial: SimulatorInitial | null;
  loadError: string | null;
  resume: boolean;
  user: { id: string; name: string } | null;
}

interface Draft {
  selected: string[];
  variantIds?: string[];
  finishLevel?: FinishLevel;
  spec?: string;
  name: string;
  configId: string | null;
  pending: 'save' | 'quote' | null;
  savedAt: number;
}

const storageKey = (slug: string) => `wing:sim:${slug}`;

/** 選ばれている商品ごとに、標準の選択肢を選ぶ（表示条件つきの項目は条件を満たすときだけ） */
function defaultVariantIds(bundle: CatalogBundle, optionIds: string[]): string[] {
  return defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, optionIds);
}

export function SimulatorApp({ bundle, elevations, initial, loadError, resume, user }: Props) {
  const router = useRouter();
  const { model } = bundle;
  const ctx = useMemo<RuleContext>(
    () => ({ options: bundle.options, categories: bundle.categories, dependencies: bundle.dependencies, conflicts: bundle.conflicts }),
    [bundle]
  );
  const defaults = useMemo(() => defaultSelection(ctx), [ctx]);

  /** 仕様（ホテル／住宅／事務所）＝ presets。選ぶと標準構成が入る */
  const presetSelections = useMemo(() => {
    const byCode = new Map(bundle.options.map((o) => [o.code, o.id]));
    return (model.presets ?? []).map((p) => {
      let cur: string[] = [];
      for (const code of p.option_codes) {
        const oid = byCode.get(code);
        if (!oid) continue;
        const r = toggleOption(ctx, cur, oid);
        if (!r.rejected) cur = r.next;
      }
      for (const oid of defaults) {
        if (cur.includes(oid)) continue;
        const o = bundle.options.find((x) => x.id === oid);
        const cat = bundle.categories.find((c) => c.id === o?.category_id);
        const hasCat = cur.some((x) => bundle.options.find((y) => y.id === x)?.category_id === cat?.id);
        if (o?.is_required || (cat?.is_required && !hasCat)) {
          const r = toggleOption(ctx, cur, oid);
          if (!r.rejected) cur = r.next;
        }
      }
      return { code: p.code, ids: [...new Set(cur)] };
    });
  }, [bundle, ctx, defaults, model.presets]);

  const initialLevel: FinishLevel = initial?.finish_level ?? 'full';
  const initialSelection = pruneToScope(ctx, initial?.option_ids ?? presetSelections[0]?.ids ?? defaults, initialLevel);

  const [finishLevel, setFinishLevel] = useState<FinishLevel>(initialLevel);
  const [selected, setSelected] = useState<string[]>(initialSelection);
  /** 選ばれた商品バリエーション（壁色・扉色など）の選択肢 ID */
  const [variantIds, setVariantIds] = useState<string[]>(() =>
    // 保存済みの選択肢も表示条件で洗う（例：全面ホワイトなのに壁色が残っている旧データ）
    pruneHiddenVariantChoices(
      bundle.variantGroups,
      bundle.variantChoices,
      initial?.variant_choice_ids ?? defaultVariantIds(bundle, initialSelection)
    )
  );
  const [specCode, setSpecCode] = useState<string>(initial?.spec_code ?? model.presets?.[0]?.code ?? 'hotel');
  const [picker, setPicker] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? `${model.name} の仕様`);
  const [configId, setConfigId] = useState<string | null>(initial?.id ?? null);
  const [status, setStatus] = useState<ConfigurationStatus>(initial?.status ?? 'draft');
  const [view, setView] = useState<ViewKey>('exterior');
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<null | 'save' | 'quote'>(null);
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const resumed = useRef(false);

  const readOnly = status !== 'draft';
  const specName = model.presets?.find((p) => p.code === specCode)?.name ?? '';

  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const tid = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id: tid, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), 5000);
  }, []);

  // ---- ログイン前の選択を保持 ----
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey(model.slug));
      const draft: Draft | null = raw ? JSON.parse(raw) : null;
      if (!initial && draft) {
        const valid = draft.selected.filter((sid) => bundle.options.some((o) => o.id === sid));
        if (draft.finishLevel) setFinishLevel(draft.finishLevel);
        if (draft.spec) setSpecCode(draft.spec);
        if (draft.variantIds?.length) setVariantIds(draft.variantIds);
        if (valid.length) setSelected(valid);
        if (draft.name) setName(draft.name);
        if (draft.configId) setConfigId(draft.configId);
        if (resume && user && draft.pending && !resumed.current) {
          resumed.current = true;
          setDialog(draft.pending);
          draft.pending = null;
          window.localStorage.setItem(storageKey(model.slug), JSON.stringify(draft));
        }
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persistDraft = useCallback(
    (patch: Partial<Draft> = {}) => {
      if (typeof window === 'undefined') return;
      const draft: Draft = { selected, variantIds, finishLevel, spec: specCode, name, configId, pending: null, savedAt: Date.now(), ...patch };
      window.localStorage.setItem(storageKey(model.slug), JSON.stringify(draft));
    },
    [selected, variantIds, finishLevel, specCode, name, configId, model.slug]
  );

  useEffect(() => {
    if (hydrated) persistDraft();
  }, [hydrated, persistDraft]);

  // ---- 仕様で絞り込んだカタログ ----
  const specOptions = useMemo(
    () => bundle.options.filter((o) => o.spec_codes.length === 0 || o.spec_codes.includes(specCode)),
    [bundle.options, specCode]
  );
  /** 注文範囲に入っているカテゴリー（本体のみ → サッシ・外壁・断熱・防火・別途工事だけ） */
  // customer_visible=false のカテゴリー（サッシ等）は本体に含めるためお客様には出さない
  const scopedCategories = useMemo(
    () => categoriesInScope(bundle.categories, finishLevel).filter((c) => c.customer_visible !== false),
    [bundle.categories, finishLevel]
  );
  const scopedCategoryIds = useMemo(() => new Set(scopedCategories.map((c) => c.id)), [scopedCategories]);
  // 防火仕様は注文範囲の下の別枠で選ぶため、設備一覧には出さない
  const specCategories = useMemo(
    () => scopedCategories.filter((c) => c.code !== 'fireproof' && specOptions.some((o) => o.category_id === c.id)),
    [scopedCategories, specOptions]
  );
  /** 注文範囲を外れたカテゴリーの商品はポップアップにも出さない */
  const scopedOptions = useMemo(() => specOptions.filter((o) => scopedCategoryIds.has(o.category_id)), [specOptions, scopedCategoryIds]);

  // ---- 計算・画像解決 ----
  /** 本体内訳マスター（仕様別）の合計。登録があれば本体一式をこれで上書きする */
  const baseOverride = useMemo(() => baseBreakdownTotal(bundle, specCode), [bundle, specCode]);
  const pricing = useMemo(
    () =>
      computePricing(
        model,
        bundle.options,
        bundle.categories,
        selected.map((sid) => ({ option_id: sid, variant_choice_ids: variantIds })),
        undefined,
        { groups: bundle.variantGroups, choices: bundle.variantChoices },
        baseOverride
      ),
    [model, bundle, selected, variantIds, baseOverride]
  );
  /** 各注文範囲を選んだ場合の概算合計（カードに出す目安）。現在の仕様の標準構成で計算する */
  const levelTotals = useMemo(() => {
    const preset = presetSelections.find((x) => x.code === specCode) ?? presetSelections[0];
    const base = preset?.ids ?? defaults;
    const out: Partial<Record<FinishLevel, number>> = {};
    for (const lv of FINISH_LEVELS) {
      const ids = pruneToScope(ctx, lv === finishLevel ? selected : base, lv);
      out[lv] = computePricing(
        model,
        bundle.options,
        bundle.categories,
        ids.map((sid) => ({ option_id: sid })),
        undefined,
        undefined,
        baseBreakdownTotal(bundle, specCode)
      ).total;
    }
    return out;
  }, [ctx, model, bundle, presetSelections, specCode, defaults, selected, finishLevel]);

  const issues = useMemo(() => validateSelection(ctx, selected, finishLevel), [ctx, selected, finishLevel]);
  const blocked = useMemo(() => explainBlocked(ctx, selected), [ctx, selected]);
  const previews = useMemo(
    () =>
      Object.fromEntries(
        VIEW_KEYS.map((v) => [v, resolvePreview(bundle.previewRules, v, selectedPreviewKeys(bundle.options, selected, v))])
      ) as Record<ViewKey, ReturnType<typeof resolvePreview>>,
    [bundle, selected]
  );
  const perspective = useMemo(() => {
    const l = previews.exterior.layers[0];
    return l ? { url: l.url, alt: l.alt } : null;
  }, [previews.exterior]);
  const thumbnailUrl = previews.exterior.layers[0]?.url ?? previews.interior.layers[0]?.url ?? null;

  // ---- 操作 ----
  const applyPreset = (code: string) => {
    setSpecCode(code);
    if (readOnly) return;
    const p = presetSelections.find((x) => x.code === code);
    if (!p) return;
    const nextSel = pruneToScope(ctx, p.ids, finishLevel);
    setSelected(nextSel);
    setVariantIds(defaultVariantIds(bundle, nextSel));
    setDirty(true);
    pushToast(`「${model.presets.find((x) => x.code === code)?.name ?? code}」の標準構成を読み込みました`, 'success');
  };

  /**
   * 注文範囲の切り替え。
   * 狭めるときは範囲外の選択を落とし、広げるときは仕様の標準構成から不足分を補う。
   */
  const changeFinishLevel = (level: FinishLevel) => {
    if (readOnly || level === finishLevel) return;
    const widening = finishLevelRank(level) > finishLevelRank(finishLevel);
    if (widening) {
      const preset = presetSelections.find((x) => x.code === specCode) ?? presetSelections[0];
      const wanted = pruneToScope(ctx, preset?.ids ?? defaults, level);
      let cur = selected;
      for (const oid of wanted) {
        if (cur.includes(oid)) continue;
        const r = toggleOption(ctx, cur, oid);
        if (!r.rejected) cur = r.next;
      }
      setSelected(cur);
    } else {
      const kept = pruneToScope(ctx, selected, level);
      const dropped = selected.length - kept.length;
      setSelected(kept);
      if (dropped > 0) pushToast(`注文範囲を外れた ${dropped} 点を見積から外しました`, 'info');
    }
    setFinishLevel(level);
    setDirty(true);
    pushToast(`「${FINISH_LEVEL_INFO[level].name}」で見積を作ります`, 'success');
  };

  const applyPicker = (categoryId: string, nextInCategory: string[], nextVariants: string[] = []) => {
    const inCategory = bundle.options.filter((o) => o.category_id === categoryId).map((o) => o.id);
    let cur = selected;
    const notices: string[] = [];

    // 解除を先に行う。依存されている項目（例: 洗面器 ← 混合水栓）は依存元を外すまで解除できないため、
    // 進捗がなくなるまで繰り返し、最後まで残ったものだけ理由を通知する。
    let pending = inCategory.filter((oid) => cur.includes(oid) && !nextInCategory.includes(oid));
    while (pending.length) {
      const rest: string[] = [];
      let progressed = false;
      for (const oid of pending) {
        const r = toggleOption(ctx, cur, oid);
        if (r.rejected) rest.push(oid);
        else {
          cur = r.next;
          notices.push(...r.notices);
          progressed = true;
        }
      }
      if (!progressed) {
        for (const oid of rest) {
          const r = toggleOption(ctx, cur, oid);
          if (r.notices[0]) notices.push(r.notices[0]);
        }
        break;
      }
      pending = rest;
    }

    for (const oid of inCategory) {
      if (!nextInCategory.includes(oid) || cur.includes(oid)) continue;
      const r = toggleOption(ctx, cur, oid);
      if (r.rejected) notices.push(r.notices[0]);
      else {
        cur = r.next;
        notices.push(...r.notices);
      }
    }

    setSelected(cur);
    // このカテゴリーの商品に紐づく選択肢を入れ替える
    const catOptionIds = new Set(inCategory);
    const groupIds = new Set(bundle.variantGroups.filter((g) => catOptionIds.has(g.option_id)).map((g) => g.id));
    setVariantIds((prev) => [
      ...prev.filter((cid) => {
        const gid = bundle.variantChoices.find((c) => c.id === cid)?.group_id;
        return !gid || !groupIds.has(gid);
      }),
      ...nextVariants,
    ]);
    setDirty(true);
    setPicker(null);
    notices.forEach((n) => pushToast(n, 'info'));
  };

  const openPicker = (categoryId: string) => {
    if (readOnly) {
      pushToast('見積依頼済みの仕様は編集できません。マイページから複製してください。', 'warn');
      return;
    }
    setPicker(categoryId);
  };

  const reset = () => {
    const p = presetSelections.find((x) => x.code === specCode) ?? presetSelections[0];
    setSelected(pruneToScope(ctx, p?.ids ?? defaults, finishLevel));
    setDirty(true);
    pushToast('標準構成に戻しました', 'info');
  };

  // ---- 保存・見積依頼 ----
  const requireLogin = (pending: 'save' | 'quote') => {
    persistDraft({ pending });
    router.push(`/login?next=${encodeURIComponent(`/simulator/${model.slug}?resume=1`)}`);
  };

  const doSave = (saveName: string, then: 'stay' | 'quote') => {
    setSaveError(null);
    startSaving(async () => {
      const result = await saveConfigurationAction({
        id: configId,
        base_model_id: model.id,
        name: saveName,
        option_ids: selected,
        preview_image_url: thumbnailUrl,
        notes: null,
        finish_level: finishLevel,
        variant_choice_ids: variantIds,
        spec_code: specCode,
      });
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') {
          requireLogin(then === 'quote' ? 'quote' : 'save');
          return;
        }
        setSaveError(result.error);
        return;
      }
      setName(saveName);
      setConfigId(result.configuration.id);
      setStatus(result.configuration.status);
      setDirty(false);
      persistDraft({ name: saveName, configId: result.configuration.id });
      setDialog(null);
      if (then === 'quote') {
        router.push(`/mypage/configurations/${result.configuration.id}/request-quote`);
        return;
      }
      pushToast('マイページに保存しました', 'success');
      router.replace(`/simulator/${model.slug}?c=${result.configuration.id}`, { scroll: false });
    });
  };

  const handleSaveClick = () => {
    if (!user) return requireLogin('save');
    setDialog('save');
  };
  const handleQuoteClick = () => {
    if (issues.length) {
      pushToast(issues[0].message, 'warn');
      return;
    }
    if (!user) return requireLogin('quote');
    setDialog('quote');
  };

  const fireproofCat = bundle.categories.find((c) => c.code === 'fireproof');
  const fireproofOptions = bundle.options
    .filter((o) => o.category_id === fireproofCat?.id && o.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order);
  const fireproofChosen = fireproofOptions.find((o) => selected.includes(o.id));

  return (
    <div className="bg-paper">
      <div className="container-x pt-5 sm:pt-8">
        <Breadcrumbs
          items={[
            { name: 'ホーム', path: '/' },
            { name: '商品一覧', path: '/products' },
            { name: model.name, path: `/products/${model.slug}` },
            { name: '見積シミュレーター' },
          ]}
        />

        {/* 商品名 ＋ 仕様タブ ＋ 防火仕様（先方モックアップの上部） */}
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-en text-forest">Simulator</p>
            <h1 className="mt-1 text-2xl sm:text-4xl">
              {model.name}
              {specName && <span className="text-xl sm:text-3xl">（{specName}）</span>}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {user ? (
              <span className="text-ink-soft">
                {user.name} さん｜
                <Link href="/mypage" className="underline underline-offset-4">
                  マイページ
                </Link>
              </span>
            ) : (
              <span className="text-ink-soft">
                保存には{' '}
                <Link href={`/login?next=${encodeURIComponent(`/simulator/${model.slug}?resume=1`)}`} className="underline underline-offset-4">
                  ログイン
                </Link>{' '}
                が必要です（選択内容は保持されます）
              </span>
            )}
          </div>
        </div>

        {/* 仕様の切り替え */}
        {(model.presets?.length ?? 0) > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-y border-line py-3">
            <span className="mr-1 text-xs font-semibold text-muted">仕様</span>
            {model.presets.map((p) => (
              <button
                key={p.code}
                type="button"
                onClick={() => applyPreset(p.code)}
                disabled={readOnly}
                aria-pressed={specCode === p.code}
                title={p.description}
                className={cn(
                  'rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:opacity-50',
                  specCode === p.code ? 'border-brown bg-brown text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
                )}
                data-testid={`preset-${p.code}`}
              >
                {p.name}
              </button>
            ))}
            <button
              type="button"
              onClick={reset}
              disabled={readOnly}
              className="ml-auto text-xs text-muted underline underline-offset-4 hover:text-ink disabled:opacity-40"
            >
              標準構成に戻す
            </button>
          </div>
        )}

        {loadError && (
          <Alert tone="warn" className="mt-4">
            {loadError}
          </Alert>
        )}
        {readOnly && (
          <Alert tone="info" className="mt-4">
            この仕様は見積依頼済みのため編集できません。変更する場合は
            <Link href="/mypage" className="mx-1 font-semibold underline">
              マイページ
            </Link>
            から複製してください。
          </Alert>
        )}
      </div>

      {/* どこまで頼むか */}
      <div className="mt-6">
        <FinishLevelPicker value={finishLevel} totals={levelTotals} readOnly={readOnly} onChange={changeFinishLevel} />
      </div>

      {/* 防火／非防火（先方の本体分類表の最上位項目。標準＝非防火） */}
      {fireproofCat && (
        <div className="container-x mt-4">
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-3"
            data-testid="fireproof-picker"
          >
            <span className="text-sm font-semibold">防火仕様</span>
            <span className="text-xs text-muted">建築する場所によって異なります（標準＝非防火）</span>
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {fireproofOptions.map((o) => {
                const active = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={active}
                    onClick={() => !active && applyPicker(fireproofCat.id, [o.id])}
                    className={cn(
                      'rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:opacity-50',
                      active ? 'border-brown bg-brown text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
                    )}
                    data-testid={`fireproof-${o.code}`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>
            {fireproofChosen?.price_on_request && (
              <p className="w-full text-xs text-warn">
                防火仕様の金額は場所の条件により異なるため、見積書には「防火仕様（別途見積）」と明記され、本部が本体明細を確認のうえ確定します。
              </p>
            )}
          </div>
        </div>
      )}

      {/* 図面（左）＋ 標準設備及び仕上げ表（右） */}
      <div className="container-x grid gap-6 py-6 lg:grid-cols-[minmax(0,52fr)_minmax(0,48fr)] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-4">
          <PlanBoard
            plan={previews.floorplan}
            categories={bundle.categories}
            elevations={elevations}
            perspective={perspective}
            readOnly={readOnly}
            onPickCategory={openPicker}
          />
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-24">
          <EquipmentBoard categories={specCategories} options={scopedOptions} selected={selected} readOnly={readOnly} onPickCategory={openPicker} />

          {/* 完成イメージ（外観・室内・水まわり） */}
          <PreviewStage previews={previews} view={view} onViewChange={setView} options={bundle.options} modelName={model.name} />

          {issues.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-warn/10 px-4 py-3 text-xs text-warn" role="alert">
              {issues.map((i, idx) => (
                <li key={idx}>{i.message}</li>
              ))}
            </ul>
          )}

          <div className="hidden gap-2 lg:flex">
            <Button variant="secondary" onClick={handleSaveClick} disabled={saving || readOnly} className="flex-1" data-testid="save-button">
              <Save className="size-4" aria-hidden="true" />
              一時保存
            </Button>
            <Button onClick={handleQuoteClick} disabled={saving} className="flex-1" data-testid="quote-button">
              見積を依頼する
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {/* 御見積書 */}
      <div className="container-x pb-10">
        <QuoteSheet
          modelName={model.name}
          specName={specName}
          finishLevel={finishLevel}
          pricing={pricing}
          categories={bundle.categories}
          options={bundle.options}
          readOnly={readOnly}
          onPickCategory={openPicker}
        />
        <p className="mt-3 text-xs text-muted">{PRICE_DISCLAIMER}</p>
      </div>

      {/* SP: 固定フッター */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.7rem] text-muted">概算合計（税込）</p>
            <p className="font-serif text-2xl leading-none">{formatYen(pricing.total)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleSaveClick} disabled={saving || readOnly} aria-label="一時保存" data-testid="save-button-sp">
              <Save className="size-4" aria-hidden="true" />
              保存
            </Button>
            <Button size="sm" onClick={handleQuoteClick} disabled={saving} data-testid="quote-button-sp">
              見積依頼
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      {picker && (
        <OptionPickerDialog
          category={bundle.categories.find((c) => c.id === picker)!}
          options={scopedOptions.filter((o) => o.category_id === picker)}
          selectedIds={selected}
          blocked={blocked}
          variantGroups={bundle.variantGroups}
          variantChoices={bundle.variantChoices}
          selectedVariantIds={variantIds}
          onClose={() => setPicker(null)}
          onApply={(next, nextVariants) => applyPicker(picker, next, nextVariants)}
        />
      )}
      {dialog && (
        <SaveDialog
          mode={dialog}
          initialName={name}
          saving={saving}
          error={saveError}
          total={pricing.total}
          onClose={() => {
            setDialog(null);
            setSaveError(null);
          }}
          onSubmit={(n) => doSave(n, dialog === 'quote' ? 'quote' : 'stay')}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(tid) => setToasts((t) => t.filter((x) => x.id !== tid))} />
      <div data-testid="simulator" data-hydrated={hydrated ? 'true' : 'false'} className="sr-only" aria-hidden="true">
        {configId ? (dirty ? '未保存の変更あり' : '保存済み') : '未保存'}
      </div>
    </div>
  );
}
