import type { WindowType } from './types';

/**
 * 商品の窓タイプの選択肢（v2.5 PR-S2）。新しく選べるのは「使う」窓タイプだけ。
 * 登録済みの商品に設定済みの「使わない」窓タイプは、そのまま残せるよう選択肢に残す（DB のトリガーも、変えない限り通す）。
 * 新しく登録する商品（複製を含む）には currentCode を渡さない
 */
export function windowTypeChoices(windowTypes: WindowType[], currentCode: string | null | undefined): WindowType[] {
  return windowTypes.filter((row) => row.status === 'active' || (Boolean(currentCode) && row.code === currentCode));
}

/** 窓タイプの名前（マスターに無いコードはコードのまま。未設定は null） */
export function windowTypeLabelOf(windowTypes: Pick<WindowType, 'code' | 'label'>[], code: string | null | undefined): string | null {
  if (!code) return null;
  return windowTypes.find((row) => row.code === code)?.label ?? code;
}

/** 新しく登録する商品に引き継げる窓タイプ（複製元の窓タイプが「使う」のときだけ） */
export function copiedWindowTypeCode(windowTypes: WindowType[], code: string | null | undefined): string | null {
  return code && windowTypes.some((row) => row.code === code && row.status === 'active') ? code : null;
}
