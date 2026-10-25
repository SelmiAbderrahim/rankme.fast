import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * Schema markup generation service.
 *
 * Generation is INLINE and bounded: one `schema_generator` AI pass under its
 * per-run cost ceiling, so there is no queue, no worker consumer and no
 * reconciliation sweep to keep honest.
 *
 * Order on the create path:
 *   parse → own site (404) → flag → evidence/profile preflight
 *   → AI fill → traceability post-check
 *   → assemble document → serialize → conformance → persist.
 *
 * The AI never touches the payload. It only chooses WHICH supplied fact fills
 * an `ai-selected` property; `checkTraceability` re-proves the choice and
 * `buildSchemaDocument` re-reads the value from the stored fact. Deterministic
 * properties are assembler-owned end to end.
 */
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { JSON_LD_MEDIA_TYPE, serializeJsonLd } from '../../shared/security/json-ld.js';
import { UnsafeUrlError } from '../../shared/security/url-safety.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import { AuditRun, ReportSnapshot, readInventoryPages } from '../audits/index.js';
import { ContentInventoryPage } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { computeConformance, type ConformanceReport } from './conformance.js';
import { buildSchemaDocument, type EvidenceRow, type OmissionRow } from './document.js';
import { EVIDENCE_LIMITS, SchemaEvidenceError, assembleEvidence, type EvidenceFact, type EvidenceSource, type SafeFetch, } from './evidence.js';
import { SchemaGeneration, type SchemaGenerationFailureReason } from './schema-generation.model.js';
import { SCHEMA_REGISTRY_VERSION, SCHEMA_TYPE_REGISTRY, SUPPORTED_SCHEMA_TYPES, USER_FACT_FAMILY, factFamily, userSuppliableProperties, type OmissionReason, type SchemaRichResultsNote, type SupportedSchemaType, type UserFactProperty, } from './schema-types.registry.js';
import { checkTraceability, requestableFactFamilies, requestableProperties, type RawAssignment, } from './traceability.js';
const NOT_FOUND_KEY = 'schemaGenerator.errors.notFound';
const UNAVAILABLE_KEY = 'schemaGenerator.errors.productUnavailable';
const UNSAFE_URL_KEY = 'schemaGenerator.errors.unsafeUrl';
const NOT_HTML_KEY = 'schemaGenerator.errors.notHtml';
const GENERATION_FAILED_KEY = 'schemaGenerator.errors.generationFailed';
const REGENERATE_UNAVAILABLE_KEY = 'schemaGenerator.errors.regenerateUnavailable';
const USER_FACT_NOT_APPLICABLE_KEY = 'schemaGenerator.errors.userFactNotApplicable';
/** Longest source list a picker ever needs; also the read bound (SEC-BOUND). */
export const MAX_SOURCE_PAGES = 200;
export { JSON_LD_MEDIA_TYPE };
// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------
export interface SchemaPropertyProjectionDto {
    name: string;
    class: 'required' | 'recommended';
    fill: 'deterministic' | 'ai-selected';
    /** Empty for a property with no evidence source anywhere in the product. */
    evidenceFactIds: string[];
    neverFilled: boolean;
}
export interface SchemaTypeProjectionDto {
    type: SupportedSchemaType;
    required: SchemaPropertyProjectionDto[];
    recommended: SchemaPropertyProjectionDto[];
    /** `null` when Google still shows this type's rich result. */
    richResults: SchemaRichResultsNote | null;
}
export interface SchemaTypesDto {
    registryVersion: string;
    types: SchemaTypeProjectionDto[];
}
export interface AuditedSourcePageDto {
    url: string;
    title: string | null;
    /** Detector context — what the crawl already saw on this page. */
    hasStructuredData: boolean;
    structuredDataErrors: number;
    /** Search Console rich-results verdict for this URL, when one was sampled. */
    richResultsVerdict: string | null;
}
export interface InventorySourcePageDto {
    url: string;
    schemaTypes: string[];
    hasSchemaOrgArticle: boolean;
}
export interface SchemaSourcesDto {
    siteId: string;
    runId: string | null;
    auditedPages: AuditedSourcePageDto[];
    /**
     * Pages the latest audit stored. Larger than `auditedPages.length` when the
     * picker list was capped at {@link MAX_SOURCE_PAGES}, so the UI can say the
     * list is partial instead of "showing 200 of 200".
     */
    auditedPagesTotal: number;
    /** Inventory rows missing at least one type from the supported registry. */
    inventoryPages: InventorySourcePageDto[];
}
export interface GenerationSummaryDto {
    id: string;
    siteId: string;
    pageUrl: string;
    source: EvidenceSource;
    schemaType: SupportedSchemaType;
    registryVersion: string;
    status: 'complete' | 'failed';
    conformanceStatus: 'conforms' | 'gaps' | null;
    failureReason: SchemaGenerationFailureReason | null;
    generatedAt: string;
    /** The generation this one was rebuilt from, free of charge. */
    regeneratedFrom: string | null;
}
export interface GenerationDetailDto extends GenerationSummaryDto {
    /** Serialized JSON-LD. Render as TEXT — never as markup (SEC-OUT). */
    payload: string | null;
    mediaType: string;
    evidence: EvidenceRow[];
    omissions: OmissionRow[];
    conformance: ConformanceReport | null;
}
export interface SchemaGeneratorDeps {
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    /** Test-only injection for the pasted-URL path. */
    fetchUrl?: SafeFetch;
}
// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
/**
 * Kill switch. Only the NEW-GENERATION entry points (preview + create) close;
 * stored generations stay readable so a user never loses access to markup they
 * already paid for. Read from `env` at request time so an operator flip takes
 * effect without a restart.
 */
function requireEnabled(): void {
    if (!env.SCHEMA_GENERATOR_ENABLED)
        throw new HttpError(403, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
}
/** Owner-scoped site load. A stranger's site id is a 404, never a 403. */
async function requireOwnedSite(accountId: string, siteId: string): Promise<void> {
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
}
/** Map a domain evidence failure onto its HTTP status. */
function toHttpError(error: unknown): HttpError {
    if (error instanceof UnsafeUrlError)
        return HttpError.badRequest({ code: 'UNSAFE_URL', messageKey: UNSAFE_URL_KEY });
    if (error instanceof SchemaEvidenceError) {
        if (error.code === 'not_html')
            return HttpError.badRequest({ code: 'NOT_HTML', messageKey: NOT_HTML_KEY });
        return HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    }
    return HttpError.badRequest({ code: 'UNSAFE_URL', messageKey: UNSAFE_URL_KEY });
}
// ---------------------------------------------------------------------------
// Registry projection
// ---------------------------------------------------------------------------
function projectProperty(property: {
    name: string;
    class: 'required' | 'recommended';
    fill: 'deterministic' | 'ai-selected';
    evidenceFactIds: readonly string[];
    neverFilled?: true;
}): SchemaPropertyProjectionDto {
    return {
        name: property.name,
        class: property.class,
        fill: property.fill,
        evidenceFactIds: [...property.evidenceFactIds],
        neverFilled: property.neverFilled === true,
    };
}
/** `GET /types` — the frozen registry, projected for the type picker. */
export function schemaTypesProjection(): SchemaTypesDto {
    return {
        registryVersion: SCHEMA_REGISTRY_VERSION,
        types: SUPPORTED_SCHEMA_TYPES.map((type) => {
            const { properties, richResults } = SCHEMA_TYPE_REGISTRY[type];
            return {
                type,
                required: properties.filter((p) => p.class === 'required').map(projectProperty),
                recommended: properties.filter((p) => p.class === 'recommended').map(projectProperty),
                richResults: richResults ?? null,
            };
        }),
    };
}
// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
interface RichResultsSample {
    url: string;
    inspection: {
        richResults: {
            verdict: string;
        };
    };
}
/** `GET /sources` — the page picker's two stored work lists. Free, no spend. */
export async function listSources(input: {
    accountId: string;
    siteId: string;
}): Promise<SchemaSourcesDto> {
    await requireOwnedSite(input.accountId, input.siteId);
    const run = await AuditRun.findOne({
        siteId: input.siteId,
        accountId: input.accountId,
        status: 'succeeded',
    })
        .sort({ createdAt: -1 })
        .select({ _id: 1 })
        .lean();
    let auditedPages: AuditedSourcePageDto[] = [];
    let auditedPagesTotal = 0;
    let runId: string | null = null;
    if (run) {
        runId = String(run._id);
        // The same page inventory as Pages: redirect sources, errors, files and
        // duplicate addresses are crawled URLs, not pages.
        const [inventory, snapshot] = await Promise.all([
            readInventoryPages<{
                url: string;
                title?: string | null;
                hasStructuredData: boolean;
                structuredDataErrors: string[];
            }>(runId, { title: 1, hasStructuredData: 1, structuredDataErrors: 1 }, MAX_SOURCE_PAGES),
            ReportSnapshot.findOne({ runId }).select({ indexStatus: 1 }).lean(),
        ]);
        const pages = inventory.pages;
        auditedPagesTotal = inventory.total;
        const verdicts = new Map<string, string>();
        const samples = (snapshot?.indexStatus?.samples ?? []) as unknown as RichResultsSample[];
        for (const sample of samples)
            verdicts.set(sample.url, sample.inspection.richResults.verdict);
        auditedPages = pages.map((page) => ({
            url: page.url,
            title: page.title ?? null,
            hasStructuredData: page.hasStructuredData,
            structuredDataErrors: page.structuredDataErrors.length,
            richResultsVerdict: verdicts.get(page.url) ?? null,
        }));
    }
    const inventoryRows = await ContentInventoryPage.find({
        accountId: input.accountId,
        siteId: input.siteId,
    })
        .sort({ createdAt: -1 })
        .limit(MAX_SOURCE_PAGES)
        .select({ url: 1, facts: 1 })
        .lean();
    const seen = new Set<string>();
    const inventoryPages: InventorySourcePageDto[] = [];
    for (const row of inventoryRows) {
        if (seen.has(row.url))
            continue;
        seen.add(row.url);
        const facts = row.facts as {
            schemaTypes?: unknown;
            hasSchemaOrgArticle?: unknown;
        } | null;
        const declaredTypes = new Set(Array.isArray(facts?.schemaTypes)
            ? facts.schemaTypes
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            : []);
        if (facts?.hasSchemaOrgArticle === true)
            declaredTypes.add('Article');
        // A row is useful while at least one generator type is absent. This keeps
        // partially marked-up pages in the picker and makes `alreadyDeclared`
        // truthful; only a page that has the whole supported registry is complete.
        if (SUPPORTED_SCHEMA_TYPES.every((type) => declaredTypes.has(type)))
            continue;
        const schemaTypes = [...declaredTypes]
            .slice(0, EVIDENCE_LIMITS.contextItemCount)
            .map((entry) => entry.slice(0, EVIDENCE_LIMITS.contextItemChars));
        inventoryPages.push({
            url: row.url,
            schemaTypes,
            hasSchemaOrgArticle: facts?.hasSchemaOrgArticle === true,
        });
    }
    return { siteId: input.siteId, runId, auditedPages, auditedPagesTotal, inventoryPages };
}
// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
export interface PreviewGenerationInput {
    accountId: string;
    siteId: string;
}
/** Read-only spend disclosure — never fetches, never spends. */
export async function previewGeneration(input: PreviewGenerationInput): Promise<SpendPreview> {
    await requireOwnedSite(input.accountId, input.siteId);
    requireEnabled();
    return { deploymentMode: 'community', capacityEnforced: false };
}
// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
export interface CreateGenerationInput {
    accountId: string;
    siteId: string;
    source: EvidenceSource;
    pageUrl: string;
    schemaType: SupportedSchemaType;
    runId?: string;
    outputLocale?: SupportedLocale;
}
interface AiFillOutput {
    assignments: RawAssignment[];
}
interface AiInputPlan {
    input: {
        schemaType: SupportedSchemaType;
        properties: {
            name: string;
            class: string;
            evidenceFactIds: string[];
        }[];
        facts: {
            id: string;
            family: string;
            sourceIndex: number | null;
            label: string;
            value: string;
        }[];
    };
    /** Opaque citation id → the real evidence fact id. */
    factIdBySlug: Map<string, string>;
}
/**
 * Build the AI input.
 *
 * SEC-REDACT: raw crawl HTML never reaches this object — only assembled facts
 * do. Requestable evidence and the three bounded context facts are shown to
 * the model; deterministic-only facts (page URL, canonical, publication time)
 * remain assembler-owned and are not shown. Context facts help the model
 * decline a fill, but never appear in a property's citation menu.
 *
 * Facts are addressed by an opaque `f<n>` slug rather than by their evidence
 * id: `sourceCollections: ['facts']` enrols them in the shared runtime's
 * citation check, whose id charset admits no dots or brackets. The slug is
 * mapped back to the real fact id before the traceability post-check runs, so
 * the registry's declared-evidence rule still compares real families.
 */
function buildAiInput(type: SupportedSchemaType, facts: readonly EvidenceFact[]): AiInputPlan {
    const families = requestableFactFamilies(type);
    const requestableFacts = facts.filter((fact) => !fact.contextOnly && families.has(factFamily(fact.id)));
    const modelFacts = facts.filter((fact) => fact.contextOnly || families.has(factFamily(fact.id)));
    const factIdBySlug = new Map<string, string>();
    const slugByFactId = new Map<string, string>();
    const factRows = modelFacts.map((fact, index) => {
        const slug = `f${index}`;
        factIdBySlug.set(slug, fact.id);
        slugByFactId.set(fact.id, slug);
        const indexed = /\[(\d+)\]$/.exec(fact.id);
        return {
            id: slug,
            family: factFamily(fact.id),
            sourceIndex: indexed ? Number.parseInt(indexed[1]!, 10) : null,
            label: fact.label,
            value: fact.value,
        };
    });
    return {
        input: {
            schemaType: type,
            properties: requestableProperties(type).map((property) => ({
                name: property.name,
                class: property.class,
                // The exact menu of supplied facts this property may be filled from.
                evidenceFactIds: requestableFacts
                    .filter((fact) => property.evidenceFactIds.includes(factFamily(fact.id)))
                    .map((fact) => slugByFactId.get(fact.id)!),
            })),
            facts: factRows,
        },
        factIdBySlug,
    };
}
/** Shape shared by the lean and hydrated stored documents. */
interface StoredSummaryShape {
    _id: unknown;
    siteId: unknown;
    pageUrl: string;
    source: string;
    schemaType: string;
    registryVersion: string;
    status: string;
    conformance: {
        status: string;
    } | null;
    failureReason: string | null;
    createdAt: Date;
    /** Absent on documents stored before rebuilds existed. */
    regeneratedFrom?: unknown;
}
function toSummary(doc: StoredSummaryShape): GenerationSummaryDto {
    return {
        id: String(doc._id),
        siteId: String(doc.siteId),
        pageUrl: doc.pageUrl,
        source: doc.source as EvidenceSource,
        schemaType: doc.schemaType as SupportedSchemaType,
        registryVersion: doc.registryVersion,
        status: doc.status as 'complete' | 'failed',
        conformanceStatus: (doc.conformance?.status as 'conforms' | 'gaps' | undefined) ?? null,
        failureReason: doc.failureReason as SchemaGenerationFailureReason | null,
        generatedAt: doc.createdAt.toISOString(),
        regeneratedFrom: doc.regeneratedFrom ? String(doc.regeneratedFrom) : null,
    };
}
interface StoredDetailShape extends StoredSummaryShape {
    payload: string | null;
    evidence: EvidenceRow[];
    omissions: OmissionRow[];
    conformance: ConformanceReport | null;
}
function toDetail(doc: StoredDetailShape): GenerationDetailDto {
    return {
        ...toSummary(doc),
        payload: doc.payload,
        mediaType: JSON_LD_MEDIA_TYPE,
        evidence: doc.evidence.map((row) => ({
            property: row.property,
            factId: row.factId,
            factLabel: row.factLabel,
            value: row.value,
        })),
        omissions: doc.omissions.map((row) => ({
            property: row.property,
            reasonCode: row.reasonCode,
            class: row.class,
        })),
        conformance: doc.conformance,
    };
}
/** `POST /generations` — state machine. */
export async function createGeneration(input: CreateGenerationInput, deps: SchemaGeneratorDeps): Promise<GenerationDetailDto> {
    await requireOwnedSite(input.accountId, input.siteId);
    const paused = await Site.exists({ _id: input.siteId, accountId: input.accountId, paused: true });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
    requireEnabled();
    let assembled;
    try {
        assembled = await assembleEvidence({
            source: input.source,
            accountId: input.accountId,
            siteId: input.siteId,
            pageUrl: input.pageUrl,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(deps.fetchUrl ? { fetchUrl: deps.fetchUrl } : {}),
        });
    }
    catch (error) {
        // Evidence validation/fetching is a non-spending preflight.
        throw toHttpError(error);
    }
    let aiOutput: AiFillOutput | null = null;
    let provenance: {
        profileVersion: string;
        outputSchemaVersion: string;
        provider: string;
        model: string;
        costMicros: string;
    } | null = null;
    const plan = buildAiInput(input.schemaType, assembled.facts);
    const generationId = new Types.ObjectId();
    const operationKey = `schema-generation:${String(generationId)}`;
    const aiRequest = {
        profile: 'schema_generator' as const,
        input: plan.input,
        locale: input.outputLocale ?? 'en',
        correlationId: operationKey,
        usage: { accountId: input.accountId, siteId: input.siteId },
        configuredProviderOrder: deps.aiProviderOrder,
    };
    // Validate the profile, bounded fact shape and provider policy before the
    // AI call. A defect in our assembled input is not a provider failure and
    // therefore must never masquerade as one.
    deps.ai.preflight(aiRequest);
    try {
        const generated = await deps.ai.run<{
            assignments: RawAssignment[];
        }>({
            ...aiRequest,
        });
        // Only `assignments` is read. The model's own `omissions` and `citations`
        // are deliberately discarded: the omission set and its reasons are derived
        // from what the assembler could actually fill, so a model that claims a
        // property is "not applicable" cannot talk the report into a better verdict.
        aiOutput = {
            assignments: generated.object.assignments.map((assignment) => ({
                property: assignment.property,
                // An unmapped slug stays verbatim so the post-check rejects it as an
                // unknown citation rather than silently dropping it.
                factId: plan.factIdBySlug.get(assignment.factId) ?? assignment.factId,
                value: assignment.value,
            })),
        };
        provenance = {
            profileVersion: generated.provenance.profileVersion,
            outputSchemaVersion: generated.provenance.outputSchemaVersion,
            provider: generated.provenance.provider,
            model: generated.provenance.model,
            costMicros: String(generated.provenance.actualOrEstimatedCostMicros),
        };
    }
    catch {
        // Provider failure with ZERO retained output.
        await SchemaGeneration.create({
            _id: generationId,
            accountId: new Types.ObjectId(input.accountId),
            siteId: new Types.ObjectId(input.siteId),
            pageUrl: assembled.pageUrl,
            source: input.source,
            schemaType: input.schemaType,
            registryVersion: SCHEMA_REGISTRY_VERSION,
            status: 'failed',
            payload: null,
            failureReason: 'ai_provider_failed' satisfies SchemaGenerationFailureReason,
        });
        throw new HttpError(502, { code: 'GENERATION_FAILED', messageKey: GENERATION_FAILED_KEY });
    }
    const traced = checkTraceability(input.schemaType, aiOutput.assignments, assembled.facts);
    const built = buildSchemaDocument(input.schemaType, traced.accepted, assembled.facts, traced.omissionOverrides);
    const payload = serializeJsonLd(built.document);
    const omissionReasons = new Map(built.omissions.map((row) => [row.property, row.reasonCode]));
    const conformance = computeConformance(input.schemaType, built.emittedProperties, omissionReasons);
    // The model answered but nothing it said survived the post-check. The
    // deterministic-only markup IS retained.
    const rejectedEverything = aiOutput.assignments.length > 0 && traced.accepted.length === 0;
    const created = await SchemaGeneration.create({
        _id: generationId,
        accountId: new Types.ObjectId(input.accountId),
        siteId: new Types.ObjectId(input.siteId),
        pageUrl: assembled.pageUrl,
        source: input.source,
        schemaType: input.schemaType,
        registryVersion: SCHEMA_REGISTRY_VERSION,
        status: rejectedEverything ? 'failed' : 'complete',
        payload,
        evidence: built.evidence,
        omissions: built.omissions,
        conformance,
        failureReason: rejectedEverything ? 'ai_output_rejected' : null,
        provenance,
    });
    return toDetail(created.toObject() as unknown as StoredDetailShape);
}
// ---------------------------------------------------------------------------
// Regeneration from user-supplied facts
// ---------------------------------------------------------------------------
export interface RegenerateGenerationInput {
    accountId: string;
    generationId: string;
    facts: Partial<Record<UserFactProperty, string>>;
}
/**
 * `POST /generations/:generationId/regenerate` — rebuild a stored generation
 * with facts the user typed for properties it left out.
 *
 * The rebuild re-reads the facts the original generation already stored — every
 * evidence row it emitted, its page URL and its refined omission reasons — and
 * runs only the deterministic assembler and conformance check. There is no AI
 * call, no page fetch and no vendor request. Each supplied value is emitted
 * verbatim with the provenance "provided by you"; nothing is invented. The
 * result is a NEW generation linked through `regeneratedFrom`, so the original
 * stays as it was.
 */
export async function regenerateGeneration(input: RegenerateGenerationInput): Promise<GenerationDetailDto> {
    const stored = await SchemaGeneration.findOne({
        _id: input.generationId,
        accountId: input.accountId,
    }).lean();
    if (!stored)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    const siteId = String(stored.siteId);
    await requireOwnedSite(input.accountId, siteId);
    const paused = await Site.exists({ _id: siteId, accountId: input.accountId, paused: true });
    if (paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
    requireEnabled();
    if (stored.payload === null) {
        throw HttpError.conflict({ code: 'REGENERATE_UNAVAILABLE', messageKey: REGENERATE_UNAVAILABLE_KEY });
    }
    const type = stored.schemaType as SupportedSchemaType;
    const suppliable = new Set<string>(userSuppliableProperties(type));
    const isUserRow = (row: { factId: string }) => row.factId.startsWith(`${USER_FACT_FAMILY}.`);
    const userFacts = new Map<string, string>();
    // Values supplied for an earlier rebuild carry forward; new ones win.
    for (const row of stored.evidence) {
        if (isUserRow(row))
            userFacts.set(row.property, row.value);
    }
    // zod drops absent optional keys, so every entry carries a value.
    for (const [property, value] of Object.entries(input.facts) as [string, string][]) {
        if (!suppliable.has(property)) {
            throw HttpError.badRequest({ code: 'USER_FACT_NOT_APPLICABLE', messageKey: USER_FACT_NOT_APPLICABLE_KEY });
        }
        userFacts.set(property, value);
    }
    // The stored evidence rows ARE the facts the original generation used. Rebuilt
    // as facts, the deterministic fills resolve to the same values; the rows of
    // AI-selected properties are replayed as the already-checked assignments.
    const factsById = new Map<string, EvidenceFact>();
    factsById.set('page.url', { id: 'page.url', kind: 'first_party', label: 'Page URL', value: stored.pageUrl, contextOnly: false });
    const assignments: {
        property: string;
        factId: string;
        value: string;
    }[] = [];
    for (const row of stored.evidence) {
        if (isUserRow(row))
            continue;
        factsById.set(row.factId, { id: row.factId, kind: 'first_party', label: row.factLabel, value: row.value, contextOnly: false });
        assignments.push({ property: row.property, factId: row.factId, value: row.value });
    }
    const overrides = new Map<string, OmissionReason>();
    for (const row of stored.omissions) {
        if (row.reasonCode === 'evidence_ambiguous')
            overrides.set(row.property, row.reasonCode);
    }
    const built = buildSchemaDocument(type, assignments, [...factsById.values()], overrides, userFacts);
    const omissionReasons = new Map(built.omissions.map((row) => [row.property, row.reasonCode]));
    const created = await SchemaGeneration.create({
        accountId: stored.accountId,
        siteId: stored.siteId,
        pageUrl: stored.pageUrl,
        source: stored.source,
        schemaType: type,
        registryVersion: SCHEMA_REGISTRY_VERSION,
        status: 'complete',
        payload: serializeJsonLd(built.document),
        evidence: built.evidence,
        omissions: built.omissions,
        conformance: computeConformance(type, built.emittedProperties, omissionReasons),
        failureReason: null,
        provenance: null,
        regeneratedFrom: stored._id,
    });
    return toDetail(created.toObject() as unknown as StoredDetailShape);
}
// ---------------------------------------------------------------------------
// Stored reads
// ---------------------------------------------------------------------------
export async function listGenerations(input: {
    accountId: string;
    siteId?: string;
    limit: number;
    allowedSiteIds?: readonly string[] | null;
}): Promise<{
    items: GenerationSummaryDto[];
}> {
    const filter: Record<string, unknown> = { accountId: input.accountId };
    if (input.siteId !== undefined) {
        if (input.allowedSiteIds !== undefined &&
            input.allowedSiteIds !== null &&
            !input.allowedSiteIds.includes(input.siteId)) {
            throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
        }
        await requireOwnedSite(input.accountId, input.siteId);
        filter.siteId = input.siteId;
    }
    else {
        const liveSites = await Site.find({ accountId: input.accountId, deletionStartedAt: null }, { _id: 1 }).lean();
        const allowed = input.allowedSiteIds === undefined || input.allowedSiteIds === null
            ? null
            : new Set(input.allowedSiteIds);
        filter.siteId = {
            $in: liveSites
                .filter((site) => allowed === null || allowed.has(String(site._id)))
                .map((site) => site._id),
        };
    }
    const docs = await SchemaGeneration.find(filter)
        .sort({ createdAt: -1 })
        .limit(input.limit)
        .lean();
    return { items: (docs as unknown as StoredDetailShape[]).map(toSummary) };
}
export async function getGeneration(input: {
    accountId: string;
    generationId: string;
}): Promise<GenerationDetailDto> {
    const doc = await SchemaGeneration.findOne({
        _id: input.generationId,
        accountId: input.accountId,
    }).lean();
    if (!doc)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return toDetail(doc as unknown as StoredDetailShape);
}
export async function resolveOwnedSchemaGenerationSiteId(accountId: string, generationId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(generationId))
        return null;
    const generation = await SchemaGeneration.findOne({ _id: generationId, accountId }, { siteId: 1 }).lean();
    return generation ? String(generation.siteId) : null;
}
