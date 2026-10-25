/**
 * Bucketing policy — one place, one direction: severity → bucket.
 *
 * Rules never invent a bucket themselves; they classify their own severity
 * and hand it to `bucketFor`. This keeps the visible fix-now/watch/passed
 * story consistent regardless of which rule authored it.
 */
import type { RuleBucket, RuleSeverity } from './rule.types.js';
export function bucketFor(severity: RuleSeverity, passed: boolean, options: {
    fixNow?: boolean;
} = {}): RuleBucket {
    if (passed)
        return 'passed';
    // A rule's own policy may send a warning-level failure to fix-now (a page
    // over 3 MB, a broken image): visitors are hit now, though the page still
    // works. The rule states why; the mapping stays here.
    if (severity === 'critical' || options.fixNow === true)
        return 'fix-now';
    return 'watch';
}
