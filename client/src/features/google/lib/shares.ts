/** Allocate one-decimal shares so a complete breakdown totals exactly 100%. */
export function computeShares(values: readonly number[], total: number): Array<number | null> {
  if (!(total > 0) || !Number.isFinite(total)) return values.map(() => null);
  const tenths = values.map((value) => (Math.max(0, value) / total) * 1000);
  const sum = values.reduce((result, value) => result + Math.max(0, value), 0);
  if (Math.abs(sum - total) > 1e-9) {
    return tenths.map((value) => Math.round(Math.min(value, 1000)) / 10);
  }
  const ranked = tenths.map((value, index) => ({
    index,
    whole: Math.floor(value),
    remainder: value - Math.floor(value),
  }));
  let remaining = 1000 - ranked.reduce((result, entry) => result + entry.whole, 0);
  const roundedUp = new Set<number>();
  for (const entry of [...ranked].sort((left, right) =>
    right.remainder - left.remainder || left.index - right.index)) {
    if (remaining <= 0) break;
    roundedUp.add(entry.index);
    remaining -= 1;
  }
  return ranked.map((entry) => (entry.whole + (roundedUp.has(entry.index) ? 1 : 0)) / 10);
}

export function attachShares<T extends { value: number }>(rows: readonly T[], total: number): Array<T & { share: number | null }> {
  const shares = computeShares(rows.map((row) => row.value), total);
  return rows.map((row, index) => ({ ...row, share: shares[index] ?? null }));
}

export function formatShare(locale: string, share: number | null): string {
  if (share === null) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(share / 100);
}
