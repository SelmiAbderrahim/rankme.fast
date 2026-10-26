/** Search Console / GA4 windows — identical to the Google tab's range picker. */
export const READ_RANGES = ['7d', '28d', '90d'] as const;
export type ReadRange = (typeof READ_RANGES)[number];
export const READ_RANGE_DEFAULT: ReadRange = '28d';
