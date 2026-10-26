/** Integer-count axis with a visible zero baseline and readable whole steps. */
export function niceScale(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rawStep = max / 4;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const ratio = rawStep / power;
  const step = Math.max(1, power * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10));
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { top, ticks };
}

/** First and last point, plus evenly spaced labels within the available width. */
export function tickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, index) => index);
  const last = count - 1;
  const slots = Math.max(1, maxTicks - 1);
  const picked = new Set<number>();
  for (let slot = 0; slot <= slots; slot += 1) picked.add(Math.round((slot * last) / slots));
  return [...picked].sort((left, right) => left - right);
}
