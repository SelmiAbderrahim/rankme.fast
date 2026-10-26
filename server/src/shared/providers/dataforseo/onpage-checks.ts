/**
 * `/on_page/pages` per-page checks and size/link facts → vendor-neutral
 * `AuditPage` fields.
 *
 * Every name read here appears in the recorded fixtures
 * (`fixtures/dataforseo-onpage/pages/json-ld-undetected.json`,
 * `pages/sandbox-shape.json`) and in the `pages` endpoint documentation. The
 * thresholds behind the vendor booleans are the vendor's own, as documented
 * on docs.dataforseo.com/v3/on_page/pages and copied into `RULES.md`.
 *
 * Polarity: a vendor check phrased as a pass (`seo_friendly_url_*_check`) is
 * inverted so every normalized flag reads "the problem is present". A field
 * the vendor omitted stays absent — never `false`.
 *
 * Deliberately NOT read: `meta_charset_consistency`. The documentation says
 * `true` means the declared charset does NOT match, but the recorded healthy
 * UTF-8 page answers `true`, so its polarity cannot be trusted.
 */
import { z } from 'zod';
import type { AuditPage, AuditPageChecks } from '../types.js';

const optionalBoolean = z.boolean().nullable().optional();
const optionalNumber = z.number().nullable().optional();

/** The vendor check names this normalizer reads (all booleans). */
export const deepPageChecksSchema = z
  .object({
    is_4xx_code: optionalBoolean,
    is_5xx_code: optionalBoolean,
    is_redirect: optionalBoolean,
    redirect_chain: optionalBoolean,
    has_meta_refresh_redirect: optionalBoolean,
    has_links_to_redirects: optionalBoolean,
    canonical_chain: optionalBoolean,
    canonical_to_redirect: optionalBoolean,
    canonical_to_broken: optionalBoolean,
    recursive_canonical: optionalBoolean,
    is_link_relation_conflict: optionalBoolean,
    is_orphan_page: optionalBoolean,
    https_to_http_links: optionalBoolean,
    lorem_ipsum: optionalBoolean,
    low_content_rate: optionalBoolean,
    low_readability_rate: optionalBoolean,
    irrelevant_title: optionalBoolean,
    irrelevant_description: optionalBoolean,
    title_too_long: optionalBoolean,
    title_too_short: optionalBoolean,
    no_doctype: optionalBoolean,
    no_encoding_meta_tag: optionalBoolean,
    deprecated_html_tags: optionalBoolean,
    frame: optionalBoolean,
    flash: optionalBoolean,
    no_favicon: optionalBoolean,
    duplicate_meta_tags: optionalBoolean,
    no_image_alt: optionalBoolean,
    high_loading_time: optionalBoolean,
    high_waiting_time: optionalBoolean,
    large_page_size: optionalBoolean,
    size_greater_than_3mb: optionalBoolean,
    no_content_encoding: optionalBoolean,
    has_render_blocking_resources: optionalBoolean,
    seo_friendly_url_characters_check: optionalBoolean,
    seo_friendly_url_dynamic_check: optionalBoolean,
    seo_friendly_url_relative_length_check: optionalBoolean,
  })
  .passthrough();

/** `meta` fields this normalizer reads. */
export const deepPageMetaSchema = z
  .object({
    internal_links_count: optionalNumber,
    external_links_count: optionalNumber,
    inbound_links_count: optionalNumber,
    images_count: optionalNumber,
    render_blocking_scripts_count: optionalNumber,
    render_blocking_stylesheets_count: optionalNumber,
    social_media_tags: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough();

/** Item-level fields this normalizer reads. */
export const deepPageItemSchema = z
  .object({
    status_code: z.number(),
    click_depth: optionalNumber,
    size: optionalNumber,
    total_transfer_size: optionalNumber,
    content_encoding: z.string().nullable().optional(),
    duplicate_title: optionalBoolean,
    duplicate_description: optionalBoolean,
    duplicate_content: optionalBoolean,
    page_timing: z
      .object({ waiting_time: optionalNumber })
      .passthrough()
      .nullable()
      .optional(),
    checks: deepPageChecksSchema.nullable().optional(),
    meta: deepPageMetaSchema.nullable().optional(),
  })
  .passthrough();

type DeepPageItem = z.infer<typeof deepPageItemSchema>;

/** Vendor check → normalized flag, same polarity. */
const SAME_POLARITY: ReadonlyArray<readonly [keyof z.infer<typeof deepPageChecksSchema>, keyof AuditPageChecks]> = [
  ['is_4xx_code', 'clientError'],
  ['is_5xx_code', 'serverError'],
  ['is_redirect', 'redirects'],
  ['redirect_chain', 'reachedThroughRedirectChain'],
  ['has_meta_refresh_redirect', 'metaRefreshRedirect'],
  ['has_links_to_redirects', 'linksToRedirects'],
  ['canonical_chain', 'canonicalChain'],
  ['canonical_to_redirect', 'canonicalToRedirect'],
  ['canonical_to_broken', 'canonicalToBroken'],
  ['recursive_canonical', 'canonicalLoop'],
  ['is_link_relation_conflict', 'linkRelationConflict'],
  ['is_orphan_page', 'orphan'],
  ['https_to_http_links', 'insecureLinks'],
  ['lorem_ipsum', 'placeholderText'],
  ['low_content_rate', 'lowTextRatio'],
  ['low_readability_rate', 'lowReadability'],
  ['irrelevant_title', 'irrelevantTitle'],
  ['irrelevant_description', 'irrelevantDescription'],
  ['title_too_long', 'titleTooLong'],
  ['title_too_short', 'titleTooShort'],
  ['no_doctype', 'missingDoctype'],
  ['no_encoding_meta_tag', 'missingCharset'],
  ['deprecated_html_tags', 'deprecatedTags'],
  ['frame', 'frames'],
  ['flash', 'flash'],
  ['no_favicon', 'missingFavicon'],
  ['duplicate_meta_tags', 'duplicateMetaTags'],
  ['no_image_alt', 'imagesMissingAlt'],
  ['high_loading_time', 'slowLoad'],
  ['high_waiting_time', 'slowServerResponse'],
  ['large_page_size', 'largePage'],
  ['size_greater_than_3mb', 'veryLargePage'],
  ['no_content_encoding', 'uncompressed'],
  ['has_render_blocking_resources', 'renderBlocking'],
];

/** Vendor "passes" checks → normalized problem flags (inverted). */
const INVERTED: ReadonlyArray<readonly [keyof z.infer<typeof deepPageChecksSchema>, keyof AuditPageChecks]> = [
  ['seo_friendly_url_characters_check', 'urlHasUnusualCharacters'],
  ['seo_friendly_url_dynamic_check', 'urlHasParameters'],
  ['seo_friendly_url_relative_length_check', 'urlTooLong'],
];

/** Item-level duplicate booleans (they sit next to `checks`, not inside it). */
const ITEM_DUPLICATES: ReadonlyArray<readonly ['duplicate_title' | 'duplicate_description' | 'duplicate_content', keyof AuditPageChecks]> = [
  ['duplicate_title', 'duplicateTitle'],
  ['duplicate_description', 'duplicateDescription'],
  ['duplicate_content', 'duplicateContent'],
];

function normalizeChecks(item: DeepPageItem): AuditPageChecks | undefined {
  const raw = item.checks;
  if (!raw) return undefined;
  const out: AuditPageChecks = {};
  for (const [vendor, neutral] of SAME_POLARITY) {
    const value = raw[vendor];
    if (typeof value === 'boolean') out[neutral] = value;
  }
  for (const [vendor, neutral] of INVERTED) {
    const value = raw[vendor];
    if (typeof value === 'boolean') out[neutral] = !value;
  }
  for (const [vendor, neutral] of ITEM_DUPLICATES) {
    const value = item[vendor];
    if (typeof value === 'boolean') out[neutral] = value;
  }
  return out;
}

const nonNegative = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/**
 * Social tags present on the page. Only answered for a served page with a
 * `meta` block; `social_media_tags: null` there means none were found.
 */
function socialTags(meta: z.infer<typeof deepPageMetaSchema>): AuditPage['socialTags'] {
  const keys = Object.keys(meta.social_media_tags ?? {}).map((key) => key.toLowerCase());
  return {
    openGraph: keys.some((key) => key.startsWith('og:')),
    twitterCard: keys.some((key) => key.startsWith('twitter:')),
  };
}

type DeepPageFields = Pick<
  AuditPage,
  | 'checks'
  | 'clickDepth'
  | 'inboundInternalLinks'
  | 'outboundInternalLinks'
  | 'outboundExternalLinks'
  | 'pageSizeBytes'
  | 'transferSizeBytes'
  | 'serverResponseMs'
  | 'contentEncoding'
  | 'imageCount'
  | 'renderBlockingScripts'
  | 'renderBlockingStylesheets'
  | 'socialTags'
>;

/**
 * Deep crawl fields of one `/on_page/pages` row. A row that does not parse
 * against the deep schemas contributes nothing (the base normalizer already
 * validated the fields it needs), so a vendor drift here can never fail the
 * audit — the affected signals simply stay unmeasured.
 */
export function normalizeDeepPageFields(rawItem: unknown): DeepPageFields {
  const parsed = deepPageItemSchema.safeParse(rawItem);
  if (!parsed.success) return {};
  const item = parsed.data;
  const served = Math.floor(item.status_code / 100) === 2;
  const meta = served ? item.meta : undefined;
  const checks = normalizeChecks(item);
  const out: DeepPageFields = {};
  if (checks) out.checks = checks;
  const assign = <K extends keyof DeepPageFields>(key: K, value: DeepPageFields[K] | undefined): void => {
    if (value !== undefined) out[key] = value;
  };
  assign('clickDepth', nonNegative(item.click_depth));
  assign('pageSizeBytes', served ? nonNegative(item.size) : undefined);
  assign('transferSizeBytes', served ? nonNegative(item.total_transfer_size) : undefined);
  // A recorded crawl row reports `waiting_time: 0` when it did not time the
  // first byte; a zero time to first byte is not a measurement.
  const waiting = nonNegative(item.page_timing?.waiting_time);
  assign('serverResponseMs', served && waiting ? waiting : undefined);
  if (served && item.content_encoding !== undefined) {
    out.contentEncoding = item.content_encoding ? item.content_encoding.toLowerCase() : null;
  }
  if (meta) {
    assign('inboundInternalLinks', nonNegative(meta.inbound_links_count));
    assign('outboundInternalLinks', nonNegative(meta.internal_links_count));
    assign('outboundExternalLinks', nonNegative(meta.external_links_count));
    assign('imageCount', nonNegative(meta.images_count));
    assign('renderBlockingScripts', nonNegative(meta.render_blocking_scripts_count));
    assign('renderBlockingStylesheets', nonNegative(meta.render_blocking_stylesheets_count));
    out.socialTags = socialTags(meta);
  }
  return out;
}
