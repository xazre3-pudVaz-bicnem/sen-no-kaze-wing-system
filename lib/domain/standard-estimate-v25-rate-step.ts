/**
 * Advance a valid percent string by precisely one percentage point.
 * The editor still validates 0–2 fractional digits and delegates rate limits
 * to the existing validation / DB. Do not normalize invalid in-progress typing.
 */
export function v25StepPercent(value: string, direction: -1 | 1): string {
  const raw = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return value;
  const [whole, fractional = ''] = raw.split('.');
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return value;
  const next = Math.max(0, cents + direction * 100);
  if (!Number.isSafeInteger(next)) return value;
  const remainder = String(next % 100).padStart(2, '0').replace(/0+$/, '');
  return String(Math.floor(next / 100)) + (remainder ? `.${remainder}` : '');
}
