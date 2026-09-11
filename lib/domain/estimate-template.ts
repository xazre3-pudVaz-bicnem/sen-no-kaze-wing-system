import type { BaseModel, ModelPreset } from './types';

/** 「本体のみ」の標準見積コード。用途別 preset とは独立して扱う。 */
export const BASE_ESTIMATE_SPEC_CODE = 'base';

export interface EstimateTemplateChoice {
  code: string;
  name: string;
  description: string;
  preset: ModelPreset | null;
}

/**
 * 標準見積Excelが未登録の管理画面で使う表示候補。
 * 価格はここから作らない。標準見積の価格源はExcel取込データだけとする。
 */
export function estimateTemplatesFor(model: Pick<BaseModel, 'presets'>): EstimateTemplateChoice[] {
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
