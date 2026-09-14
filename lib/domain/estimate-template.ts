import { defaultSelection, pruneToScope, toggleOption, type RuleContext } from './rules';
import type { BaseModel, EstimateTemplateBundle, ModelPreset } from './types';

/** 「本体のみ」の標準見積コード。用途別 preset とは独立して扱う。 */
export const BASE_ESTIMATE_SPEC_CODE = 'base';

export interface EstimateTemplateChoice {
  code: string;
  name: string;
  description: string;
  preset: ModelPreset | null;
}

const BASE_CHOICE: EstimateTemplateChoice = {
  code: BASE_ESTIMATE_SPEC_CODE,
  name: '本体のみ',
  description: '「本体」見積Excelを基準にした標準見積です。',
  preset: null,
};

/**
 * 標準見積Excelが未登録の管理画面で使う表示候補。
 * 価格はここから作らない。標準見積の価格源はExcel取込データだけとする。
 *
 * BOX は旧 preset（ホテル / 住宅 / 事務所）を標準見積の正本にせず、
 * 実物Excelに存在する「本体 / ホテル・単身者用 / 水回りキット」を表示する。
 */
export function estimateTemplatesFor(
  model: Pick<BaseModel, 'slug' | 'presets'>
): EstimateTemplateChoice[] {
  if (model.slug === 'box') {
    return [
      BASE_CHOICE,
      {
        code: 'hotel-single',
        name: 'ホテル・単身者用',
        description: '「BOX（ホテル単身者）」見積Excelを基準にした標準見積です。',
        preset: null,
      },
      {
        code: 'water-kit',
        name: '水回りキット',
        description: '「BOX（水回りキット）」見積Excelを基準にした標準見積です。',
        preset: null,
      },
    ];
  }

  return [
    BASE_CHOICE,
    ...(model.presets ?? []).map((preset) => ({
      code: preset.code,
      name: preset.name,
      description: preset.description,
      preset,
    })),
  ];
}


/**
 * 標準見積の「標準選択商品」。
 * 標準価格そのものはExcelが正本で、ここは商品変更時の差額判定だけに使う。
 */
export function estimateBaselineOptionCodes(
  model: Pick<BaseModel, 'slug' | 'presets'>,
  specCode: string
): string[] {
  if (specCode === BASE_ESTIMATE_SPEC_CODE) return [];

  const preset = model.presets?.find((row) => row.code === specCode);
  if (preset) return [...preset.option_codes];

  if (model.slug === 'box') {
    if (specCode === 'hotel-single') {
      return [
        'interior-standard-box',
        'carpentry-box',
        'shower-unit-1116',
        'mini-kitchen',
        'folding-bed',
      ];
    }
    if (specCode === 'water-kit') {
      return [
        'interior-standard-box',
        'carpentry-box',
        'ub-1216',
        'toilet-washlet',
        'mini-kitchen',
        'gas-boiler-16',
        'aircon',
      ];
    }
  }

  return [];
}

/**
 * 標準見積の基準商品を、シミュレーターで実際に使う選択状態へ正規化する。
 *
 * DB の baseline_option_ids が一部だけ古い／不足している場合でも、
 * 依存関係と必須カテゴリーを同じルールで補完することで、
 * UI の「標準状態」と差額計算側の「基準状態」を必ず一致させる。
 */
export function buildEstimateBaselineSelection(
  ctx: RuleContext,
  model: Pick<BaseModel, 'slug' | 'presets'>,
  template: Pick<EstimateTemplateBundle, 'template' | 'baseline_option_ids'>
): string[] {
  const specCode = template.template.spec_code;
  const level = finishLevelForEstimateSpec(specCode);
  const validSavedIds = template.baseline_option_ids.filter((id) =>
    ctx.options.some((option) => option.id === id && option.status === 'published')
  );
  const optionByCode = new Map(ctx.options.map((option) => [option.code, option.id]));
  const sourceIds =
    validSavedIds.length > 0
      ? validSavedIds
      : estimateBaselineOptionCodes(model, specCode)
          .map((code) => optionByCode.get(code))
          .filter((id): id is string => Boolean(id));

  let cur: string[] = [];
  for (const optionId of sourceIds) {
    const result = toggleOption(ctx, cur, optionId);
    if (!result.rejected) cur = result.next;
  }

  // 必須カテゴリー・必須商品だけを補う。任意カテゴリーの is_default は勝手に追加しない。
  for (const optionId of defaultSelection(ctx, level)) {
    if (cur.includes(optionId)) continue;
    const option = ctx.options.find((row) => row.id === optionId);
    const category = ctx.categories.find((row) => row.id === option?.category_id);
    const hasCategory = cur.some(
      (id) => ctx.options.find((row) => row.id === id)?.category_id === category?.id
    );
    if (option?.is_required || (category?.is_required && !hasCategory)) {
      const result = toggleOption(ctx, cur, optionId);
      if (!result.rejected) cur = result.next;
    }
  }

  return [...new Set(pruneToScope(ctx, cur, level))];
}

/** 標準見積の選択に合わせた注文範囲。 */
export function finishLevelForEstimateSpec(specCode: string): 'shell' | 'full' {
  return specCode === BASE_ESTIMATE_SPEC_CODE ? 'shell' : 'full';
}
