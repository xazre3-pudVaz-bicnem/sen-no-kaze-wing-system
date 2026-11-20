/** 商品指定を安全に解釈する。URL未指定と不正・重複指定は区別する。 */
export type ConfigurationOptionFilter = {
  hasFilter: boolean;
  optionId: string | null;
};

const OPTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseConfigurationOptionFilter(raw: unknown): ConfigurationOptionFilter {
  if (raw === undefined) return { hasFilter: false, optionId: null };
  if (typeof raw !== 'string') return { hasFilter: true, optionId: null };

  const optionId = raw.trim();
  return { hasFilter: true, optionId: OPTION_ID_PATTERN.test(optionId) ? optionId : null };
}
