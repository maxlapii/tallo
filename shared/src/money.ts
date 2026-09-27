/**
 * Money is handled as integer cents everywhere in business logic. Decimal
 * amounts only appear at the API boundary (JSON) and in the UI.
 */

/** Rounds half away from zero to the nearest integer (bankers' rounding is NOT used). */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Converts a decimal amount (e.g. 9.35) to integer cents (935). */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) throw new Error('Amount must be a finite number');
  return roundHalfUp(amount * 100);
}

/** Converts integer cents (935) to a decimal amount (9.35). */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** True when `amount` has at most two decimal places (within float tolerance). */
export function isValidMoney(amount: number): boolean {
  if (!Number.isFinite(amount)) return false;
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;
}

/** Formats cents as a fixed two-decimal string, e.g. 935 -> "9.35". */
export function formatCents(cents: number, currency = ''): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toLocaleString('en-US');
  return `${sign}${currency}${grouped}.${frac}`;
}

/** Percent (e.g. 7.5) to basis points (750). */
export function percentToBasisPoints(percent: number): number {
  return roundHalfUp(percent * 100);
}

/** Basis points (750) to percent (7.5). */
export function basisPointsToPercent(bp: number): number {
  return bp / 100;
}

/**
 * Splits `total` across `weights` proportionally so the parts sum exactly to
 * `total` (largest-remainder method). Used to allocate an order-level discount
 * across lines before tax is applied.
 */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sumWeights <= 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sumWeights);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder -= 1;
  }
  return result;
}
