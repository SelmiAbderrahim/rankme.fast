/**
 * Injectable holder. Mirrors ranks.queue-holder.ts: the API process owns the
 * singleton db + provider; the module's router reads through this holder so
 * unit tests can swap in PGlite + a fake provider.
 */
import type { Db } from '../../db/client.js';
import type { CompetitorProvider, ContentSourceProvider, KeywordProvider, SiteKeywordProvider, TrendsProvider, } from '../../shared/providers/index.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
let currentDb: Db | null = null;
export function setKeywordResearchDb(db: Db | null): void {
    currentDb = db;
}
export function getKeywordResearchDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('keyword-research db not configured — call setKeywordResearchDb() at boot');
}
let currentProvider: (KeywordProvider & Partial<SiteKeywordProvider>) | null = null;
export function setKeywordProvider(provider: (KeywordProvider & Partial<SiteKeywordProvider>) | null): void {
    currentProvider = provider;
}
export function getKeywordProvider(): KeywordProvider {
    if (currentProvider)
        return currentProvider;
    throw new Error('keyword provider not configured — call setKeywordProvider() at boot');
}
/** Return the optional provider capability used by site keyword discovery. */
export function getSiteKeywordProvider(): SiteKeywordProvider {
    const provider = getKeywordProvider() as KeywordProvider & Partial<SiteKeywordProvider>;
    if (typeof provider.getRankedKeywordsForSite === 'function'
        && typeof provider.getKeywordIdeasForSite === 'function') {
        return provider as KeywordProvider & SiteKeywordProvider;
    }
    throw new Error('keyword provider does not support site keyword discovery');
}
let currentKeywordDiscoveryContentSource: ContentSourceProvider | null = null;
/** Content evidence source used only by the site-keyword fallback. */
export function setKeywordDiscoveryContentSourceProvider(provider: ContentSourceProvider | null): void {
    currentKeywordDiscoveryContentSource = provider;
}
export function getKeywordDiscoveryContentSourceProvider(): ContentSourceProvider {
    if (currentKeywordDiscoveryContentSource)
        return currentKeywordDiscoveryContentSource;
    throw new Error('keyword discovery content source not configured — call setKeywordDiscoveryContentSourceProvider() at boot');
}
let currentCompetitorProvider: CompetitorProvider | null = null;
/**
 * Injects a `CompetitorProvider` for the keyword gap route. The
 * keyword-research module reads the competitor capability through this
 * holder so it never imports from the sibling competitors feature module
 *, and a module-level grep in
 * `keyword-research.gap-overview-trends.test.ts` asserts the ban.
 *
 * Named `KeywordResearchCompetitorProvider` (not `CompetitorProvider`) so it
 * does not collide with the existing setter exported by the competitors
 * feature module when both are wired at boot.
 */
export function setKeywordResearchCompetitorProvider(provider: CompetitorProvider | null): void {
    currentCompetitorProvider = provider;
}
export function getKeywordResearchCompetitorProvider(): CompetitorProvider {
    if (currentCompetitorProvider)
        return currentCompetitorProvider;
    throw new Error('keyword-research competitor provider not configured — call setKeywordResearchCompetitorProvider() at boot');
}
let currentAiRunner: AiProfileRunner | null = null;
let currentAiProviderOrder: readonly AiGenerationProviderKey[] = ['fake'];
export function setKeywordResearchAiRunner(runner: AiProfileRunner | null, providerOrder: readonly AiGenerationProviderKey[] = ['fake']): void {
    currentAiRunner = runner;
    currentAiProviderOrder = providerOrder.length > 0 ? providerOrder : ['fake'];
}
export function getKeywordResearchAiRunner(): AiProfileRunner {
    if (currentAiRunner)
        return currentAiRunner;
    throw new Error('keyword-research AI runner not configured — call setKeywordResearchAiRunner() at boot');
}
export function getKeywordResearchAiProviderOrder(): readonly AiGenerationProviderKey[] {
    return currentAiProviderOrder;
}
let currentTrendsProvider: TrendsProvider | null = null;
/**
 * Injects the `TrendsProvider` capability consumed by the live Keyword Trends
 * flow. Kept on the keyword-research module holder so the module
 * never imports the concrete adapter — the registry wires the fake/DataForSEO
 * adapter at boot and swaps it here.
 */
export function setKeywordResearchTrendsProvider(provider: TrendsProvider | null): void {
    currentTrendsProvider = provider;
}
export function getKeywordResearchTrendsProvider(): TrendsProvider {
    if (currentTrendsProvider)
        return currentTrendsProvider;
    throw new Error('keyword-research trends provider not configured — call setKeywordResearchTrendsProvider() at boot');
}
