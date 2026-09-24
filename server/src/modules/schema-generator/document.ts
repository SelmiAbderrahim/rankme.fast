/**
 * JSON-LD document assembler.
 *
 * Covers the deterministic fills and the rule that AI output never reaches
 * the payload directly.
 *
 * Every emitted value is copied from an assembled evidence fact — the AI only
 * chooses WHICH fact fills an `ai-selected` property, and even that choice is
 * re-checked here against the registry's declared evidence families and the
 * exact-copy rule. Property insertion order is the registry declaration order,
 * so two runs over identical facts serialize byte-identically.
 */
import type { EvidenceFact } from './evidence.js';
import { SCHEMA_TYPE_REGISTRY, factFamily, type OmissionReason, type SchemaPropertyClass, type SchemaPropertyDefinition, type SupportedSchemaType, } from './schema-types.registry.js';
export const SCHEMA_CONTEXT = 'https://schema.org';
/** Assembly ceilings, frozen. */
export const BREADCRUMB_MAX_ITEMS = 8;
export const BREADCRUMB_MIN_ITEMS = 2;
export const FAQ_MAX_PAIRS = 10;
export const HOWTO_MIN_STEPS = 2;
export const HOWTO_MAX_STEPS = 12;
export interface AcceptedAssignment {
    readonly property: string;
    readonly factId: string;
    readonly value: string;
}
export interface EvidenceRow {
    readonly property: string;
    readonly factId: string;
    readonly factLabel: string;
    readonly value: string;
}
export interface OmissionRow {
    readonly property: string;
    readonly reasonCode: OmissionReason;
    readonly class: SchemaPropertyClass;
}
export interface BuiltSchemaDocument {
    readonly document: Record<string, unknown>;
    readonly emittedProperties: readonly string[];
    readonly evidence: readonly EvidenceRow[];
    readonly omissions: readonly OmissionRow[];
}
/** Exact-copy comparison basis: NFC + trimmed + internal whitespace runs collapsed. */
export function normalizeFactValue(value: string): string {
    return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}
const QUESTION_SUFFIX = /[?？؟]$/;
function humanizeSegment(segment: string): string {
    return segment
        .replace(/[-_]+/g, ' ')
        .split(' ')
        .filter((word) => word.length > 0)
        .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
        .join(' ');
}
interface AssemblyContext {
    readonly type: SupportedSchemaType;
    readonly factsById: ReadonlyMap<string, EvidenceFact>;
    readonly assignments: readonly AcceptedAssignment[];
    readonly evidence: EvidenceRow[];
}
function record(context: AssemblyContext, property: string, fact: EvidenceFact): void {
    context.evidence.push({
        property,
        factId: fact.id,
        factLabel: fact.label,
        value: fact.value,
    });
}
/** First declared evidence fact that is present, in registry order. */
function firstDeclaredFact(context: AssemblyContext, property: SchemaPropertyDefinition): EvidenceFact | null {
    for (const factId of property.evidenceFactIds) {
        const fact = context.factsById.get(factId);
        if (fact)
            return fact;
    }
    return null;
}
/** Accepted AI assignments for a property, re-checked against the registry and the facts. */
function citedFacts(context: AssemblyContext, property: SchemaPropertyDefinition): EvidenceFact[] {
    const families = new Set(property.evidenceFactIds);
    const cited: EvidenceFact[] = [];
    for (const assignment of context.assignments) {
        if (assignment.property !== property.name)
            continue;
        if (!families.has(factFamily(assignment.factId)))
            continue;
        const fact = context.factsById.get(assignment.factId);
        if (!fact)
            continue;
        if (normalizeFactValue(fact.value) !== normalizeFactValue(assignment.value))
            continue;
        cited.push(fact);
    }
    return cited;
}
function isHomePage(context: AssemblyContext): boolean {
    const pageUrl = context.factsById.get('page.url');
    if (!pageUrl)
        return false;
    try {
        return new URL(pageUrl.value).pathname === '/';
    }
    catch {
        return false;
    }
}
function buildBreadcrumb(context: AssemblyContext): unknown {
    const pageUrlFact = context.factsById.get('page.url');
    if (!pageUrlFact)
        return null;
    let parsed: URL;
    try {
        parsed = new URL(pageUrlFact.value);
    }
    catch {
        return null;
    }
    const originFact = context.factsById.get('site.origin');
    const rootNameFact = context.factsById.get('site.label') ?? context.factsById.get('site.domain');
    const origin = originFact?.value ?? parsed.origin;
    const rootName = rootNameFact?.value ?? parsed.hostname;
    const segments = parsed.pathname
        .split('/')
        .filter((segment) => segment.length > 0)
        .slice(0, BREADCRUMB_MAX_ITEMS - 1);
    const base = origin.replace(/\/+$/, '');
    const items: unknown[] = [{ '@type': 'ListItem', position: 1, name: rootName, item: origin }];
    segments.forEach((segment, index) => {
        items.push({
            '@type': 'ListItem',
            position: index + 2,
            name: humanizeSegment(segment),
            item: `${base}/${segments.slice(0, index + 1).join('/')}`,
        });
    });
    if (items.length < BREADCRUMB_MIN_ITEMS)
        return null;
    record(context, 'itemListElement', pageUrlFact);
    if (originFact)
        record(context, 'itemListElement', originFact);
    if (rootNameFact)
        record(context, 'itemListElement', rootNameFact);
    return items;
}
function buildFaq(context: AssemblyContext, property: SchemaPropertyDefinition): unknown {
    const questions = new Map<number, EvidenceFact>();
    const answers = new Map<number, EvidenceFact>();
    for (const fact of citedFacts(context, property)) {
        const family = factFamily(fact.id);
        const match = /\[(\d+)\]$/.exec(fact.id);
        if (!match)
            continue;
        const index = Number.parseInt(match[1]!, 10);
        if (family === 'page.h2') {
            if (QUESTION_SUFFIX.test(fact.value.trim()))
                questions.set(index, fact);
            continue;
        }
        // `citedFacts` admits only the registry-declared FAQ families. Once the
        // heading branch continues, the remaining fact is necessarily an answer.
        answers.set(index, fact);
    }
    const pairs = [...questions.entries()]
        .filter(([index]) => answers.has(index))
        .sort(([left], [right]) => left - right)
        .slice(0, FAQ_MAX_PAIRS)
        .map(([index, question]) => ({ question, answer: answers.get(index)! }));
    if (pairs.length === 0)
        return null;
    return pairs.map(({ question, answer }) => {
        record(context, property.name, question);
        record(context, property.name, answer);
        return {
            '@type': 'Question',
            name: question.value,
            acceptedAnswer: { '@type': 'Answer', text: answer.value },
        };
    });
}
function buildSteps(context: AssemblyContext, property: SchemaPropertyDefinition): unknown {
    const indexedSteps = new Map<number, EvidenceFact>();
    for (const fact of citedFacts(context, property)) {
        const match = /\[(\d+)\]$/.exec(fact.id);
        if (!match)
            continue;
        const index = Number.parseInt(match[1]!, 10);
        // One stored heading can become at most one step, even when a model emits
        // the same citation more than once.
        if (!indexedSteps.has(index))
            indexedSteps.set(index, fact);
    }
    const steps = [...indexedSteps.entries()]
        .sort(([left], [right]) => left - right)
        .slice(0, HOWTO_MAX_STEPS)
        .map(([, fact]) => fact);
    if (steps.length < HOWTO_MIN_STEPS)
        return null;
    return steps.map((fact, index) => {
        record(context, property.name, fact);
        // `position` is assembler-assigned from array order and is NEVER taken
        // from AI output.
        return { '@type': 'HowToStep', position: index + 1, name: fact.value };
    });
}
function buildProperty(context: AssemblyContext, property: SchemaPropertyDefinition): unknown {
    if (property.neverFilled === true)
        return null;
    if (property.name === 'itemListElement')
        return buildBreadcrumb(context);
    if (property.name === 'mainEntity')
        return buildFaq(context, property);
    if (property.name === 'step')
        return buildSteps(context, property);
    if (property.name === 'isPartOf') {
        const origin = firstDeclaredFact(context, property);
        if (!origin)
            return null;
        record(context, property.name, origin);
        return { '@type': 'WebSite', url: origin.value };
    }
    if (property.name === 'author') {
        const named = firstDeclaredFact(context, property);
        if (!named)
            return null;
        record(context, property.name, named);
        return { '@type': 'Organization', name: named.value };
    }
    if (property.fill === 'deterministic') {
        const fact = firstDeclaredFact(context, property);
        if (!fact)
            return null;
        record(context, property.name, fact);
        return fact.value;
    }
    if (context.type === 'WebSite' && property.name === 'description' && !isHomePage(context))
        return null;
    const [fact] = citedFacts(context, property);
    if (!fact)
        return null;
    record(context, property.name, fact);
    return fact.value;
}
function defaultOmissionReason(context: AssemblyContext, property: SchemaPropertyDefinition): OmissionReason {
    // `WebSite.description` describes the site, so only the home page's meta
    // description can honestly fill it.
    if (context.type === 'WebSite' && property.name === 'description' && !isHomePage(context)) {
        return 'not_applicable';
    }
    return 'no_evidence';
}
/**
 * Assemble the JSON-LD document for one generation.
 *
 * @param deterministicFacts    the full assembled evidence fact array; every
 *                              deterministic fill is resolved from it by id
 * @param omissionReasonOverrides refined reasons from the AI post-check
 *                              (which supplies `evidence_ambiguous`)
 */
export function buildSchemaDocument(type: SupportedSchemaType, acceptedAssignments: readonly AcceptedAssignment[], deterministicFacts: readonly EvidenceFact[], omissionReasonOverrides: ReadonlyMap<string, OmissionReason> = new Map()): BuiltSchemaDocument {
    const factsById = new Map<string, EvidenceFact>();
    for (const fact of deterministicFacts) {
        // Context-only facts describe the page's CURRENT markup and may never fill
        // a property, so they are not addressable during assembly.
        if (!fact.contextOnly)
            factsById.set(fact.id, fact);
    }
    const evidence: EvidenceRow[] = [];
    const context: AssemblyContext = { type, factsById, assignments: acceptedAssignments, evidence };
    const document: Record<string, unknown> = { '@context': SCHEMA_CONTEXT, '@type': type };
    const emittedProperties: string[] = [];
    const omissions: OmissionRow[] = [];
    for (const property of SCHEMA_TYPE_REGISTRY[type].properties) {
        const value = buildProperty(context, property);
        if (value === null) {
            omissions.push({
                property: property.name,
                reasonCode: omissionReasonOverrides.get(property.name) ?? defaultOmissionReason(context, property),
                class: property.class,
            });
            continue;
        }
        document[property.name] = value;
        emittedProperties.push(property.name);
    }
    return { document, emittedProperties, evidence, omissions };
}
