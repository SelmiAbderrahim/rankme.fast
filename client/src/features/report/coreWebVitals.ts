import type { CoreWebVitalsCategory, PageSpeedSample } from './types';

const CATEGORY_RANK: Record<CoreWebVitalsCategory, number> = {
  good: 0,
  'needs-improvement': 1,
  poor: 2,
};

/**
 * Site-level Core Web Vitals verdict for one audit: the worst real-visitor
 * (Chrome UX Report) category across every sampled page, or `null` when no
 * sample carries field data. Mirrors the server `core-web-vitals-poor` rule
 * (poor → Fix now, needs improvement → Watch, good → Passed), so any surface
 * that summarizes Core Web Vitals agrees with the finding. Lab scores never
 * count here.
 */
export function worstCoreWebVitalsCategory(
  samples: readonly Pick<PageSpeedSample, 'coreWebVitals'>[],
): CoreWebVitalsCategory | null {
  let worst: CoreWebVitalsCategory | null = null;
  for (const sample of samples) {
    const category = sample.coreWebVitals?.category;
    if (!category) continue;
    if (worst === null || CATEGORY_RANK[category] > CATEGORY_RANK[worst]) worst = category;
  }
  return worst;
}
