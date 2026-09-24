/**
 * Rolling window used by the admin overview to aggregate 429 counts per route
 *. Isolated helper so callers read env at call time — the value
 * can be tuned via `RATE_LIMIT_METRICS_WINDOW_MS` without restart-free reloads.
 */
import { env } from '../../config/env.js';
export function getRateLimitMetricsWindowMs(): number {
    return env.RATE_LIMIT_METRICS_WINDOW_MS;
}
