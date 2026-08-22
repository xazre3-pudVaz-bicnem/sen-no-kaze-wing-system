'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowRight, Save } from 'lucide-react';
import { saveConfigurationAction } from '@/lib/actions/configurations';
import { computePricing, formatYen } from '@/lib/domain/pricing';
import { resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { defaultSelection, explainBlocked, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
import { VIEW_KEYS, type CatalogBundle, type ConfigurationStatus, type ViewKey } from '@/lib/domain/types';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { Alert, Breadcrumbs, Button } from '@/components/ui';
import { OptionPanel } from './option-panel';
import { PreviewStage } from './preview-stage';
import { SummaryPanel } from './summary-panel';
import { SaveDialog } from './save-dialog';
import { OptionPickerDialog } from './option-picker-dialog';
import { Toasts, type Toast } from './toasts';

export interface SimulatorInitial {
  id: string;
  name: string;
  option_ids: string[];
  status: ConfigurationStatus;
}

interface Props {
  bundle: CatalogBundle;
  initial: SimulatorInitial | null;
  loadError: string | null;
  resume: boolean;
  user: { id: string; name: string } | null;
}

interface Draft {
  selected: string[];
  name: string;
  configId: string | null;
  pending: 'save' | 'quote' | null;
  savedAt: number;
}

const storageKey = (slug: string) => `wing:sim:${slug}`;

export function SimulatorApp({ bundle, initial, loadError, resume, user }: Props) {
  const router = useRouter();
  const { model } = bundle;
  const ctx = useMemo<RuleContext>(
    () => ({ options: bundle.options, categories: bundle.categories, dependencies: bundle.dependencies, conflicts: bundle.conflicts }),
    [bundle]
  );
  const defaults = useMemo(() => defaultSelection(ctx), [ctx]);
  /** プラン（presets）をオプション ID の集合に展開。前提・必須を満たすよう toggle を通す */
  const presetSelections = useMemo(() => {
    const byCode = new Map(bundle.options.map((o) => [o.code, o.id]));
    return (model.presets ?? []).map((p) => {
      let cur: string[] = [];
      for (const code of p.option_codes) {
        const id = byCode.get(code);
        if (!id) continue;
        const r = toggleOption(ctx, cur, id);
        if (!r.rejected) cur = r.next;
      }
      for (const id of defaults) {
        if (cur.includes(id)) continue;
        const opt = bundle.options.find((o) => o.id === id);
        const cat = bundle.categories.find((c) => c.id === opt?.category_id);
        const hasCat = cur.some((x) => bundle.options.find((o) => o.id === x)?.category_id === cat?.id);
        if (opt?.is_required || (cat?.is_required && !hasCat)) {
          const r = toggleOption(ctx, cur, id);
          if (!r.rejected) cur = r.next;
        }
      }
      return { code: p.code, ids: [...new Set(cur)] };
    });
  }, [bundle, ctx, defaults, model.presets]);
  const initialSelection = initial?.option_ids ?? presetSelections[0]?.ids ?? defaults;

  const [selected, setSelected] = useState<string[]>(initialSelection);
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

  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  // ---- ローカル保存（ログイン前の選択を保持） ----
  // SSR と初期描画を一致させるため、マウント後に localStorage の下書きを state へ反映する
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey(model.slug));
      const draft: Draft | null = raw ? JSON.parse(raw) : null;
      if (!initial && draft) {
        const valid = draft.selected.filter((id) => bundle.options.some((o) => o.id === id));
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
      const draft: Draft = { selected, name, configId, pending: null, savedAt: Date.now(), ...patch };
      window.localStorage.setItem(storageKey(model.slug), JSON.stringify(draft));
    },
    [selected, name, configId, model.slug]
  );

  useEffect(() => {
    if (hydrated) persistDraft();
  }, [hydrated, persistDraft]);

  // ---- 計算 ----
  const pricing = useMemo(() => computePricing(model, bundle.options, bundle.categories, selected.map((id) => ({ option_id: id }))), [model, bundle, selected]);
  const issues = useMemo(() => validateSelection(ctx, selected), [ctx, selected]);
  const blocked = useMemo(() => explainBlocked(ctx, selected), [ctx, selected]);
  const previews = useMemo(
    () => Object.fromEntries(VIEW_KEYS.map((v) => [v, resolvePreview(bundle.previewRules, v, selectedPreviewKeys(bundle.options, selected, v))])) as Record<ViewKey, ReturnType<typeof resolvePreview>>,
    [bundle, selected]
  );
  const thumbnailUrl = previews.exterior.layers[0]?.url ?? previews.interior.layers[0]?.url ?? null;

  const onToggle = useCallback(
    (optionId: string) => {
      if (readOnly) {
        pushToast('見積依頼済みの仕様は編集できません。マイページから複製してください。', 'warn');
        return;
      }
      const r = toggleOption(ctx, selected, optionId);
      if (r.rejected) {
        pushToast(r.notices[0] ?? '選択できません', 'warn');
        return;
      }
      setSelected(r.next);
      setDirty(true);
      r.notices.forEach((n) => pushToast(n, 'info'));
      const opt = bundle.options.find((o) => o.id === optionId);
      if (opt?.affects_views.length && !opt.affects_views.includes(view)) setView(opt.affects_views[0]);
    },
    [ctx, selected, readOnly, pushToast, bundle.options, view]
  );

  const reset = () => {
    setSelected(presetSelections[0]?.ids ?? defaults);
    setDirty(true);
    pushToast('標準構成に戻しました', 'info');
  };

  const applyPreset = (code: string) => {
    if (readOnly) return;
    const p = presetSelections.find((x) => x.code === code);
    if (!p) return;
    setSelected(p.ids);
    setDirty(true);
    pushToast(`「${model.presets.find((x) => x.code === code)?.name ?? code}」の構成を適用しました`, 'success');
  };
  const activePreset = presetSelections.find((p) => p.ids.length === selected.length && p.ids.every((id) => selected.includes(id)))?.code ?? null;

  /** ポップアップで確定したカテゴリー内の選択を、ルール（前提・競合）を通して反映 */
  const applyPicker = (categoryId: string, nextInCategory: string[]) => {
    const inCategory = bundle.options.filter((o) => o.category_id === categoryId).map((o) => o.id);
    let cur = selected;
    const notices: string[] = [];
    for (const id of inCategory) {
      const want = nextInCategory.includes(id);
      const has = cur.includes(id);
      if (want === has) continue;
      const r = toggleOption(ctx, cur, id);
      if (r.rejected) notices.push(r.notices[0]);
      else {
        cur = r.next;
        notices.push(...r.notices);
      }
    }
    setSelected(cur);
    setDirty(true);
    setPicker(null);
    notices.forEach((n) => pushToast(n, 'info'));
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

  return (
    <div className="bg-paper" data-testid="simulator" data-hydrated={hydrated ? 'true' : 'false'}>
      <div className="container-x pt-5 sm:pt-8">
        <Breadcrumbs items={[{ name: 'ホーム', path: '/' }, { name: '商品一覧', path: '/products' }, { name: model.name, path: `/products/${model.slug}` }, { name: '見積シミュレーター' }]} />
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Simulator</p>
            <h1 className="mt-1 text-2xl sm:text-4xl">{model.name} 見積シミュレーター</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-ink-soft">
            {user ? (
              <span>
                {user.name} さん｜<Link href="/mypage" className="underline underline-offset-4">マイページ</Link>
              </span>
            ) : (
              <span>
                保存には <Link href={`/login?next=${encodeURIComponent(`/simulator/${model.slug}?resume=1`)}`} className="underline underline-offset-4">ログイン</Link> が必要です（選択内容は保持されます）
              </span>
            )}
          </div>
        </div>
        {loadError && <Alert tone="warn" className="mt-4">{loadError}</Alert>}
        {readOnly && (
          <Alert tone="info" className="mt-4">
            この仕様は見積依頼済みのため編集できません。変更する場合は
            <Link href="/mypage" className="mx-1 font-semibold underline">マイページ</Link>
            から複製してください。
          </Alert>
        )}
      </div>

      {/* PC: 3カラム / SP: 画像 → オプション → 金額 */}
      <div className="container-x grid gap-6 py-6 lg:grid-cols-[minmax(18rem,22rem)_1fr_minmax(18rem,21rem)] lg:items-start lg:gap-8 lg:py-8">
        <div className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-24">
          <PreviewStage previews={previews} view={view} onViewChange={setView} options={bundle.options} modelName={model.name} />
        </div>
        <div className="order-2 min-w-0 lg:order-1">
          <OptionPanel
            bundle={bundle}
            selected={selected}
            blocked={blocked}
            onToggle={onToggle}
            onReset={reset}
            readOnly={readOnly}
            presets={model.presets ?? []}
            activePreset={activePreset}
            onApplyPreset={applyPreset}
          />
        </div>
        <div className="order-3 min-w-0 lg:sticky lg:top-24">
          <SummaryPanel
            model={model}
            pricing={pricing}
            issues={issues}
            categories={bundle.categories}
            options={bundle.options}
            onPickCategory={(id) => setPicker(id)}
            name={name}
            configId={configId}
            dirty={dirty}
            readOnly={readOnly}
            saving={saving}
            onSave={handleSaveClick}
            onQuote={handleQuoteClick}
          />
        </div>
      </div>

      {/* SP: 固定フッター */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.7rem] text-muted">概算合計（税込）</p>
            <p className="font-serif text-2xl leading-none">{formatYen(pricing.total)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleSaveClick} disabled={saving || readOnly} aria-label="一時保存">
              <Save className="size-4" aria-hidden="true" />
              保存
            </Button>
            <Button size="sm" onClick={handleQuoteClick} disabled={saving}>
              見積依頼
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[0.65rem] text-muted">{PRICE_DISCLAIMER}</p>
      </div>

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
      {picker && (
        <OptionPickerDialog
          category={bundle.categories.find((c) => c.id === picker)!}
          options={bundle.options.filter((o) => o.category_id === picker)}
          selectedIds={selected}
          blocked={blocked}
          onClose={() => setPicker(null)}
          onApply={(next) => applyPicker(picker, next)}
        />
      )}
      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
