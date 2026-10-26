/**
 * Supported schema.org type registry — frozen version `2`.
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
/**
 * Registry revision persisted on every generation so an old verdict is never
 * restated. `2`: `WebSite.name` / `Organization.name` are deterministic, filled
 * from {@link BRAND_NAME_FACT_FAMILIES} in order.
 */
export const SCHEMA_REGISTRY_VERSION = '2';
/**
 * Name precedence for a site or organization: the page's `og:site_name`, then a
 * name already declared by an `Organization` / `WebSite` node in the page's
 * JSON-LD, then the brand part of the `<title>`, then the name the user gave
 * the site, then the bare domain. The first fact present wins and its id is the
 * provenance shown to the user.
 */
export const BRAND_NAME_FACT_FAMILIES = [
    'page.ogSiteName',
    'page.jsonLdName',
    'page.titleBrand',
    'site.label',
    'site.domain',
] as const;
/** Maximum top-level schema.org properties in any supported registry type. */
export const MAX_SCHEMA_PROPERTIES = 20;
/**
 * The seven v1 types. `Product` / `Review` / `Recipe` / `Event` / `JobPosting`
 * are deliberately absent: their required properties have no stored evidence
 * source, so shipping them would force fabrication.
 *
 * This is also the picker order. Types that carry a `richResults` note (FAQPage,
 * HowTo) come after every type without one; an invariant test pins it.
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
/**
 * What Google Search does with a type's rich result today. `limited` = shown
 * only for some sites; `retired` = no longer shown. Valid markup is still
 * emitted either way. Presentational only: it never changes a property set or a
 * conformance verdict, so the registry version is unchanged.
 */
export type SchemaRichResultsNote = 'limited' | 'retired';
export interface SchemaTypeDefinition {
    readonly type: SupportedSchemaType;
    /** Declaration order IS the emitted property order. */
    readonly properties: readonly SchemaPropertyDefinition[];
    readonly richResults?: SchemaRichResultsNote;
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
        { name: 'name', class: 'required', fill: 'deterministic', evidenceFactIds: BRAND_NAME_FACT_FAMILIES },
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
        { name: 'name', class: 'required', fill: 'deterministic', evidenceFactIds: BRAND_NAME_FACT_FAMILIES },
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
    // Google shows FAQ rich results only for well-known, authoritative
    // government and health sites (Search Central, August 2023).
    richResults: 'limited',
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
    // Google no longer shows HowTo rich results (Search Central, announced August 2023).
    richResults: 'retired',
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
/**
 * Facts the user may supply for an omitted property. The value is the user's
 * own statement, emitted verbatim with the provenance "provided by you"; the
 * generator never invents it. `text` is bounded prose, `language` a BCP 47 tag,
 * `date` an ISO 8601 date or date-time, `url` a public https address. Every
 * other property stays evidence-only.
 */
export const USER_FACT_KINDS = {
    name: 'text',
    headline: 'text',
    description: 'longText',
    inLanguage: 'language',
    datePublished: 'date',
    dateModified: 'date',
    logo: 'url',
    image: 'url',
    primaryImageOfPage: 'url',
} as const;
export type UserFactProperty = keyof typeof USER_FACT_KINDS;
export const USER_FACT_PROPERTIES = Object.keys(USER_FACT_KINDS) as UserFactProperty[];
/** Fact family of a user-supplied value; the property name follows the dot. */
export const USER_FACT_FAMILY = 'user';
/** The user-suppliable properties of one type, in registry order. */
export function userSuppliableProperties(type: SupportedSchemaType): UserFactProperty[] {
    return SCHEMA_TYPE_REGISTRY[type].properties
        .map((property) => property.name)
        .filter((name): name is UserFactProperty => name in USER_FACT_KINDS);
}
