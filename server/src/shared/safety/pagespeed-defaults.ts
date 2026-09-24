/**
 * PageSpeed sampling and cost authority.
 *
 * `PAGESPEED_SAMPLE_SIZE` is the number of additional pages after the site
 * root. Three additional pages means four paid Lighthouse scans at most.
 * DataForSEO publishes a unified Live/Standard price of $0.005 per page.
 */
export const PAGESPEED_ADDITIONAL_SAMPLE_MAX = 3;
export const PAGESPEED_MAX_SAMPLES_PER_AUDIT = PAGESPEED_ADDITIONAL_SAMPLE_MAX + 1;
export const DATAFORSEO_LIGHTHOUSE_SAMPLE_COST_MICROS = 5000n;
/** DataForSEO's documented account-level simultaneous Lighthouse ceiling. */
export const DATAFORSEO_LIGHTHOUSE_SIMULTANEOUS_LIMIT = 30;
/** Per-audit bounded queue width in the audit processor. */
export const PAGESPEED_CONCURRENCY_PER_AUDIT = 3;
/**
 * One composed worker process therefore runs at most ten audit jobs at once
 * when DataForSEO PageSpeed is selected: 10 × 3 = the vendor ceiling of 30.
 */
export const DATAFORSEO_AUDIT_WORKER_CONCURRENCY_MAX = Math.floor(DATAFORSEO_LIGHTHOUSE_SIMULTANEOUS_LIMIT / PAGESPEED_CONCURRENCY_PER_AUDIT);
/**
 * Four samples run in two waves. DataForSEO permits 120 seconds of processing
 * and the client allows 130 seconds; five seconds covers queue/serialization
 * overhead so PageSpeed is skipped unless this much audit budget remains.
 */
export const PAGESPEED_STAGE_DEADLINE_BUDGET_MS = 2 * 130000 + 5000;
