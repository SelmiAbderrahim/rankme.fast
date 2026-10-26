/**
 * Client mirror of `server/src/modules/local-seo/review-sync.targets.ts`
 * . The server re-validates every save; keep the two in
 * lockstep — both test suites run the same case table
 * (`server/src/modules/local-seo/review-target-cases.json`).
 *
 * The Google Place ID rule is a HEURISTIC: Google documents no fixed length
 * or alphabet, so we accept the known ID families (`ChIJ`, `GhIJ`, `EhIJ`,
 * `Ei`), a base64url body, at least 20 characters, plus `place_id:<id>` and
 * `cid:<digits>`. A format-valid ID is "saved", never "verified" — only a
 * successful sync proves the vendor can resolve it.
 */
import { validateSiteUrl } from '@features/sites';
import type { ReviewSourceName } from './types';

export const REVIEW_TARGET_MAX_CHARS = 200;
export const GOOGLE_PLACE_ID_MIN_LENGTH = 20;

const GOOGLE_PLACE_ID_PATTERN = /^(?:ChIJ|GhIJ|EhIJ|Ei)[A-Za-z0-9_-]+={0,2}$/;
const GOOGLE_CID_PATTERN = /^cid:\d{1,20}$/;
const TRIPADVISOR_LOCATION_PATTERN = /^(?:location_id:|d)?(\d{1,12})$/i;

function normalizeGoogle(value: string): string | null {
  if (GOOGLE_CID_PATTERN.test(value)) return value;
  const id = value.startsWith('place_id:') ? value.slice('place_id:'.length) : value;
  return id.length >= GOOGLE_PLACE_ID_MIN_LENGTH && GOOGLE_PLACE_ID_PATTERN.test(id) ? value : null;
}

function normalizeTrustpilot(value: string): string | null {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return null;
  const parsed = validateSiteUrl(`https://${value}`);
  if (!parsed.ok || parsed.domain.length > REVIEW_TARGET_MAX_CHARS) return null;
  return parsed.domain.toLowerCase().replace(/^www\./, '');
}

function normalizeTripadvisor(value: string): string | null {
  const match = TRIPADVISOR_LOCATION_PATTERN.exec(value);
  return match?.[1] ?? null;
}

/** The value to send/store for `raw`, or `null` when it cannot identify a business. */
export function normalizeReviewTarget(source: ReviewSourceName, raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > REVIEW_TARGET_MAX_CHARS) return null;
  if (source === 'google') return normalizeGoogle(value);
  if (source === 'trustpilot') return normalizeTrustpilot(value);
  return normalizeTripadvisor(value);
}
