/**
 * Bucketing policy — one place, one direction: severity → bucket.
 *
 * Rules never invent a bucket themselves; they classify their own severity
 * and hand it to `bucketFor`. This keeps the visible fix-now/watch/passed
 * story consistent regardless of which rule authored it.
 */
import type { RuleBucket, RuleSeverity } from './rule.types.js';
export function bucketFor(severity: RuleSeverity, passed: boolean): RuleBucket {
    if (passed)
        return 'passed';
    if (severity === 'critical')
        return 'fix-now';
    return 'watch';
}
