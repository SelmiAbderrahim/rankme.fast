import { normalizeReviewTarget } from './targets';
import type { ReviewRun, ReviewSource } from './types';

/**
 * What we can honestly say about a configured source:
 * - `invalid`  — the saved value no longer passes the format rules (saved
 *                before they existed); re-save it.
 * - `verified` — a sync run AFTER the target was last saved got reviews back
 *                (or only already-stored ones) from this source.
 * - `failed`   — the newest such sync failed for this source.
 * - `saved`    — the format is fine, but no sync has tried it yet.
 */
export type SourceReadiness = 'invalid' | 'verified' | 'failed' | 'saved';

export function sourceReadiness(source: ReviewSource, runs: readonly ReviewRun[]): SourceReadiness {
  if (normalizeReviewTarget(source.source, source.target) === null) return 'invalid';
  const savedAt = Date.parse(source.updatedAt);
  let newest: { at: number; ok: boolean } | null = null;
  for (const run of runs) {
    const at = Date.parse(run.createdAt);
    if (at < savedAt) continue;
    const outcome = run.perSourceOutcomes.find((entry) => entry.source === source.source);
    if (!outcome) continue;
    if (newest === null || at > newest.at) {
      newest = { at, ok: outcome.outcome !== 'failed' };
    }
  }
  if (newest === null) return 'saved';
  return newest.ok ? 'verified' : 'failed';
}
