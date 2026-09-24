/**
 * Injectable holders for the schema generator (mirrors
 * `keyword-research.holder.ts`).
 *
 * The api process owns the AI profile runner; the module reads it through
 * this holder so tests can swap in a deterministic fake provider without
 * touching boot code.
 *
 * The AI runner is wired UNCONDITIONALLY at boot — a keyless stack gets the
 * `fake` provider order, never a missing holder. (Skipping the wiring on a
 * keyless boot is what turned the GSC/GA4 reads into 500s once already.)
 */
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import type { SafeFetch } from './evidence.js';
let currentAiRunner: AiProfileRunner | null = null;
let currentAiProviderOrder: readonly AiGenerationProviderKey[] = ['fake'];
export function setSchemaGeneratorAiRunner(runner: AiProfileRunner | null, providerOrder: readonly AiGenerationProviderKey[] = ['fake']): void {
    currentAiRunner = runner;
    currentAiProviderOrder = providerOrder.length > 0 ? providerOrder : ['fake'];
}
export function getSchemaGeneratorAiRunner(): AiProfileRunner {
    if (currentAiRunner)
        return currentAiRunner;
    throw new Error('schema-generator AI runner not configured — call setSchemaGeneratorAiRunner() at boot');
}
export function getSchemaGeneratorAiProviderOrder(): readonly AiGenerationProviderKey[] {
    return currentAiProviderOrder;
}
let currentFetch: SafeFetch | null = null;
/**
 * Test-only seam for the pasted-URL path. Production leaves this null so
 * `assembleEvidence` uses `fetchPublicUrlSafe` — the ONLY outbound authority.
 */
export function setSchemaGeneratorFetch(fetchUrl: SafeFetch | null): void {
    currentFetch = fetchUrl;
}
export function getSchemaGeneratorFetch(): SafeFetch | null {
    return currentFetch;
}
