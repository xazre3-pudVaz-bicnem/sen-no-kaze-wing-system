'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowRight, Save } from 'lucide-react';
import { saveConfigurationWithExteriorAction } from '@/lib/actions/exterior-configurations';
import { computePricing, formatYen } from '@/lib/domain/pricing';
import { resolvePreview, selectedPreviewKeys } from '@/lib/domain/preview';
import { categoriesInScope, defaultSelection, explainBlocked, pruneToScope, toggleOption, validateSelection, type RuleContext } from '@/lib/domain/rules';
import { baseBreakdownTotal, buildPresetSelection, defaultVariantIdsFor, pruneHiddenVariantChoices } from '@/lib/domain/preset';
import {
  buildEstimateBaselineSelection,
  buildEstimateSpecSelection,
  finishLevelForEstimateSpec,
  simulatorEstimateChoices,
} from '@/lib/domain/estimate-template';
import {
  computeStandardEstimatePricing,
  type StandardEstimatePricingResult,
} from '@/lib/domain/standard-estimate-pricing';
import {
  makeDefaultExteriorFaces,
  normalizeExteriorFaces,
  type ExteriorFaceCode,
  type ExteriorFaceSelection,
} from '@/lib/domain/exterior-wall';
import {
  FINISH_LEVELS,
  FINISH_LEVEL_INFO,
  VIEW_KEYS,
  finishLevelRank,
  type CatalogBundle,
  type ConfigurationStatus,
  type EstimateTemplateBundle,
  type FinishLevel,
  type ViewKey,
} from '@/lib/domain/types';
import { PRICE_DISCLAIMER } from '@/lib/site';
import { customerPlanName, planDisplaySizeFromSpecs } from '@/lib/domain/plan-display';
import { normalizeWashbasinSelection } from '@/lib/domain/washbasin-selection';
import { Alert, Button } from '@/components/ui';
import { FinishLevelPicker } from './finish-level-picker';
import { ElevationStrip, PlanBoard } from './plan-board';
import { EquipmentBoard } from './equipment-board';
import { QuoteSheet } from './quote-sheet';
import { PreviewStage } from './preview-stage';
import { OptionPickerDialog } from './option-picker-dialog';
import { ExteriorWallFacesDialog } from './exterior-wall-faces-dialog';
import { SaveDialog } from './save-dialog';
import { SiteLocationPicker } from './site-location-picker';
import { Toasts, type Toast } from './toasts';
import { cn } from '@/lib/utils';

export interface SimulatorInitial {
  id: string;
  name: string;
  option_ids: string[];
  variant_choice_ids: string[];
  exterior_faces: ExteriorFaceSelection[];
  status: ConfigurationStatus;
  finish_level: FinishLevel;
  /** 仕様（hotel / residence / office）。本体内訳の解決に使う */
  spec_code: string | null;
  site_prefecture: string | null;
  site_municipality: string | null;
  site_location_undecided: boolean;
}

interface Props {
  bundle: CatalogBundle;
  /** Excelから取り込んだ標準見積。存在するときはこちらを価格・仕様選択の正本にする。 */
  estimateTemplates: EstimateTemplateBundle[];
  /** 本体切り替え用（タイトル横のセレクト。先方指示「ここで本体を変える」） */
  models: { slug: string; name: string }[];
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
  exteriorFaces?: ExteriorFaceSelection[];
  finishLevel?: FinishLevel;
  spec?: string;
  sitePrefecture?: string | null;
  siteMunicipality?: string | null;
  siteLocationUndecided?: boolean;
  name: string;
  configId: string | null;
  pending: 'save' | 'quote' | null;
  savedAt: number;
}

const storageKey = (slug: string) => `wing:sim:${slug}`;

const sameSelection = (a: string[], b: string[]) => {
  const aa = [...new Set(a)].sort();
  const bb = [...new Set(b)].sort();
  return aa.length === bb.length && aa.every((id, index) => id === bb[index]);
};

const sameExteriorFaces = (a: ExteriorFaceSelection[], b: ExteriorFaceSelection[]) => {
  const key = (face: ExteriorFaceSelection) =>
    `${face.face_code}:${face.option_id}:${[...face.variant_choice_ids].sort().join(',')}`;
  const aa = a.map(key).sort();
  const bb = b.map(key).sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
};

/** 選ばれている商品ごとに、標準の選択肢を選ぶ（表示条件つきの項目は条件を満たすときだけ） */
function defaultVariantIds(bundle: CatalogBundle, optionIds: string[]): string[] {
  return defaultVariantIdsFor(bundle.variantGroups, bundle.variantChoices, optionIds);
}

export function SimulatorApp({ bundle, estimateTemplates, models, elevations, initial, loadError, resume, user }: Props) {
  const router = useRouter();
  const { model } = bundle;
  const displayModelName = model.name === 'フラット' ? 'Flat' : model.name;
  const ctx = useMemo<RuleContext>(
    () => ({ options: bundle.options, categories: bundle.categories, dependencies: bundle.dependencies, conflicts: bundle.conflicts }),
    [bundle]
  );
  const defaults = useMemo(() => defaultSelection(ctx), [ctx]);

  const estimateTemplateByCode = useMemo(
    () => new Map(estimateTemplates.map((row) => [row.template.spec_code, row])),
    [estimateTemplates]
  );
  const simulatorSpecChoices = useMemo(
    () => simulatorEstimateChoices(model, estimateTemplates),
    [estimateTemplates, model]
  );
  const usesManagedEstimateChoices = simulatorSpecChoices.length > 0;

  /**
   * 仕様を選んだときの標準商品構成。
   * 標準価格はExcelが正本で、ここは商品変更差額・画像・設備選択の初期状態だけに使う。
   * 管理画面から追加された仕様も estimate_templates の baseline_option_ids を使って自動反映する。
   */
  const specSelections = useMemo(
    () =>
      simulatorSpecChoices.map((choice) => {
        if (choice.template) {
          return {
            code: choice.code,
            ids: buildEstimateBaselineSelection(ctx, model, choice.template),
          };
        }
        if (choice.preset) {
          return {
            code: choice.code,
            ids: buildPresetSelection(ctx, choice.preset, defaults),
          };
        }
        return {
          code: choice.code,
          ids: buildEstimateSpecSelection(ctx, model, choice.code),
        };
      }),
    [ctx, defaults, model, simulatorSpecChoices]
  );

  const preferredPresetCode = model.presets?.[0]?.code;
  const managedDefaultSpecCode =
    preferredPresetCode && specSelections.some((row) => row.code === preferredPresetCode)
      ? preferredPresetCode
      : null;
  const validInitialSpecCode =
    initial?.spec_code && specSelections.some((row) => row.code === initial.spec_code)
      ? initial.spec_code
      : null;
  const defaultSpecCode =
    validInitialSpecCode ??
    managedDefaultSpecCode ??
    simulatorSpecChoices.find((row) => row.code !== 'base')?.code ??
    simulatorSpecChoices[0]?.code ??
    'base';
  const initialLevel: FinishLevel =
    initial?.finish_level ?? finishLevelForEstimateSpec(defaultSpecCode);
  const initialBaselineIds =
    specSelections.find((row) => row.code === defaultSpecCode)?.ids ?? defaults;
  const preserveLegacyInitialSelection =
    Boolean(initial) && (Boolean(validInitialSpecCode) || !initial?.spec_code);
  const initialSelection = normalizeWashbasinSelection(
    bundle.options,
    pruneToScope(
      ctx,
      preserveLegacyInitialSelection
        ? (initial?.option_ids ?? initialBaselineIds)
        : initialBaselineIds,
      initialLevel
    ),
    initialBaselineIds
  );
  const initialVariants = pruneHiddenVariantChoices(
    bundle.variantGroups,
    bundle.variantChoices,
    initial?.variant_choice_ids ?? defaultVariantIds(bundle, initialSelection)
  );
  const exteriorWallCat = bundle.categories.find((c) => c.code === 'exterior-wall');
  const allExteriorWallOptions = bundle.options
    .filter((o) => o.category_id === exteriorWallCat?.id && o.status === 'published')
    .sort((a, b) => a.sort_order - b.sort_order);
  const legacyExteriorCodes = new Set(['exterior-galnote', 'exterior-wood']);
  const currentExteriorCodes = new Set([
    'exterior-nichiha-st-u18',
    'exterior-nichiha-ns-premium18',
    'exterior-nichiha-m-flat-premium18',
    'exterior-wood-accent-100',
    'exterior-current-gl-bare',
  ]);
  const hasCurrentExteriorCatalog = allExteriorWallOptions.some((option) => currentExteriorCodes.has(option.code));
  const exteriorWallOptions = hasCurrentExteriorCatalog
    ? allExteriorWallOptions.filter((option) => !legacyExteriorCodes.has(option.code))
    : allExteriorWallOptions;
  const [finishLevel, setFinishLevel] = useState<FinishLevel>(initialLevel);
  const [selected, setSelected] = useState<string[]>(initialSelection);
  /** 選ばれた商品バリエーション（壁色・扉色など）の選択肢 ID */
  const [variantIds, setVariantIds] = useState<string[]>(initialVariants);
  const [exteriorFaces, setExteriorFaces] = useState<ExteriorFaceSelection[]>(() => {
    // 保存済み旧Configurationの exterior_faces=[] は従来1商品方式を表す互換状態。
    // 外壁を明示変更するまで [] を維持し、価格や保存内容を4面方式へ自動変換しない。
    if (initial) {
      if (initial.exterior_faces.length === 0) return [];
      return normalizeExteriorFaces(
        initial.exterior_faces,
        allExteriorWallOptions,
        bundle.variantGroups,
        bundle.variantChoices,
        initialSelection,
        initialVariants
      );
    }
    return normalizeExteriorFaces(
      undefined,
      exteriorWallOptions,
      bundle.variantGroups,
      bundle.variantChoices,
      initialSelection,
      initialVariants
    );
  });
  const [specCode, setSpecCode] = useState<string>(defaultSpecCode);
  const [sitePrefecture, setSitePrefecture] = useState<string | null>(initial?.site_prefecture ?? null);
  const [siteMunicipality, setSiteMunicipality] = useState<string | null>(initial?.site_municipality ?? null);
  const [siteLocationUndecided, setSiteLocationUndecided] = useState(initial?.site_location_undecided ?? false);
  const [picker, setPicker] = useState<string | null>(null);
  const [exteriorFacePicker, setExteriorFacePicker] = useState<ExteriorFaceCode | null>(null);
  const [name, setName] = useState(initial?.name ?? `${displayModelName} の仕様`);
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
  const selectedExteriorOption = allExteriorWallOptions.some((option) => selected.includes(option.id));
  // 旧ConfigurationのDB正本は exterior_faces=[] のまま維持する。
  // ただし画面表示では、保存済みの従来1商品外壁を4面同一として復元する。
  const displayedExteriorFaces =
    exteriorFaces.length === 0 && selectedExteriorOption
      ? normalizeExteriorFaces(
          [],
          allExteriorWallOptions,
          bundle.variantGroups,
          bundle.variantChoices,
          selected,
          variantIds
        )
      : exteriorFaces;
  const activeEstimateTemplate = estimateTemplateByCode.get(specCode) ?? null;
  const activeChoice = simulatorSpecChoices.find((choice) => choice.code === specCode) ?? null;
  const activePreset = activeChoice?.preset ?? model.presets?.find((preset) => preset.code === specCode) ?? null;
  const specName =
    activeEstimateTemplate?.template.name ??
    activeChoice?.name ??
    activePreset?.name ??
    '';
  const planDisplayName = customerPlanName(activePreset, specName);
  const planSize = planDisplaySizeFromSpecs(model.specs);

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
        const hasInvalidSpec =
          Boolean(draft.spec) && !specSelections.some((row) => row.code === draft.spec);
        const restoredSpec =
          !hasInvalidSpec && draft.spec
            ? draft.spec
            : defaultSpecCode;

        if (!hasInvalidSpec) {
          const restoredLevel = finishLevelForEstimateSpec(restoredSpec);
          const restoredChoice = simulatorSpecChoices.find((row) => row.code === restoredSpec) ?? null;
          const restoredTemplate = estimateTemplateByCode.get(restoredSpec) ?? null;
          const allowedOptionIds = new Set(
            (restoredTemplate || !restoredChoice?.preset
              ? bundle.options
              : bundle.options.filter(
                  (option) =>
                    option.spec_codes.length === 0 ||
                    option.spec_codes.includes(restoredSpec)
                )
            ).map((option) => option.id)
          );
          const standardIds =
            specSelections.find((row) => row.code === restoredSpec)?.ids ?? [];
          let restoredSelection = normalizeWashbasinSelection(
            bundle.options,
            pruneToScope(
              ctx,
              draft.selected.filter((id) => allowedOptionIds.has(id)),
              restoredLevel
            ),
            standardIds
          );

          // 旧下書きに複数選択が残っていても、現在1択のカテゴリーは1商品へ正規化する。
          for (const category of bundle.categories.filter(
            (row) => row.selection_mode === 'single' || row.code === 'aircon'
          )) {
            const categoryOptionIds = new Set(
              bundle.options
                .filter((option) => option.category_id === category.id)
                .map((option) => option.id)
            );
            const chosen = restoredSelection.filter((id) => categoryOptionIds.has(id));
            if (chosen.length <= 1) continue;
            const standardChoice = standardIds.find((id) => categoryOptionIds.has(id));
            const keep = standardChoice ?? chosen[0];
            restoredSelection = [
              ...restoredSelection.filter((id) => !categoryOptionIds.has(id)),
              keep,
            ];
          }

          if (restoredSelection.length === 0 && standardIds.length > 0) {
            restoredSelection = pruneToScope(ctx, standardIds, restoredLevel);
          }

          const selectedGroupIds = new Set(
            bundle.variantGroups
              .filter((group) => restoredSelection.includes(group.option_id))
              .map((group) => group.id)
          );
          const restoredVariantIds = pruneHiddenVariantChoices(
            bundle.variantGroups,
            bundle.variantChoices,
            (draft.variantIds ?? []).filter((choiceId) => {
              const groupId = bundle.variantChoices.find((choice) => choice.id === choiceId)?.group_id;
              return Boolean(groupId && selectedGroupIds.has(groupId));
            })
          );
          const restoredVariantGroupIds = new Set(
            restoredVariantIds
              .map((choiceId) => bundle.variantChoices.find((choice) => choice.id === choiceId)?.group_id)
              .filter((groupId): groupId is string => Boolean(groupId))
          );
          const fallbackVariantIds = defaultVariantIds(bundle, restoredSelection).filter((choiceId) => {
            const groupId = bundle.variantChoices.find((choice) => choice.id === choiceId)?.group_id;
            return !groupId || !restoredVariantGroupIds.has(groupId);
          });
          const normalizedVariantIds = pruneHiddenVariantChoices(
            bundle.variantGroups,
            bundle.variantChoices,
            [...restoredVariantIds, ...fallbackVariantIds]
          );

          setSpecCode(restoredSpec);
          setFinishLevel(restoredLevel);
          setSelected(restoredSelection);
          setVariantIds(normalizedVariantIds);
          setExteriorFaces(
            normalizeExteriorFaces(
              draft.exteriorFaces,
              exteriorWallOptions,
              bundle.variantGroups,
              bundle.variantChoices,
              restoredSelection,
              normalizedVariantIds
            )
          );
        }

        setSiteLocationUndecided(Boolean(draft.siteLocationUndecided));
        setSitePrefecture(draft.siteLocationUndecided ? null : (draft.sitePrefecture ?? null));
        setSiteMunicipality(draft.siteLocationUndecided ? null : (draft.siteMunicipality ?? null));
        if (draft.name) setName(draft.name);
        if (draft.configId && !hasInvalidSpec) setConfigId(draft.configId);
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
      const draft: Draft = {
        selected,
        variantIds,
        exteriorFaces,
        finishLevel,
        spec: specCode,
        sitePrefecture,
        siteMunicipality,
        siteLocationUndecided,
        name,
        configId,
        pending: null,
        savedAt: Date.now(),
        ...patch,
      };
      window.localStorage.setItem(storageKey(model.slug), JSON.stringify(draft));
    },
    [selected, variantIds, exteriorFaces, finishLevel, specCode, sitePrefecture, siteMunicipality, siteLocationUndecided, name, configId, model.slug]
  );

  useEffect(() => {
    if (hydrated) persistDraft();
  }, [hydrated, persistDraft]);

  // ---- 仕様で絞り込んだカタログ ----
  const specOptions = useMemo(() => {
    const hasPreset = Boolean(activeChoice?.preset);
    // 管理画面で追加された仕様や「本体のみ」は preset がないため、
    // spec_codes の旧固定値で設備が消えないよう商品一覧をそのまま使う。
    if (activeEstimateTemplate || !hasPreset) return bundle.options;
    return bundle.options.filter(
      (option) => option.spec_codes.length === 0 || option.spec_codes.includes(specCode)
    );
  }, [activeChoice, activeEstimateTemplate, bundle.options, specCode]);
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
  /** 標準見積があればExcelを基準価格にし、商品変更分だけ差額反映する。 */
  const standardEstimatePricing = useMemo<StandardEstimatePricingResult | null>(
    () =>
      activeEstimateTemplate
        ? computeStandardEstimatePricing(
            bundle,
            activeEstimateTemplate,
            selected,
            variantIds,
            exteriorFaces,
            finishLevel
          )
        : null,
    [activeEstimateTemplate, bundle, exteriorFaces, finishLevel, selected, variantIds]
  );
  /** 標準見積未登録の仕様だけ従来計算へフォールバックする。 */
  const baseOverride = useMemo(
    () => (activeEstimateTemplate ? null : baseBreakdownTotal(bundle, specCode)),
    [activeEstimateTemplate, bundle, specCode]
  );
  const pricing = useMemo(
    () =>
      standardEstimatePricing?.pricing ??
      computePricing(
        model,
        bundle.options,
        bundle.categories,
        selected.map((sid) => ({ option_id: sid, variant_choice_ids: variantIds })),
        undefined,
        { groups: bundle.variantGroups, choices: bundle.variantChoices },
        baseOverride,
        exteriorFaces
      ),
    [model, bundle, selected, variantIds, baseOverride, exteriorFaces, standardEstimatePricing]
  );
  /** 各注文範囲を選んだ場合の概算合計（カードに出す目安）。現在の仕様の標準構成で計算する */
  const levelTotals = useMemo(() => {
    const preset = specSelections.find((x) => x.code === specCode) ?? specSelections[0];
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
        baseBreakdownTotal(bundle, specCode),
        lv === finishLevel ? exteriorFaces : []
      ).total;
    }
    return out;
  }, [ctx, model, bundle, specSelections, specCode, defaults, selected, finishLevel, exteriorFaces]);

  const independentInsulationCategoryIds = useMemo(
    () =>
      new Set(
        bundle.categories
          .filter((category) =>
            ['insulation-floor', 'insulation-wall', 'insulation-ceiling'].includes(category.code)
          )
          .map((category) => category.id)
      ),
    [bundle.categories]
  );
  const legacyReadOnlyWithoutIndependentInsulation =
    readOnly &&
    Boolean(initial) &&
    !(initial?.option_ids ?? []).some((id) => {
      const option = bundle.options.find((row) => row.id === id);
      return Boolean(option && independentInsulationCategoryIds.has(option.category_id));
    });
  const validationIssues = useMemo(
    () => validateSelection(ctx, selected, finishLevel),
    [ctx, selected, finishLevel]
  );
  const displayIssues = useMemo(() => {
    if (!legacyReadOnlyWithoutIndependentInsulation) return validationIssues;

    // migration前に確定した正式履歴には、新設した独立断熱required不足を警告表示しない。
    // DBや選択内容は補完せず、見積依頼などの検証条件も緩めず、表示だけ過去履歴の意味を維持する。
    return validationIssues.filter(
      (issue) =>
        !(
          issue.type === 'required' &&
          issue.option_ids.length > 0 &&
          issue.option_ids.every((id) => {
            const option = bundle.options.find((row) => row.id === id);
            return Boolean(option && independentInsulationCategoryIds.has(option.category_id));
          })
        )
    );
  }, [
    bundle.options,
    independentInsulationCategoryIds,
    legacyReadOnlyWithoutIndependentInsulation,
    validationIssues,
  ]);
  const blocked = useMemo(() => explainBlocked(ctx, selected), [ctx, selected]);
  const activeSpecSelection = specSelections.find((row) => row.code === specCode)?.ids ?? [];
  const baselineVariantIds = useMemo(
    () => defaultVariantIds(bundle, activeSpecSelection),
    [activeSpecSelection, bundle]
  );
  const atStandardSpecSelection = sameSelection(
    selected,
    pruneToScope(ctx, activeSpecSelection, finishLevel)
  );
  const preferredFloorplanKeys = useMemo<string[] | undefined>(() => {
    if (!atStandardSpecSelection || !activePreset) return undefined;
    const presetSelection = buildPresetSelection(ctx, activePreset, defaults);
    return selectedPreviewKeys(bundle.options, presetSelection, 'floorplan');
  }, [activePreset, atStandardSpecSelection, bundle.options, ctx, defaults]);
  const previews = useMemo(
    () =>
      Object.fromEntries(
        VIEW_KEYS.map((v) => [
          v,
          resolvePreview(
            bundle.previewRules,
            v,
            selectedPreviewKeys(bundle.options, selected, v),
            specCode,
            v === 'floorplan' ? preferredFloorplanKeys : undefined
          ),
        ])
      ) as Record<ViewKey, ReturnType<typeof resolvePreview>>,
    [bundle, preferredFloorplanKeys, selected, specCode]
  );
  const thumbnailUrl = previews.exterior.layers[0]?.url ?? previews.interior.layers[0]?.url ?? null;

  const resetExteriorFaces = (optionIds: string[], nextVariantIds: string[]) => {
    setExteriorFaces(
      makeDefaultExteriorFaces(exteriorWallOptions, bundle.variantGroups, bundle.variantChoices, optionIds, nextVariantIds)
    );
  };

  // ---- 操作 ----
  const applyPreset = (code: string) => {
    if (!hydrated || readOnly) return;
    const selection = specSelections.find((row) => row.code === code);
    const choice = simulatorSpecChoices.find((row) => row.code === code);
    if (!selection || !choice) return;
    const nextLevel = finishLevelForEstimateSpec(code);
    const nextSel = pruneToScope(ctx, selection.ids, nextLevel);
    const nextVariants = defaultVariantIds(bundle, nextSel);
    setSpecCode(code);
    setFinishLevel(nextLevel);
    setSelected(nextSel);
    setVariantIds(nextVariants);
    resetExteriorFaces(nextSel, nextVariants);
    setDirty(true);
    pushToast(`「${choice.name}」の標準見積を読み込みました`, 'success');
  };

  /**
   * 注文範囲の切り替え。
   * 狭めるときは範囲外の選択を落とし、広げるときは仕様の標準構成から不足分を補う。
   */
  const changeFinishLevel = (level: FinishLevel) => {
    if (readOnly || level === finishLevel) return;
    const widening = finishLevelRank(level) > finishLevelRank(finishLevel);
    if (widening) {
      const preset = specSelections.find((x) => x.code === specCode) ?? specSelections[0];
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

  const applyExteriorFaces = (nextFaces: ExteriorFaceSelection[]) => {
    // 旧1商品方式(exterior_faces=[])を表示用に4面展開しただけなら、ApplyしてもDB正本を4面化しない。
    // 旧有料外壁を「変更なし」で4面課金へ変換する事故を防ぐ。
    if (exteriorFaces.length === 0 && selectedExteriorOption) {
      const legacyDisplayedFaces = normalizeExteriorFaces(
        [],
        allExteriorWallOptions,
        bundle.variantGroups,
        bundle.variantChoices,
        selected,
        variantIds
      );
      if (sameExteriorFaces(nextFaces, legacyDisplayedFaces)) {
        setExteriorFacePicker(null);
        pushToast('外壁の変更はありません', 'info');
        return;
      }
    }

    const front = nextFaces.find((f) => f.face_code === 'front') ?? nextFaces[0];
    setExteriorFaces(nextFaces);
    if (front && exteriorWallCat) {
      const wallIds = new Set(allExteriorWallOptions.map((o) => o.id));
      setSelected((prev) => [...prev.filter((id) => !wallIds.has(id)), front.option_id]);
      const wallGroupIds = new Set(bundle.variantGroups.filter((g) => wallIds.has(g.option_id)).map((g) => g.id));
      setVariantIds((prev) => [
        ...prev.filter((cid) => {
          const gid = bundle.variantChoices.find((c) => c.id === cid)?.group_id;
          return !gid || !wallGroupIds.has(gid);
        }),
        ...front.variant_choice_ids,
      ]);
    }
    setDirty(true);
    setExteriorFacePicker(null);
    pushToast('外壁を4面ごとに変更しました', 'success');
  };

  const openExteriorFace = (face: ExteriorFaceCode) => {
    if (readOnly) {
      pushToast('見積依頼済みの仕様は編集できません。マイページから複製してください。', 'warn');
      return;
    }
    setExteriorFacePicker(face);
  };

  const openPicker = (categoryId: string) => {
    if (readOnly) {
      pushToast('見積依頼済みの仕様は編集できません。マイページから複製してください。', 'warn');
      return;
    }
    if (categoryId === exteriorWallCat?.id) {
      setExteriorFacePicker('front');
      return;
    }
    setPicker(categoryId);
  };

  // ---- 保存・見積依頼 ----
  const requireLogin = (pending: 'save' | 'quote') => {
    persistDraft({ pending });
    router.push(`/login?next=${encodeURIComponent(`/simulator/${model.slug}?resume=1`)}`);
  };

  const doSave = (saveName: string, then: 'stay' | 'quote') => {
    setSaveError(null);
    startSaving(async () => {
      const result = await saveConfigurationWithExteriorAction({
        id: configId,
        base_model_id: model.id,
        name: saveName,
        option_ids: selected,
        preview_image_url: thumbnailUrl,
        notes: null,
        finish_level: finishLevel,
        variant_choice_ids: variantIds,
        exterior_faces: exteriorFaces,
        spec_code: specCode,
        site_prefecture: sitePrefecture,
        site_municipality: siteMunicipality,
        site_location_undecided: siteLocationUndecided,
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
    if (validationIssues.length) {
      pushToast(validationIssues[0].message, 'warn');
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
  const rawModelSubtitle = model.name === 'Wing' ? '傾斜地対応折畳み式木造コンテナ' : model.tagline ?? '';
  const [modelDescriptor, ...modelDescriptionParts] = rawModelSubtitle
    .split('。')
    .map((part) => part.trim())
    .filter(Boolean);
  const modelDescription = modelDescriptionParts.length > 0 ? `${modelDescriptionParts.join('。')}。` : '';
  const breadcrumbModels = (models.length > 0 ? models : [{ slug: model.slug, name: model.name }]).map((m) => ({
    ...m,
    name: m.name === 'フラット' ? 'Flat' : m.name,
  }));

  return (
    <div className="bg-paper">
      <div className="container-x pt-4 sm:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2">
          <nav aria-label="パンくずリスト" className="max-w-full overflow-x-auto text-xs text-muted sm:text-sm">
            <ol className="flex w-max items-center gap-1.5 whitespace-nowrap">
              <li>
                <Link href="/" className="hover:text-ink hover:underline">
                  ホーム
                </Link>
              </li>
              <li className="flex items-center gap-1.5 text-ink-soft">
                <span aria-hidden="true">/</span>
                <span aria-hidden="true">【</span>
                {breadcrumbModels.map((m, index) => (
                  <span key={m.slug} className="inline-flex items-center gap-1">
                    {index > 0 && <span aria-hidden="true">/</span>}
                    {m.slug === model.slug ? (
                      <span className="font-semibold text-danger">{m.name}</span>
                    ) : (
                      <Link href={`/simulator/${m.slug}`} className="hover:text-ink hover:underline">
                        {m.name}
                      </Link>
                    )}
                  </span>
                ))}
                <span aria-hidden="true">】</span>
                <span>見積シミュレーター</span>
              </li>
            </ol>
          </nav>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={saving || readOnly}
              className="inline-flex min-h-7 min-w-32 items-center justify-center rounded-full border border-gold/45 bg-white px-5 text-[0.72rem] font-medium text-ink-soft transition hover:border-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="top-save-button"
            >
              見積を保存する
            </button>
            <Link
              href="#"
              className="inline-flex min-h-7 min-w-32 items-center justify-center rounded-full border border-gold/45 bg-white px-5 text-[0.72rem] font-medium text-ink-soft transition hover:border-gold hover:text-ink"
            >
              土地を探している方
            </Link>
          </div>
        </div>

        <div className="mt-4">
          <div className="min-w-0">
            <p className="label-en text-forest">Simulator</p>
            <div className="mt-1 flex flex-wrap items-start gap-x-7 gap-y-2">
              <div className="min-w-0">
                <h1 className="text-[1.625rem] sm:text-4xl">
                  <span className="inline-flex max-w-full items-baseline whitespace-nowrap">
                    <span>{displayModelName}</span>
                    {modelDescriptor && (
                      <span className="ml-1 align-baseline text-[0.85rem] font-normal text-ink-soft sm:text-[1.65rem]">
                        （{modelDescriptor}）
                      </span>
                    )}
                  </span>
                  {specName && <span className="sr-only">（{specName}）</span>}
                </h1>
                {modelDescription && <p className="mt-1 text-sm leading-relaxed text-ink-soft sm:text-base">{modelDescription}</p>}
              </div>
              {(models.length > 1 || fireproofCat) && (
                <div className="flex w-full flex-nowrap items-center gap-2 sm:w-auto sm:gap-3">
                  {models.length > 1 && (
                    <div className="inline-flex min-w-0 items-center gap-1.5 text-[0.82rem] text-muted sm:text-sm">
                      <span className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-ink-soft">
                        <span className="sm:hidden">本体</span>
                        <span className="hidden sm:inline">本体を変える</span>
                      </span>
                      <select
                        value={model.slug}
                        onChange={(e) => router.push(`/simulator/${e.target.value}`)}
                        className="min-h-9 w-20 rounded-lg border border-line bg-white px-2 text-[0.85rem] text-ink sm:w-24 sm:px-3 sm:text-[0.95rem]"
                        aria-label="本体（モデル）を切り替える"
                        data-testid="model-switcher"
                      >
                        {models.map((m) => (
                          <option key={m.slug} value={m.slug}>
                            {m.name === 'フラット' ? 'Flat' : m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {fireproofCat && (
                    <label
                      className="inline-flex min-w-0 items-center gap-1.5 text-[0.82rem] text-muted sm:text-sm"
                      data-testid="fireproof-picker"
                    >
                      <span className="whitespace-nowrap font-semibold text-ink-soft">
                        <span className="sm:hidden">防火</span>
                        <span className="hidden sm:inline">防火仕様</span>
                      </span>
                      <select
                        value={fireproofChosen?.id ?? ''}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          if (nextId && nextId !== fireproofChosen?.id) applyPicker(fireproofCat.id, [nextId]);
                        }}
                        disabled={readOnly}
                        className="min-h-9 w-24 rounded-lg border border-line bg-white px-2 text-[0.85rem] text-ink disabled:cursor-not-allowed disabled:opacity-50 sm:w-28 sm:px-3 sm:text-[0.95rem]"
                        aria-label="防火仕様を切り替える"
                        data-testid="fireproof-select"
                      >
                        {!fireproofChosen && (
                          <option value="" disabled>
                            選択
                          </option>
                        )}
                        {fireproofOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name.includes('非防火') ? '非防火' : o.name.includes('防火構造') ? '防火構造' : o.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-3 border-b border-line pb-2.5 xl:flex-row xl:items-end xl:justify-between xl:gap-x-6">
            <div className="w-full min-w-0 xl:flex-1">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
                <div className="min-w-0">
                  <p className="mb-1 text-[0.72rem] font-semibold text-muted" data-testid="spec-choice-label">
                    仕様を選ぶ
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {!usesManagedEstimateChoices && (
                      <FinishLevelPicker value={finishLevel} totals={levelTotals} readOnly={readOnly} onChange={changeFinishLevel} />
                    )}
                    {simulatorSpecChoices.map((choice) => (
                      <button
                        key={choice.code}
                        type="button"
                        onClick={() => applyPreset(choice.code)}
                        disabled={!hydrated || readOnly}
                        aria-pressed={specCode === choice.code}
                        title={choice.description}
                        className={cn(
                          'rounded-full border px-3.5 py-1 text-[0.82rem] font-medium transition disabled:opacity-50',
                          specCode === choice.code ? 'border-brown bg-brown text-white' : 'border-line bg-white text-ink-soft hover:border-ink/40'
                        )}
                        data-testid={`preset-${choice.code}`}
                      >
                        {choice.name}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 w-full text-sm leading-relaxed text-ink-soft">外壁や UB など設備を選んで概算見積出来ます。</p>
                </div>

                <SiteLocationPicker
                  prefecture={sitePrefecture}
                  municipality={siteMunicipality}
                  undecided={siteLocationUndecided}
                  disabled={!hydrated || readOnly}
                  onChange={(next) => {
                    setSitePrefecture(next.prefecture);
                    setSiteMunicipality(next.municipality);
                    setSiteLocationUndecided(next.undecided);
                    setDirty(true);
                  }}
                />
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center justify-end gap-3 xl:w-auto xl:justify-end">
              <div className="w-full text-right xl:w-auto xl:text-center">
                <p className="text-xs text-muted">現在選択している見積金額は</p>
                <p className="font-serif text-[2.05rem] leading-tight tabular-nums sm:text-[2.65rem]">{formatYen(pricing.total)}</p>
              </div>
              <div className="hidden xl:block">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={handleSaveClick} disabled={saving || readOnly} data-testid="save-button">
                    <Save className="size-4" aria-hidden="true" />
                    見積を保存する
                  </Button>
                  <Button size="sm" onClick={handleQuoteClick} disabled={saving} data-testid="quote-button">
                    見積を依頼する
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {!user && (
                  <p className="mt-1 text-right text-[0.7rem] leading-snug text-muted/80">
                    保存には{' '}
                    <Link href={`/login?next=${encodeURIComponent(`/simulator/${model.slug}?resume=1`)}`} className="underline underline-offset-4">
                      ログイン
                    </Link>{' '}
                    が必要です（選択内容は保持されます）
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 space-y-0.5 text-sm leading-relaxed text-ink-soft">
          <p>この段階の見積りは、運搬・設置・基礎・電気・給排水などの別途工事は現地の代理店・工務店のお見積りになります。</p>
          <p>防火に関しては標準「非防火」の選択になっていますが、地域により防火構造にしなければならないので、詳しくは代理店に相談してください。</p>
          {fireproofChosen?.price_on_request && (
            <p className="text-xs font-semibold text-warn">
              防火仕様の金額は場所の条件により異なるため、見積書には「防火仕様（別途見積）」と明記され、本部が本体明細を確認のうえ確定します。
            </p>
          )}
        </div>

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

      {/* 先方モック（2026-08-29）：平面図｜完成イメージ → 立面図（4面）→ 標準設備及び仕上げ表。 */}
      <div className="container-x pt-6 pb-2">
        <h2 className="mb-2 text-lg font-semibold text-ink">プランボード</h2>
        <section aria-label="プランボード" className="space-y-4 lg:space-y-0">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch lg:gap-0">
            <div className="min-w-0">
              <PlanBoard plan={previews.floorplan} specName={planDisplayName} planSize={planSize} modelSlug={model.slug} readOnly={readOnly} />
            </div>

            <div className="min-w-0">
              {/* 完成イメージ（外観・室内・施工事例・その他） */}
              <PreviewStage previews={previews} view={view} onViewChange={setView} options={bundle.options} modelName={displayModelName} />
            </div>
          </div>

          <div className="min-w-0">
            <ElevationStrip
              elevations={elevations}
              categories={bundle.categories}
              options={bundle.options}
              variantChoices={bundle.variantChoices}
              exteriorFaces={displayedExteriorFaces}
              readOnly={readOnly}
              onPickExteriorFace={openExteriorFace}
            />
          </div>
        </section>
      </div>

      <div className="container-x space-y-4 pt-3 pb-2">
        <EquipmentBoard
          categories={specCategories}
          options={scopedOptions}
          selected={selected}
          baselineSelected={activeSpecSelection}
          selectedVariantIds={variantIds}
          baselineVariantIds={baselineVariantIds}
          variantGroups={bundle.variantGroups}
          variantChoices={bundle.variantChoices}
          readOnly={readOnly}
          onPickCategory={openPicker}
        />

        {displayIssues.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-warn/10 px-4 py-3 text-xs text-warn" role="alert">
            {displayIssues.map((i, idx) => (
              <li key={idx}>{i.message}</li>
            ))}
          </ul>
        )}
      </div>

      {/* 御見積書（完成イメージとの行間は詰める：先方指示） */}
      <div className="container-x pt-2 pb-10">
        <QuoteSheet
          modelName={displayModelName}
          specName={specName}
          finishLevel={finishLevel}
          pricing={pricing}
          standardEstimate={standardEstimatePricing}
          categories={bundle.categories}
          options={bundle.options}
          readOnly={readOnly}
          onPickCategory={openPicker}
          showDealerFinder
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
          baselineSelectedIds={activeSpecSelection}
          blocked={blocked}
          variantGroups={bundle.variantGroups}
          variantChoices={bundle.variantChoices}
          selectedVariantIds={variantIds}
          baselineVariantIds={baselineVariantIds}
          onClose={() => setPicker(null)}
          onApply={(next, nextVariants) => applyPicker(picker, next, nextVariants)}
        />
      )}
      {exteriorFacePicker && exteriorWallCat && (
        <ExteriorWallFacesDialog
          category={exteriorWallCat}
          options={allExteriorWallOptions}
          selectableOptions={exteriorWallOptions}
          variantGroups={bundle.variantGroups}
          variantChoices={bundle.variantChoices}
          selectedOptionIds={selected}
          selectedVariantIds={variantIds}
          current={exteriorFaces}
          initialFace={exteriorFacePicker}
          onClose={() => setExteriorFacePicker(null)}
          onApply={applyExteriorFaces}
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
