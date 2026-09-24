/**
 * Supported schema.org type registry — frozen version `1`.
 *
 *
 * This module is DATA, not code paths. Every consumer (the conformance layer,
 * the document assembler, the AI traceability post-check, the `/types` route)
 * reads the same frozen constant; none of them carries a per-type branch.
 *
 * Evidence fact ids are declared as FAMILIES (`page.h1`) and matched against
 * the indexed ids the evidence assembler emits (`page.h1[0]`) through
 * `factFamily()`, which declares the indexed template; the bracket notation
 * is presentational.
 */
/** Registry revision persisted on every generation so an old verdict is never restated. */
export const SCHEMA_REGISTRY_VERSION = '1';
/** Maximum top-level schema.org properties in any supported registry type. */
export const MAX_SCHEMA_PROPERTIES = 20;
/**
 * The seven v1 types. `Product` / `Review` / `Recipe` / `Event` / `JobPosting`
 * are deliberately absent: their required properties have no stored evidence
 * source, so shipping them would force fabrication.
 */
export const SUPPORTED_SCHEMA_TYPES = [
    'WebPage',
    'WebSite',
    'Organization',
    'Article',
    'BreadcrumbList',
    'FAQPage',
    'HowTo',
] as const;
export type SupportedSchemaType = (typeof SUPPORTED_SCHEMA_TYPES)[number];
/** Localized omission reasons rendered next to every property the payload omits. */
export const OMISSION_REASONS = ['no_evidence', 'evidence_ambiguous', 'not_applicable'] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];
export type SchemaPropertyClass = 'required' | 'recommended';
/** `deterministic` = assembled by code; `ai-selected` = AI picks the fact, code re-checks it. */
export type SchemaPropertyFill = 'deterministic' | 'ai-selected';
export interface SchemaPropertyDefinition {
    readonly name: string;
    readonly class: SchemaPropertyClass;
    readonly fill: SchemaPropertyFill;
    /** Evidence fact families that may fill this property. Empty iff `neverFilled`. */
    readonly evidenceFactIds: readonly string[];
    /** Marks a property with no stored evidence source anywhere in the product. */
    readonly neverFilled?: true;
}
export interface SchemaTypeDefinition {
    readonly type: SupportedSchemaType;
    /** Declaration order IS the emitted property order. */
    readonly properties: readonly SchemaPropertyDefinition[];
}
/**
 * Property names whose required evidence does not exist in this product. A
 * registry that ever declares one of these is rejected by an invariant test —
 * they are the canonical fabrication classes the AI post-check must drop.
 */
export const MUST_REJECT_PROPERTY_NAMES = [
    'aggregateRating',
    'ratingValue',
    'reviewCount',
    'review',
    'offers',
    'price',
    'priceCurrency',
    'availability',
    'recipeIngredient',
    'startDate',
    'baseSalary',
] as const;
const WEB_PAGE: SchemaTypeDefinition = {
    type: 'WebPage',
    properties: [
        { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.title', 'page.h1'] },
        { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['page.canonical', 'page.url'] },
        {
            name: 'description',
            class: 'recommended',
            fill: 'ai-selected',
            evidenceFactIds: ['page.metaDescription'],
        },
        { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
        { name: 'isPartOf', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
        {
            name: 'primaryImageOfPage',
            class: 'recommended',
            fill: 'deterministic',
            evidenceFactIds: [],
            neverFilled: true,
        },
    ],
};
const WEB_SITE: SchemaTypeDefinition = {
    type: 'WebSite',
    properties: [
        { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['site.label', 'site.domain'] },
        { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
        {
            name: 'description',
            class: 'recommended',
            fill: 'ai-selected',
            evidenceFactIds: ['page.metaDescription'],
        },
        { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
    ],
};
const ORGANIZATION: SchemaTypeDefinition = {
    type: 'Organization',
    properties: [
        { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['site.label', 'site.domain'] },
        { name: 'url', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.origin'] },
        {
            name: 'description',
            class: 'recommended',
            fill: 'ai-selected',
            evidenceFactIds: ['page.metaDescription'],
        },
        { name: 'logo', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
        { name: 'sameAs', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    ],
};
const ARTICLE: SchemaTypeDefinition = {
    type: 'Article',
    properties: [
        { name: 'headline', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h1', 'page.title'] },
        // Never AI-filled: a person author is never invented. Assembled as an
        // Organization from the site record, or omitted.
        { name: 'author', class: 'required', fill: 'deterministic', evidenceFactIds: ['site.label', 'site.domain'] },
        // `page.crawledAt` is NOT a publication date. Only the fetched
        // `article:published_time` meta qualifies, so the audited-page path
        // honestly reports a required gap here.
        {
            name: 'datePublished',
            class: 'required',
            fill: 'deterministic',
            evidenceFactIds: ['page.articlePublishedTime'],
        },
        {
            name: 'description',
            class: 'recommended',
            fill: 'ai-selected',
            evidenceFactIds: ['page.metaDescription'],
        },
        {
            name: 'dateModified',
            class: 'recommended',
            fill: 'deterministic',
            evidenceFactIds: ['page.articleModifiedTime'],
        },
        {
            name: 'mainEntityOfPage',
            class: 'recommended',
            fill: 'deterministic',
            evidenceFactIds: ['page.canonical', 'page.url'],
        },
        { name: 'inLanguage', class: 'recommended', fill: 'deterministic', evidenceFactIds: ['page.language'] },
        { name: 'image', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    ],
};
const BREADCRUMB_LIST: SchemaTypeDefinition = {
    type: 'BreadcrumbList',
    properties: [
        {
            name: 'itemListElement',
            class: 'required',
            fill: 'deterministic',
            evidenceFactIds: ['page.url', 'site.origin', 'site.label', 'site.domain'],
        },
    ],
};
const FAQ_PAGE: SchemaTypeDefinition = {
    type: 'FAQPage',
    properties: [
        {
            name: 'mainEntity',
            class: 'required',
            fill: 'ai-selected',
            evidenceFactIds: ['page.h2', 'page.faqAnswers'],
        },
    ],
};
const HOW_TO: SchemaTypeDefinition = {
    type: 'HowTo',
    properties: [
        { name: 'name', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h1', 'page.title'] },
        { name: 'step', class: 'required', fill: 'ai-selected', evidenceFactIds: ['page.h2'] },
        {
            name: 'description',
            class: 'recommended',
            fill: 'ai-selected',
            evidenceFactIds: ['page.metaDescription'],
        },
        { name: 'totalTime', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
        {
            name: 'estimatedCost',
            class: 'recommended',
            fill: 'deterministic',
            evidenceFactIds: [],
            neverFilled: true,
        },
        { name: 'supply', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
        { name: 'tool', class: 'recommended', fill: 'deterministic', evidenceFactIds: [], neverFilled: true },
    ],
};
export const SCHEMA_TYPE_REGISTRY: Readonly<Record<SupportedSchemaType, SchemaTypeDefinition>> = Object.freeze({
    WebPage: WEB_PAGE,
    WebSite: WEB_SITE,
    Organization: ORGANIZATION,
    Article: ARTICLE,
    BreadcrumbList: BREADCRUMB_LIST,
    FAQPage: FAQ_PAGE,
    HowTo: HOW_TO,
});
/** Strip an evidence fact's array index so `page.h2[3]` matches the declared `page.h2` family. */
export function factFamily(factId: string): string {
    return factId.replace(/\[\d+\]$/, '');
}
export function schemaTypeDefinition(type: SupportedSchemaType): SchemaTypeDefinition {
    return SCHEMA_TYPE_REGISTRY[type];
}
export function requiredProperties(type: SupportedSchemaType): readonly SchemaPropertyDefinition[] {
    return SCHEMA_TYPE_REGISTRY[type].properties.filter((property) => property.class === 'required');
}
export function recommendedProperties(type: SupportedSchemaType): readonly SchemaPropertyDefinition[] {
    return SCHEMA_TYPE_REGISTRY[type].properties.filter((property) => property.class === 'recommended');
}
export function isSupportedSchemaType(value: string): value is SupportedSchemaType {
    return (SUPPORTED_SCHEMA_TYPES as readonly string[]).includes(value);
}
