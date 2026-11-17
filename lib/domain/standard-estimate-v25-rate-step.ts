import { V25_RATE_RULES } from './standard-estimate-v25-view';

export type V25RateKey = keyof typeof V25_RATE_RULES;

/**
 * Move by one percentage point only when the resulting value meets the exact
 * v2.5 save/publish rate limits. The limits live in V25_RATE_RULES, so the
 * spinner cannot drift away from the existing validation.
 *
 * This never normalizes unfinished or invalid direct input, and it never
 * clamps a fractional value to a bound (e.g. 149.50% + 1% remains 149.50%).
 */
export function v25StepPercent(value: string, direction: -1 | 1, key: V25RateKey): string {
  const raw = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return value;
  const [whole, fractional = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return value;

  const next = cents + direction * 100;
  const rule = V25_RATE_RULES[key];
  const lower = Math.round(rule.min * 10000);
  const upper = Math.round(rule.max * 10000);
  if (!Number.isSafeInteger(next) || next < lower || next > upper) return value;

  const remainder = String(next % 100).padStart(2, '0').replace(/0+$/, '');
  return String(Math.floor(next / 100)) + (remainder ? `.${remainder}` : '');
}
