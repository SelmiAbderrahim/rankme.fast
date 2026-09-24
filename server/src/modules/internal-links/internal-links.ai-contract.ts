/** Post-model contract: AI may reorder candidates and replace anchors only. */
import { internalLinkingAiOutputSchema, type InternalLinkingAiOutput, } from '../../shared/ai-profiles/index.js';
import { normalizeUrlKey, type InventoryPageFacts, } from '../content-intelligence/index.js';
import { internalLinkSuggestionSetSchema, type InternalLinkSuggestion, } from './internal-links.schemas.js';
export class InternalLinkAiOutputContractError extends Error {
    constructor() {
        super('internal_linking_ai_output_rejected');
        this.name = 'InternalLinkAiOutputContractError';
    }
}
/**
 * Reject the complete hostile output; never partially trust it. Returning a
 * mapped list means every row is an exact supplied pair and every target is a
 * currently pinned, indexable inventory page.
 */
export function validateInternalLinkingAiOutput(raw: unknown, candidates: readonly InternalLinkSuggestion[], inventoryPages: readonly InventoryPageFacts[]): InternalLinkingAiOutput {
    const parsed = internalLinkingAiOutputSchema.safeParse(raw);
    if (!parsed.success)
        throw new InternalLinkAiOutputContractError();
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const inventory = new Set(inventoryPages.map((page) => normalizeUrlKey(page.url)));
    const noindex = new Set(inventoryPages
        .filter((page) => page.qualityFlags.includes('noindex'))
        .map((page) => normalizeUrlKey(page.url)));
    const seenIds = new Set<string>();
    const seenPairs = new Set<string>();
    for (const suggestion of parsed.data.suggestions) {
        const candidate = byId.get(suggestion.candidateId);
        const sourceKey = normalizeUrlKey(suggestion.sourceUrl);
        const targetKey = normalizeUrlKey(suggestion.targetUrl);
        const pair = `${sourceKey}\u001F${targetKey}`;
        if (!candidate ||
            seenIds.has(suggestion.candidateId) ||
            seenPairs.has(pair) ||
            suggestion.sourceUrl !== candidate.sourceUrl ||
            suggestion.targetUrl !== candidate.targetUrl ||
            !inventory.has(sourceKey) ||
            !inventory.has(targetKey) ||
            noindex.has(targetKey)) {
            throw new InternalLinkAiOutputContractError();
        }
        seenIds.add(suggestion.candidateId);
        seenPairs.add(pair);
    }
    return parsed.data;
}
/** Apply accepted model order/anchors, then retain every omitted candidate. */
export function applyInternalLinkingAiOutput(output: InternalLinkingAiOutput, candidates: readonly InternalLinkSuggestion[]): InternalLinkSuggestion[] {
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const ranked = output.suggestions.map((suggestion, index) => ({
        ...byId.get(suggestion.candidateId)!,
        anchorText: suggestion.anchorText,
        rank: index + 1,
        rankingSource: 'ai' as const,
    }));
    const rankedIds = new Set(output.suggestions.map((suggestion) => suggestion.candidateId));
    const omitted = candidates
        .filter((candidate) => !rankedIds.has(candidate.id))
        .map((candidate) => ({ ...candidate, rank: null, rankingSource: 'deterministic' as const }));
    return internalLinkSuggestionSetSchema.parse([...ranked, ...omitted]);
}
