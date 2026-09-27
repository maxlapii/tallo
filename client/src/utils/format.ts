const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formats a decimal amount (e.g. 9.35) as "$9.35". */
export function money(amount: number | null | undefined): string {
  return currency.format(amount ?? 0);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * Category-calibrated tile colour from the POS palette (all readable with
 * slate-900 text). Unknown categories fall back to the neutral retail tile.
 */
export function categoryTint(categoryName: string | null | undefined): string {
  const n = (categoryName ?? '').toLowerCase();
  if (/(beverage|drink|coffee|tea|juice|soda|water)/.test(n)) return 'var(--cat-beverage-bg)';
  if (/(alcohol|beer|wine|spirit|liquor)/.test(n)) return 'var(--cat-alcohol-bg)';
  if (/(dessert|sweet|bakery|cake|pastry)/.test(n)) return 'var(--cat-dessert-bg)';
  if (/(appetizer|starter|snack|side)/.test(n)) return 'var(--cat-appetizer-bg)';
  if (/(food|entree|main|meal|burger|pizza|grill)/.test(n)) return 'var(--cat-entree-bg)';
  if (/(custom|open|manual|misc)/.test(n)) return 'var(--cat-custom-bg)';
  return 'var(--cat-retail-misc-bg)';
}

export function parseMoneyInput(value: string): number | null {
  const t = value.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
