import type { BaseModel, FinishLevel, ModelPreset } from './types';

/**
 * 「本体のみ」は用途別 preset とは別の、見積Excelそのものを基準にした標準見積。
 * 既存 DB の base_breakdown_items.spec_code をそのまま使えるよう、専用コードで表す。
 */
export const BASE_ESTIMATE_SPEC_CODE = 'base';

export interface EstimateTemplate {
  code: string;
  name: string;
  description: string;
  preset: ModelPreset | null;
}

/** 管理画面・シミュレーターで共通して使う見積種別。 */
export function estimateTemplatesFor(model: Pick<BaseModel, 'presets'>): EstimateTemplate[] {
  return [
    {
      code: BASE_ESTIMATE_SPEC_CODE,
      name: '本体のみ',
      description: '「本体」見積Excelを基準にした標準見積です。',
      preset: null,
    },
    ...(model.presets ?? []).map((preset) => ({
      code: preset.code,
      name: preset.name,
      description: preset.description,
      preset,
    })),
  ];
}

/**
 * 旧 finishLevel を含む保存データとの互換用。
 * shell は「本体のみ」の見積として解釈し、それ以外は用途別見積を使う。
 */
export function activeEstimateSpecCode(finishLevel: FinishLevel, specCode: string | null | undefined): string {
  if (finishLevel === 'shell') return BASE_ESTIMATE_SPEC_CODE;
  return specCode ?? '';
}

/** 見積種別を選んだときの旧 finishLevel 互換値。 */
export function finishLevelForEstimateSpec(specCode: string): FinishLevel {
  return specCode === BASE_ESTIMATE_SPEC_CODE ? 'shell' : 'full';
}
