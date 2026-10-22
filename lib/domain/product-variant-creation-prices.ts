/**
 * Read an additional choice price in tax-exclusive JPY from the original
 * on-screen row index. The row index is stable through a standard-choice switch.
 *
 * Older registration clients did not submit this field and saved 0 JPY.
 * Keep that compatibility while rejecting an explicitly blank or invalid value.
 */
export function parseChoiceExtraPrice(formData: FormData, rowIndex: number): number | null {
  const raw = formData.get(`choice_extra_price_${rowIndex}`);
  if (raw === null) return 0;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const amount = Number(raw.trim());
  return Number.isSafeInteger(amount) && amount <= 100_000_000 ? amount : null;
}
