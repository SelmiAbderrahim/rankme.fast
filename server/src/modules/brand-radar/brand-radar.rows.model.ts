/**
 * Brand Radar — retained mention rows + the per-scan mention summary.
 *
 * The scan document stores only ids: `retainedRowIds` point at
 * `BrandRadarMention` docs and `mentionSummaryId` at the single
 * `BrandRadarMentionSummary` doc. The rows themselves live here so the
 * deterministic aggregates and the digest citation check have a
 * stored set to read — the AI stage never sees anything that is not in this
 * collection.
 *
 * Every stored text field is output-encoded before persistence (HTML markers
 * stripped, control characters dropped) and clipped to the spec bounds:
 * snippet ≤300 chars, title ≤300 chars, domains ≤50 entries. Vendor-shaped
 * envelopes are never stored.
 */
import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
import type { ContentAnalysisMentionRow, ContentAnalysisMentionSummary, } from '../../shared/providers/types.js';
import { BRAND_RADAR_MAX_RETAINED_ROWS } from './brand-radar.model.js';
/** Bounds. */
export const BRAND_RADAR_SNIPPET_MAX_LENGTH = 300;
export const BRAND_RADAR_TITLE_MAX_LENGTH = 300;
export const BRAND_RADAR_TOP_DOMAINS_MAX = 50;
export const BRAND_RADAR_URL_MAX_LENGTH = 2048;
export const BRAND_RADAR_POLARITIES = [
    'positive',
    'neutral',
    'negative',
] as const;
export type BrandRadarPolarity = (typeof BRAND_RADAR_POLARITIES)[number];
/**
 * Output-encode untrusted vendor text before it is stored: angle brackets are
 * neutralized outright (so no tag, comment, or doctype fragment can survive
 * or be rebuilt), every Unicode "other" code point — control, format,
 * surrogate, unassigned, private-use — becomes a space, and whitespace runs
 * collapse. The result is inert in React, JSON-LD, PDF, and CSV alike.
 */
export function encodeMentionText(input: string): string {
    return input
        .replace(/[<>]/gu, ' ')
        .replace(/\p{C}/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}
/** Encode then clip. Clipping happens AFTER encoding so the bound is honest. */
export function clipMentionText(input: string, max: number): string {
    return encodeMentionText(input).slice(0, max);
}
const mentionSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    scanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BrandRadarScan',
        required: true,
        index: true,
    },
    url: { type: String, required: true, maxlength: BRAND_RADAR_URL_MAX_LENGTH },
    domain: { type: String, required: true, maxlength: 253 },
    // `required` is deliberately absent on the two free-text fields: mongoose
    // treats an empty string as "missing", and a mention with no title or no
    // snippet is a legitimate vendor row we must keep rather than reject.
    title: { type: String, default: '', maxlength: BRAND_RADAR_TITLE_MAX_LENGTH },
    snippet: { type: String, default: '', maxlength: BRAND_RADAR_SNIPPET_MAX_LENGTH },
    polarity: {
        type: String,
        enum: BRAND_RADAR_POLARITIES,
        required: true,
        default: 'neutral',
    },
    confidence: { type: Number, default: null, min: 0, max: 1 },
    language: { type: String, default: null, maxlength: 16 },
    observedAt: { type: Date, default: null },
}, { timestamps: true, strict: 'throw' });
mentionSchema.index({ scanId: 1, createdAt: 1 });
export type BrandRadarMentionDocument = InferSchemaType<typeof mentionSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type BrandRadarMentionHydrated = HydratedDocument<BrandRadarMentionDocument>;
export const BrandRadarMention = mongoose.model('BrandRadarMention', mentionSchema);
const topDomainSchema = new mongoose.Schema({
    domain: { type: String, required: true, maxlength: 253 },
    mentions: { type: Number, required: true, min: 0 },
}, { _id: false, strict: 'throw' });
const mentionSummarySchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    scanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BrandRadarScan',
        required: true,
        unique: true,
    },
    totalMentions: { type: Number, required: true, min: 0, default: 0 },
    distribution: {
        type: new mongoose.Schema({
            positive: { type: Number, required: true, min: 0, default: 0 },
            neutral: { type: Number, required: true, min: 0, default: 0 },
            negative: { type: Number, required: true, min: 0, default: 0 },
        }, { _id: false, strict: 'throw' }),
        required: true,
        default: () => ({ positive: 0, neutral: 0, negative: 0 }),
    },
    // Bounded to ≤50 by `persistMentionSummary` before the write — the clamp
    // is the enforcement point, so no schema validator duplicates it here
    // (upsert writes do not run validators anyway).
    topDomains: { type: [topDomainSchema], required: true, default: () => [] },
}, { timestamps: true, strict: 'throw' });
export type BrandRadarMentionSummaryDocument = InferSchemaType<typeof mentionSummarySchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type BrandRadarMentionSummaryHydrated = HydratedDocument<BrandRadarMentionSummaryDocument>;
export const BrandRadarMentionSummary = mongoose.model('BrandRadarMentionSummary', mentionSummarySchema);
export interface PersistMentionRowsInput {
    accountId: string;
    scanId: string;
    rows: readonly ContentAnalysisMentionRow[];
}
function normalizedPolarity(row: ContentAnalysisMentionRow): BrandRadarPolarity {
    const polarity = row.sentiment?.polarity;
    // Unknown / absent polarity lands in the neutral bucket (aggregate
    // contract) — never dropped, never invented.
    return polarity === 'positive' || polarity === 'negative'
        ? polarity
        : 'neutral';
}
function normalizedDomain(row: ContentAnalysisMentionRow): string {
    const declared = encodeMentionText(row.domain ?? '').toLowerCase();
    if (declared)
        return declared.slice(0, 253);
    try {
        return new URL(row.url).hostname.toLowerCase().slice(0, 253);
    }
    catch {
        return 'unknown';
    }
}
function normalizedConfidence(row: ContentAnalysisMentionRow): number | null {
    const value = row.sentiment?.confidence;
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return Math.min(1, Math.max(0, value));
}
function normalizedObservedAt(row: ContentAnalysisMentionRow): Date | null {
    if (!row.observedAt)
        return null;
    const parsed = new Date(row.observedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
/**
 * Persist the retained rows (≤1000) and return their ids in vendor order.
 * Storage is output-encoded and clipped; nothing vendor-shaped survives.
 */
export async function persistMentionRows(input: PersistMentionRowsInput): Promise<string[]> {
    const retained = input.rows.slice(0, BRAND_RADAR_MAX_RETAINED_ROWS);
    if (retained.length === 0)
        return [];
    const docs = await BrandRadarMention.insertMany(retained.map((row) => ({
        accountId: input.accountId,
        scanId: input.scanId,
        url: clipMentionText(row.url, BRAND_RADAR_URL_MAX_LENGTH),
        domain: normalizedDomain(row),
        title: clipMentionText(row.title ?? '', BRAND_RADAR_TITLE_MAX_LENGTH),
        snippet: clipMentionText(row.snippet ?? '', BRAND_RADAR_SNIPPET_MAX_LENGTH),
        polarity: normalizedPolarity(row),
        confidence: normalizedConfidence(row),
        language: row.language ? clipMentionText(row.language, 16) : null,
        observedAt: normalizedObservedAt(row),
    })), { ordered: true });
    return docs.map((doc) => String(doc._id));
}
/**
 * A stored mention row, flattened to the fields a reader is allowed to see:
 * no account id, no scan id, no vendor envelope — only the bounded,
 * output-encoded values this collection persisted.
 *
 * `url` is present because the mention-inventory read serves it as a
 * safe outbound link. The digest stage does NOT receive it: `buildDigestInput`
 * picks its own narrower subset — id, domain, title, snippet,
 * polarity, observedAt — so the AI stage still never sees a mention URL.
 */
export interface StoredMentionRow {
    id: string;
    url: string;
    domain: string;
    title: string;
    snippet: string;
    polarity: BrandRadarPolarity;
    confidence: number | null;
    language: string | null;
    observedAt: Date | null;
}
/**
 * Shared projection — every reader returns exactly `StoredMentionRow`.
 * `createdAt` rides along because it is the keyset sort field the page cursor
 * is built from; it is never serialized into a DTO.
 */
const STORED_ROW_PROJECTION = {
    createdAt: 1,
    url: 1,
    domain: 1,
    title: 1,
    snippet: 1,
    polarity: 1,
    confidence: 1,
    language: 1,
    observedAt: 1,
} as const;
function toStoredRow(doc: BrandRadarMentionHydrated): StoredMentionRow {
    return {
        id: String(doc._id),
        url: doc.url,
        domain: doc.domain,
        title: doc.title,
        snippet: doc.snippet,
        polarity: doc.polarity as BrandRadarPolarity,
        confidence: doc.confidence ?? null,
        language: doc.language ?? null,
        observedAt: doc.observedAt ?? null,
    };
}
/** Clamp a caller-supplied page/read size into `1..max`; absent → `fallback`. */
function clampRowLimit(limit: number | undefined, max: number, fallback = max): number {
    return Math.min(Math.max(1, Math.floor(limit ?? fallback)), max);
}
export interface ReadMentionRowsInput {
    accountId: string;
    scanId: string;
    /** Optional ceiling; the read is naturally bounded by the ≤1000 row cap. */
    limit?: number;
}
/**
 * Read the rows a scan actually stored, oldest first — the same order they
 * were retained in, so a digest citation always points at a stable row.
 */
export async function readMentionRows(input: ReadMentionRowsInput): Promise<StoredMentionRow[]> {
    const docs = await BrandRadarMention.find({
        accountId: input.accountId,
        scanId: input.scanId,
    })
        .sort({ createdAt: 1, _id: 1 })
        .limit(clampRowLimit(input.limit, BRAND_RADAR_MAX_RETAINED_ROWS))
        .select(STORED_ROW_PROJECTION);
    return docs.map(toStoredRow);
}
/** Keyset page bound: the inventory read never returns more at once. */
export const BRAND_RADAR_MENTION_PAGE_MAX = 100;
export const BRAND_RADAR_MENTION_PAGE_DEFAULT = 50;
/**
 * Decoded keyset cursor. The base64url codec lives in the service
 * (`encodeBrandRadarCursor` / `decodeBrandRadarCursor`) — this model takes and
 * returns the decoded shape so there is exactly one cursor codec in the
 * module and no import cycle between the service and this file.
 */
export interface MentionRowCursor {
    createdAt: string;
    id: string;
}
export interface ReadMentionRowsPageInput {
    accountId: string;
    scanId: string;
    /** Clamped to `1..100`; absent → 50. */
    limit?: number;
    cursor?: MentionRowCursor | null;
}
export interface MentionRowPage {
    items: StoredMentionRow[];
    nextCursor: MentionRowCursor | null;
}
/**
 * Keyset-paginated sibling of `readMentionRows`, in the same retention order
 * (`createdAt` ASC, `_id` ASC) the digest citations rely on. The collection is
 * already bounded at `BRAND_RADAR_MAX_RETAINED_ROWS`, so this is a bounded
 * read of bounded stored data — no vendor call, no spend.
 */
export async function readMentionRowsPage(input: ReadMentionRowsPageInput): Promise<MentionRowPage> {
    const limit = clampRowLimit(input.limit, BRAND_RADAR_MENTION_PAGE_MAX, BRAND_RADAR_MENTION_PAGE_DEFAULT);
    const filter: Record<string, unknown> = {
        accountId: input.accountId,
        scanId: input.scanId,
    };
    if (input.cursor) {
        const createdAt = new Date(input.cursor.createdAt);
        filter.$or = [
            { createdAt: { $gt: createdAt } },
            { createdAt, _id: { $gt: new mongoose.Types.ObjectId(input.cursor.id) } },
        ];
    }
    const docs = await BrandRadarMention.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .limit(limit + 1)
        .select(STORED_ROW_PROJECTION);
    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page.at(-1);
    return {
        items: page.map(toStoredRow),
        nextCursor: hasMore && last
            ? { createdAt: last.createdAt.toISOString(), id: String(last._id) }
            : null,
    };
}
export interface PersistMentionSummaryInput {
    accountId: string;
    scanId: string;
    summary: ContentAnalysisMentionSummary;
}
/** Persist the vendor summary (bounded, encoded) and return its id. */
export async function persistMentionSummary(input: PersistMentionSummaryInput): Promise<string> {
    const { summary } = input;
    const doc = await BrandRadarMentionSummary.findOneAndUpdate({ scanId: input.scanId }, {
        $set: {
            accountId: input.accountId,
            scanId: input.scanId,
            totalMentions: Math.max(0, Math.floor(summary.totalMentions ?? 0)),
            distribution: {
                positive: Math.max(0, Math.floor(summary.distribution?.positive ?? 0)),
                neutral: Math.max(0, Math.floor(summary.distribution?.neutral ?? 0)),
                negative: Math.max(0, Math.floor(summary.distribution?.negative ?? 0)),
            },
            topDomains: (summary.topDomains ?? [])
                .slice(0, BRAND_RADAR_TOP_DOMAINS_MAX)
                .map((entry) => ({
                domain: encodeMentionText(entry.domain).toLowerCase().slice(0, 253),
                mentions: Math.max(0, Math.floor(entry.mentions)),
            })),
        },
    }, { upsert: true, new: true });
    return String(doc._id);
}
