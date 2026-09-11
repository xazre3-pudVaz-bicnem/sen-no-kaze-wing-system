import type { ModelPreset } from '@/lib/domain/types';

export const PLAN_DISPLAY_SIZE_SPEC_LABEL = '平面図表示サイズ（管理用）';

type Spec = { label: string; value: string };

export function customerPlanName(preset: ModelPreset | null | undefined, fallbackName = ''): string {
  const explicit = preset?.display_name?.trim();
  if (explicit) return explicit;
  const source = preset?.name?.trim() || fallbackName.trim();
  return source ? source.replace('仕様', '用') : '';
}

export function planDisplaySizeFromSpecs(specs: Spec[]): string | null {
  return (
    specs.find((spec) => spec.label === PLAN_DISPLAY_SIZE_SPEC_LABEL)?.value ??
    specs.find((spec) => spec.label === '展開後')?.value ??
    specs.find((spec) => spec.label.includes('床面積'))?.value ??
    null
  );
}

export function normalizePlanDisplaySize(value: string | null | undefined): string {
  return value?.split('（')[0]?.replace(/\s*mm$/, '').replace(/\s*×\s*/g, '×').trim() ?? '';
}

export function publicSpecs(specs: Spec[]): Spec[] {
  return specs.filter((spec) => spec.label !== PLAN_DISPLAY_SIZE_SPEC_LABEL);
}

export function withPlanDisplaySize(specs: Spec[], value: string): Spec[] {
  const visible = publicSpecs(specs);
  const trimmed = value.trim();
  return trimmed ? [...visible, { label: PLAN_DISPLAY_SIZE_SPEC_LABEL, value: trimmed }] : visible;
}
