import type { BaseModel, ModelPreset } from './types';

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

/** 標準見積の選択に合わせた注文範囲。 */
export function finishLevelForEstimateSpec(specCode: string): 'shell' | 'full' {
  return specCode === BASE_ESTIMATE_SPEC_CODE ? 'shell' : 'full';
}
