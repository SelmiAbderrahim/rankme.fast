/**
 * Folds the raw research-history records of ONE Research press into one row.
 *
 * A Research press is two calls (volume/difficulty `metrics`, then search
 * `intent`), and the server logs one history record per call. Listing them raw
 * shows the same search twice. The records stay separate (each has its own
 * cached flag); only the list view folds them.
 *
 * Pairing rule (deterministic, documented here once):
 *   1. A `metrics` record and an `intent` record that carry the SAME non-null
 *      `lookupId` are one lookup. The client mints one UUID per press and sends
 *      it on both calls, so this is exact, whatever the timing.
 *   2. Records WITHOUT a `lookupId` (written before the column existed, or by
 *      an API caller that never sent one) pair only with other records without
 *      one, and only when ALL of these hold:
 *        - opposite kinds (one metrics, one intent);
 *        - the same market (location + language);
 *        - the same phrase set (case/whitespace-insensitive, order-insensitive);
 *        - created within LEGACY_PAIR_WINDOW_MS (60 s) of each other.
 *      Each record is used at most once and the NEAREST in time wins (ties go to
 *      the record earlier in the list), so two real searches of the same phrases
 *      a few seconds apart still produce two rows.
 *   3. A record with a `lookupId` never pairs with a legacy record; a record
 *      that finds no partner (a lone metrics, a lone intent, ideas, gap, ...)
 *      is its own row.
 *
 * The result is independent of page boundaries: the function runs over the
 * accumulated list, so a pair whose halves arrive on different pages folds as
 * soon as both are loaded.
 */
import { normalizePhraseKey } from '@shared/lib/phraseList';
import type { ResearchHistoryItem, ResearchHistoryKind } from './types';

export const LEGACY_PAIR_WINDOW_MS = 60_000;

export interface ResearchHistoryGroup {
  /** Row id: the metrics member when the group has one, else its first member. */
  id: string;
  /** The record "Search again" and "View results" act on (same as `id`). */
  primary: ResearchHistoryItem;
  /** Every folded record, newest first (1 or 2). */
  members: ResearchHistoryItem[];
  /** Kinds of the members, in the stable `KIND_ORDER` (not newest first). */
  kinds: ResearchHistoryKind[];
  phrases: string[];
  locationCode: number;
  languageCode: string;
  /** Result count of the primary record. */
  resultCount: number;
  /** True only when EVERY member was served without a vendor call. */
  cached: boolean;
  /** Newest member's time. */
  createdAt: string;
}

/** The one order lookup-type tags are shown in: a fresh Research press always reads "Metrics, Intent". */
const KIND_ORDER: readonly ResearchHistoryKind[] = [
  'metrics',
  'intent',
  'related',
  'ideas',
  'long_tail',
  'gap',
  'overview',
  'trends',
  'clusters',
];

export function sortKinds(kinds: readonly ResearchHistoryKind[]): ResearchHistoryKind[] {
  return [...kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
}

const PAIRABLE: ReadonlySet<ResearchHistoryKind> = new Set(['metrics', 'intent']);

function legacyKey(item: ResearchHistoryItem): string {
  const phrases = item.phrases.map(normalizePhraseKey).sort().join('\u0000');
  return `${item.locationCode}|${item.languageCode.toLowerCase()}|${phrases}`;
}

export function groupResearchHistory(items: readonly ResearchHistoryItem[]): ResearchHistoryGroup[] {
  const partnerOf = new Map<string, ResearchHistoryItem>();

  // Rule 1: shared lookupId.
  const byLookupId = new Map<string, { metrics?: ResearchHistoryItem; intent?: ResearchHistoryItem }>();
  for (const item of items) {
    if (item.lookupId === null || !PAIRABLE.has(item.kind)) continue;
    const slot = byLookupId.get(item.lookupId) ?? {};
    if (item.kind === 'metrics' && slot.metrics === undefined) slot.metrics = item;
    if (item.kind === 'intent' && slot.intent === undefined) slot.intent = item;
    byLookupId.set(item.lookupId, slot);
  }
  for (const { metrics, intent } of byLookupId.values()) {
    if (metrics && intent) {
      partnerOf.set(metrics.id, intent);
      partnerOf.set(intent.id, metrics);
    }
  }

  // Rule 2: legacy records, nearest-in-time first.
  const legacyByKey = new Map<string, { metrics: ResearchHistoryItem[]; intent: ResearchHistoryItem[] }>();
  for (const item of items) {
    if (item.lookupId !== null || !PAIRABLE.has(item.kind)) continue;
    const key = legacyKey(item);
    const bucket = legacyByKey.get(key) ?? { metrics: [], intent: [] };
    if (item.kind === 'metrics') bucket.metrics.push(item);
    else bucket.intent.push(item);
    legacyByKey.set(key, bucket);
  }
  for (const { metrics, intent } of legacyByKey.values()) {
    const taken = new Set<string>();
    for (const m of metrics) {
      let best: ResearchHistoryItem | null = null;
      let bestGap = Number.POSITIVE_INFINITY;
      for (const i of intent) {
        if (taken.has(i.id)) continue;
        const gap = Math.abs(Date.parse(m.createdAt) - Date.parse(i.createdAt));
        if (gap <= LEGACY_PAIR_WINDOW_MS && gap < bestGap) {
          best = i;
          bestGap = gap;
        }
      }
      if (best) {
        taken.add(best.id);
        partnerOf.set(m.id, best);
        partnerOf.set(best.id, m);
      }
    }
  }

  const groups: ResearchHistoryGroup[] = [];
  const emitted = new Set<string>();
  for (const item of items) {
    if (emitted.has(item.id)) continue;
    const partner = partnerOf.get(item.id);
    const members = partner ? [item, partner] : [item];
    for (const member of members) emitted.add(member.id);
    const primary = members.find((m) => m.kind === 'metrics') ?? members[0]!;
    groups.push({
      id: primary.id,
      primary,
      members,
      kinds: sortKinds(members.map((m) => m.kind)),
      phrases: primary.phrases,
      locationCode: primary.locationCode,
      languageCode: primary.languageCode,
      resultCount: primary.resultCount,
      cached: members.every((m) => m.cached),
      createdAt: item.createdAt,
    });
  }
  return groups;
}

/**
 * Kinds whose stored result can be re-opened from the cache (mirrors the
 * server's `readStoredResearchResult`). Gap, overview, trends and clusters have
 * their own tab / stored-run reads instead.
 */
const VIEWABLE_KINDS: ReadonlySet<ResearchHistoryKind> = new Set([
  'metrics',
  'intent',
  'related',
  'ideas',
  'long_tail',
]);

export function canViewStoredResult(group: Pick<ResearchHistoryGroup, 'kinds'>): boolean {
  return group.kinds.some((kind) => VIEWABLE_KINDS.has(kind));
}
