import { describe, expect, it } from 'vitest';
import {
  PLAN_DISPLAY_SIZE_SPEC_LABEL,
  customerPlanName,
  normalizePlanDisplaySize,
  planDisplaySizeFromSpecs,
  publicSpecs,
  withPlanDisplaySize,
} from '@/lib/domain/plan-display';

describe('plan display helpers', () => {
  it('お客様表示名を優先し、未設定なら従来の「仕様→用」変換を使う', () => {
    expect(customerPlanName({ code: 'residence', name: '住宅仕様', display_name: '住まい用', description: '', option_codes: [] })).toBe('住まい用');
    expect(customerPlanName({ code: 'residence', name: '住宅仕様', description: '', option_codes: [] })).toBe('住宅用');
  });

  it('専用の平面図表示サイズを最優先し、未設定時は従来データへフォールバックする', () => {
    const specs = [
      { label: '展開後', value: '3,900 × 4,800 mm（18.72㎡）' },
      { label: PLAN_DISPLAY_SIZE_SPEC_LABEL, value: '3,900×4,800' },
    ];
    expect(planDisplaySizeFromSpecs(specs)).toBe('3,900×4,800');
    expect(planDisplaySizeFromSpecs(specs.slice(0, 1))).toContain('3,900');
  });

  it('管理用の表示サイズは公開スペックから除外して保存できる', () => {
    const specs = [{ label: '構造', value: '木造2×4' }];
    const saved = withPlanDisplaySize(specs, '3,900×4,800');
    expect(saved).toContainEqual({ label: PLAN_DISPLAY_SIZE_SPEC_LABEL, value: '3,900×4,800' });
    expect(publicSpecs(saved)).toEqual(specs);
  });

  it('平面図表示サイズを見出し用に整形する', () => {
    expect(normalizePlanDisplaySize('3,900 × 4,800 mm（18.72㎡）')).toBe('3,900×4,800');
  });
});
