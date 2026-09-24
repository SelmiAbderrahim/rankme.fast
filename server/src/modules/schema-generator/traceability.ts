/**
 * Deterministic AI-output traceability post-check.
 *
 *
 * The system instruction ASKS the model to copy a supplied fact verbatim; this
 * module PROVES it did. Nothing the model returns reaches the payload directly
 * — an assignment survives only when all five rules below hold, and even then
 * the assembler re-reads the value from the stored fact rather than from the
 * model's echo.
 *
 * Rejected assignments are never silently discarded: an `ai-selected` property
 * whose every assignment was rejected renders `evidence_ambiguous` next to its
 * omission. Deterministic properties are a different case — the model was never
 * asked for them, so naming one is dropped WITHOUT changing the property's
 * omission reason (it stays the honest `no_evidence`, which is what makes
 * `Article.datePublished` report a required gap on the audited-page path).
 */
import type { AcceptedAssignment } from './document.js';
import { normalizeFactValue } from './document.js';
import { CONTEXT_ONLY_FACT_IDS, type EvidenceFact } from './evidence.js';
import { SCHEMA_TYPE_REGISTRY, factFamily, type OmissionReason, type SchemaPropertyDefinition, type SupportedSchemaType, } from './schema-types.registry.js';
/**
 * Properties the assembler owns outright. Any AI assignment naming
 * one of them is dropped before it can influence the payload.
 */
export const DETERMINISTIC_PROPERTY_NAMES = [
    'url',
    'inLanguage',
    'isPartOf',
    'mainEntityOfPage',
    'itemListElement',
    'position',
    'author',
    'datePublished',
    'dateModified',
] as const;
export type TraceabilityRejectionRule = 
/** Rule 1 — the property was not in the requested list for this type. */
'not_requested'
/** Rule 2 — the cited factId is not in the supplied facts array. */
 | 'unknown_fact'
/** Rule 3 — the cited fact is context-only and may never fill a property. */
 | 'context_fact'
/** Rule 4 — the value is not an exact copy of the cited fact. */
 | 'value_mismatch'
/** Rule 5 — the cited fact is not declared evidence for that property. */
 | 'undeclared_evidence';
export interface RawAssignment {
    readonly property: string;
    readonly factId: string;
    readonly value: string;
}
export interface RejectedAssignment {
    readonly property: string;
    readonly factId: string;
    readonly rule: TraceabilityRejectionRule;
}
export interface TraceabilityResult {
    readonly accepted: readonly AcceptedAssignment[];
    readonly rejected: readonly RejectedAssignment[];
    /** `property → evidence_ambiguous` for requested properties left with nothing. */
    readonly omissionOverrides: ReadonlyMap<string, OmissionReason>;
}
/**
 * The properties the AI is asked to fill: `ai-selected`, never `neverFilled`.
 * Everything else is assembler-owned, so sending it would only invite a
 * fabrication the post-check has to throw away.
 */
export function requestableProperties(type: SupportedSchemaType): readonly SchemaPropertyDefinition[] {
    return SCHEMA_TYPE_REGISTRY[type].properties.filter((property) => property.fill === 'ai-selected' && property.neverFilled !== true);
}
/** Evidence fact families any requestable property of this type may cite. */
export function requestableFactFamilies(type: SupportedSchemaType): ReadonlySet<string> {
    const families = new Set<string>();
    for (const property of requestableProperties(type)) {
        for (const family of property.evidenceFactIds)
            families.add(family);
    }
    return families;
}
const CONTEXT_ONLY = new Set<string>(CONTEXT_ONLY_FACT_IDS);
const DETERMINISTIC = new Set<string>(DETERMINISTIC_PROPERTY_NAMES);
/** True when the assembler, not the model, owns this property. */
export function isDeterministicProperty(property: string): boolean {
    return DETERMINISTIC.has(property);
}
function classify(assignment: RawAssignment, requested: ReadonlyMap<string, SchemaPropertyDefinition>, factsById: ReadonlyMap<string, EvidenceFact>): TraceabilityRejectionRule | null {
    const property = requested.get(assignment.property);
    // Rule 1 — covers both a deterministic property and a property that does not
    // exist on this type at all (the `aggregateRating` / `offers` / `review`
    // fabrication classes).
    if (!property)
        return 'not_requested';
    const fact = factsById.get(assignment.factId);
    if (!fact)
        return 'unknown_fact'; // rule 2
    if (fact.contextOnly || CONTEXT_ONLY.has(assignment.factId))
        return 'context_fact'; // rule 3
    if (normalizeFactValue(fact.value) !== normalizeFactValue(assignment.value)) {
        return 'value_mismatch'; // rule 4 — exact copy, never a paraphrase
    }
    if (!property.evidenceFactIds.includes(factFamily(assignment.factId))) {
        return 'undeclared_evidence'; // rule 5
    }
    return null;
}
/**
 * Apply to one model response.
 *
 * @param type        the generated schema.org type
 * @param assignments the model's raw assignments, in model order
 * @param facts       the assembled evidence facts supplied to the model
 */
export function checkTraceability(type: SupportedSchemaType, assignments: readonly RawAssignment[], facts: readonly EvidenceFact[]): TraceabilityResult {
    const requested = new Map<string, SchemaPropertyDefinition>();
    for (const property of requestableProperties(type))
        requested.set(property.name, property);
    const factsById = new Map<string, EvidenceFact>();
    for (const fact of facts)
        factsById.set(fact.id, fact);
    const accepted: AcceptedAssignment[] = [];
    const rejected: RejectedAssignment[] = [];
    const acceptedProperties = new Set<string>();
    const rejectedProperties = new Set<string>();
    for (const assignment of assignments) {
        const rule = classify(assignment, requested, factsById);
        if (rule === null) {
            accepted.push({
                property: assignment.property,
                factId: assignment.factId,
                value: assignment.value,
            });
            acceptedProperties.add(assignment.property);
            continue;
        }
        rejected.push({ property: assignment.property, factId: assignment.factId, rule });
        // Only a REQUESTED property earns an `evidence_ambiguous` reason. A
        // deterministic or foreign property was never the model's to give, so its
        // omission reason must stay whatever the assembler computed.
        if (requested.has(assignment.property))
            rejectedProperties.add(assignment.property);
    }
    const omissionOverrides = new Map<string, OmissionReason>();
    for (const property of rejectedProperties) {
        if (acceptedProperties.has(property))
            continue;
        omissionOverrides.set(property, 'evidence_ambiguous');
    }
    return { accepted, rejected, omissionOverrides };
}
