/** Vendor page checks normalized into observable, provider-neutral facts. */
import { z } from 'zod';
import type { AuditPage, AuditPageChecks } from '../types.js';

const optionalBoolean = z.boolean().nullable().optional();
const optionalNumber = z.number().nullable().optional();

export const deepPageChecksSchema = z.object({
    is_4xx_code: optionalBoolean, is_5xx_code: optionalBoolean, is_redirect: optionalBoolean,
    redirect_chain: optionalBoolean, has_meta_refresh_redirect: optionalBoolean,
    has_links_to_redirects: optionalBoolean, canonical_chain: optionalBoolean,
    canonical_to_redirect: optionalBoolean, canonical_to_broken: optionalBoolean,
    recursive_canonical: optionalBoolean, is_link_relation_conflict: optionalBoolean,
    is_orphan_page: optionalBoolean, https_to_http_links: optionalBoolean,
    lorem_ipsum: optionalBoolean, low_content_rate: optionalBoolean,
    low_readability_rate: optionalBoolean, irrelevant_title: optionalBoolean,
    irrelevant_description: optionalBoolean, title_too_long: optionalBoolean,
    title_too_short: optionalBoolean, no_doctype: optionalBoolean,
    no_encoding_meta_tag: optionalBoolean, deprecated_html_tags: optionalBoolean,
    frame: optionalBoolean, flash: optionalBoolean, no_favicon: optionalBoolean,
    duplicate_meta_tags: optionalBoolean, no_image_alt: optionalBoolean,
    high_loading_time: optionalBoolean, high_waiting_time: optionalBoolean,
    large_page_size: optionalBoolean, size_greater_than_3mb: optionalBoolean,
    no_content_encoding: optionalBoolean, has_render_blocking_resources: optionalBoolean,
    seo_friendly_url_characters_check: optionalBoolean,
    seo_friendly_url_dynamic_check: optionalBoolean,
    seo_friendly_url_relative_length_check: optionalBoolean,
}).passthrough();

export const deepPageMetaSchema = z.object({
    internal_links_count: optionalNumber, external_links_count: optionalNumber,
    inbound_links_count: optionalNumber, images_count: optionalNumber,
    render_blocking_scripts_count: optionalNumber,
    render_blocking_stylesheets_count: optionalNumber,
    social_media_tags: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough();

export const deepPageItemSchema = z.object({
    status_code: z.number(), click_depth: optionalNumber, size: optionalNumber,
    total_transfer_size: optionalNumber, content_encoding: z.string().nullable().optional(),
    duplicate_title: optionalBoolean, duplicate_description: optionalBoolean,
    duplicate_content: optionalBoolean,
    page_timing: z.object({ waiting_time: optionalNumber }).passthrough().nullable().optional(),
    checks: deepPageChecksSchema.nullable().optional(),
    meta: deepPageMetaSchema.nullable().optional(),
}).passthrough();

type DeepPageItem = z.infer<typeof deepPageItemSchema>;
type VendorChecks = z.infer<typeof deepPageChecksSchema>;

const samePolarity: ReadonlyArray<readonly [keyof VendorChecks, keyof AuditPageChecks]> = [
    ['is_4xx_code', 'clientError'], ['is_5xx_code', 'serverError'], ['is_redirect', 'redirects'],
    ['redirect_chain', 'reachedThroughRedirectChain'], ['has_meta_refresh_redirect', 'metaRefreshRedirect'],
    ['has_links_to_redirects', 'linksToRedirects'], ['canonical_chain', 'canonicalChain'],
    ['canonical_to_redirect', 'canonicalToRedirect'], ['canonical_to_broken', 'canonicalToBroken'],
    ['recursive_canonical', 'canonicalLoop'], ['is_link_relation_conflict', 'linkRelationConflict'],
    ['is_orphan_page', 'orphan'], ['https_to_http_links', 'insecureLinks'],
    ['lorem_ipsum', 'placeholderText'], ['low_content_rate', 'lowTextRatio'],
    ['low_readability_rate', 'lowReadability'], ['irrelevant_title', 'irrelevantTitle'],
    ['irrelevant_description', 'irrelevantDescription'], ['title_too_long', 'titleTooLong'],
    ['title_too_short', 'titleTooShort'], ['no_doctype', 'missingDoctype'],
    ['no_encoding_meta_tag', 'missingCharset'], ['deprecated_html_tags', 'deprecatedTags'],
    ['frame', 'frames'], ['flash', 'flash'], ['no_favicon', 'missingFavicon'],
    ['duplicate_meta_tags', 'duplicateMetaTags'], ['no_image_alt', 'imagesMissingAlt'],
    ['high_loading_time', 'slowLoad'], ['high_waiting_time', 'slowServerResponse'],
    ['large_page_size', 'largePage'], ['size_greater_than_3mb', 'veryLargePage'],
    ['no_content_encoding', 'uncompressed'], ['has_render_blocking_resources', 'renderBlocking'],
];
const inverted: ReadonlyArray<readonly [keyof VendorChecks, keyof AuditPageChecks]> = [
    ['seo_friendly_url_characters_check', 'urlHasUnusualCharacters'],
    ['seo_friendly_url_dynamic_check', 'urlHasParameters'],
    ['seo_friendly_url_relative_length_check', 'urlTooLong'],
];
const duplicates: ReadonlyArray<readonly ['duplicate_title' | 'duplicate_description' | 'duplicate_content', keyof AuditPageChecks]> = [
    ['duplicate_title', 'duplicateTitle'], ['duplicate_description', 'duplicateDescription'],
    ['duplicate_content', 'duplicateContent'],
];

const nonNegative = (value: number | null | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

type DeepPageFields = Pick<AuditPage, 'checks' | 'clickDepth' | 'inboundInternalLinks' |
    'outboundInternalLinks' | 'outboundExternalLinks' | 'pageSizeBytes' | 'transferSizeBytes' |
    'serverResponseMs' | 'contentEncoding' | 'imageCount' | 'renderBlockingScripts' |
    'renderBlockingStylesheets' | 'socialTags'>;

function normalizeChecks(item: DeepPageItem): AuditPageChecks | undefined {
    const out: AuditPageChecks = {};
    for (const [vendor, neutral] of samePolarity) {
        const value = item.checks?.[vendor];
        if (typeof value === 'boolean') out[neutral] = value;
    }
    for (const [vendor, neutral] of inverted) {
        const value = item.checks?.[vendor];
        if (typeof value === 'boolean') out[neutral] = !value;
    }
    for (const [vendor, neutral] of duplicates) {
        const value = item[vendor];
        if (typeof value === 'boolean') out[neutral] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** A shape drift drops only deep facts; the base page parse remains authoritative. */
export function normalizeDeepPageFields(raw: unknown): DeepPageFields {
    const parsed = deepPageItemSchema.safeParse(raw);
    if (!parsed.success) return {};
    const item = parsed.data;
    const served = Math.floor(item.status_code / 100) === 2;
    const out: DeepPageFields = {};
    const checks = normalizeChecks(item);
    if (checks) out.checks = checks;
    const depth = nonNegative(item.click_depth);
    if (depth !== undefined) out.clickDepth = depth;
    if (!served) return out;
    const size = nonNegative(item.size);
    if (size !== undefined) out.pageSizeBytes = size;
    const transfer = nonNegative(item.total_transfer_size);
    if (transfer !== undefined) out.transferSizeBytes = transfer;
    const waiting = nonNegative(item.page_timing?.waiting_time);
    if (waiting) out.serverResponseMs = waiting;
    if (item.content_encoding !== undefined) {
        out.contentEncoding = item.content_encoding ? item.content_encoding.toLowerCase() : null;
    }
    const meta = item.meta;
    if (meta) {
        const inbound = nonNegative(meta.inbound_links_count);
        if (inbound !== undefined) out.inboundInternalLinks = inbound;
        const internal = nonNegative(meta.internal_links_count);
        if (internal !== undefined) out.outboundInternalLinks = internal;
        const external = nonNegative(meta.external_links_count);
        if (external !== undefined) out.outboundExternalLinks = external;
        const images = nonNegative(meta.images_count);
        if (images !== undefined) out.imageCount = images;
        const scripts = nonNegative(meta.render_blocking_scripts_count);
        if (scripts !== undefined) out.renderBlockingScripts = scripts;
        const styles = nonNegative(meta.render_blocking_stylesheets_count);
        if (styles !== undefined) out.renderBlockingStylesheets = styles;
        const tags = Object.keys(meta.social_media_tags ?? {}).map((tag) => tag.toLowerCase());
        out.socialTags = { openGraph: tags.some((tag) => tag.startsWith('og:')),
            twitterCard: tags.some((tag) => tag.startsWith('twitter:')) };
    }
    return out;
}
