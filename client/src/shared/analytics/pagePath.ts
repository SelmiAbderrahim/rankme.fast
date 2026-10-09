/**
 * Page-path scrubbing for analytics. The signed-in app embeds site, run, and
 * capability identifiers in its URLs (`/sites/<id>/audits/<id>`, `/share/<token>`)
 * and keeps view state in the query (`?tab=keywords`). None of that may reach a
 * third-party tracker, so the reported path keeps the route shape and drops
 * every dynamic value, the query string, and the hash.
 */

/** Path segments whose NEXT segment is a capability token, never a slug. */
const TOKEN_PARENTS = new Set(['accept', 'reject', 'share', 'portal']);

const OBJECT_ID = /^[0-9a-f]{24}$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NUMERIC = /^\d+$/u;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{20,}$/u;

const isOpaqueToken = (segment: string): boolean =>
  OPAQUE_TOKEN.test(segment) && /\d/u.test(segment) && /[A-Za-z]/u.test(segment);

const isDynamicId = (segment: string): boolean =>
  OBJECT_ID.test(segment) ||
  UUID.test(segment) ||
  NUMERIC.test(segment) ||
  isOpaqueToken(segment);

/** `/sites/6aba…/keywords?tab=x#y` -> `/sites/:id/keywords`. */
export function sanitizeAnalyticsPath(pathname: string): string {
  const segments = pathname.split('/');
  let previous = '';
  const scrubbed = segments.map((segment) => {
    const redact = segment !== '' && (TOKEN_PARENTS.has(previous) || isDynamicId(segment));
    previous = segment;
    return redact ? ':id' : segment;
  });
  return scrubbed.join('/') || '/';
}
