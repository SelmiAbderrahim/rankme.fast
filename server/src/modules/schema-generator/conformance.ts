/**
 * Deterministic, versioned conformance verdict.
 *
 *
 * The verdict is a statement about schema.org REQUIREMENTS only. It is never a
 * rich-result guarantee — the localized copy and the honesty grep hold
 * that line on the client side.
 */
import { SCHEMA_REGISTRY_VERSION, SCHEMA_TYPE_REGISTRY, type OmissionReason, type SupportedSchemaType, } from './schema-types.registry.js';
export interface ConformanceGap {
    readonly property: string;
    readonly reasonCode: OmissionReason;
}
export interface ConformanceReport {
    readonly registryVersion: string;
    readonly status: 'conforms' | 'gaps';
    readonly requiredGaps: readonly ConformanceGap[];
    readonly recommendedSuggestions: readonly ConformanceGap[];
}
/**
 * @param type              the generated schema.org type
 * @param emittedProperties property names actually present in the payload
 * @param omissionReasons   refined reasons from the assembler / AI post-check;
 *                          anything unmapped falls back to `no_evidence`
 */
export function computeConformance(type: SupportedSchemaType, emittedProperties: readonly string[], omissionReasons: ReadonlyMap<string, OmissionReason> = new Map()): ConformanceReport {
    const emitted = new Set(emittedProperties);
    const requiredGaps: ConformanceGap[] = [];
    const recommendedSuggestions: ConformanceGap[] = [];
    for (const property of SCHEMA_TYPE_REGISTRY[type].properties) {
        if (emitted.has(property.name))
            continue;
        const gap: ConformanceGap = {
            property: property.name,
            reasonCode: omissionReasons.get(property.name) ?? 'no_evidence',
        };
        if (property.class === 'required')
            requiredGaps.push(gap);
        else
            recommendedSuggestions.push(gap);
    }
    return {
        registryVersion: SCHEMA_REGISTRY_VERSION,
        status: requiredGaps.length === 0 ? 'conforms' : 'gaps',
        requiredGaps,
        recommendedSuggestions,
    };
}
