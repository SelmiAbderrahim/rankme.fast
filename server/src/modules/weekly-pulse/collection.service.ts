/**
 * Weekly Pulse — collection service.
 *
 * Given a due (site, isoWeek), this service:
 *   1. loads the site's market snapshot, prompt cohort, and per-engine/
 *      surface coverage (all via injectable ports so tests can drive the state
 *      machine without importing the whole cross-module surface);
 *   2. calls DataForSEO historical LLM Mentions ONLY for supported cells;
 *   3. NEVER calls LLM Responses;
 *   4. NEVER enqueues / fetches a new SERP;
 *   5. reads stored tracked SERPs / confirmed rank events / actions /
 *      audience decisions locally through the port surface — zero spend.
 *
 * The pulse processor owns the state machine + weekly run claim; this
 * module owns the actual read-only collection.
 */
import type { AiMentionRow, AiVisibilityProvider } from '../../shared/providers/index.js';
import type { WeeklyPulseCitationSurface, } from '../../db/schema/weekly-pulse.js';
import type { TranslationKey, TranslationVars } from '../../shared/i18n/index.js';
// ---------------------------------------------------------------------------
// Injectable dependency ports
// ---------------------------------------------------------------------------
export interface SiteMarketSnapshot {
    /** Frozen market payload (deep-equal is the compatibility key). */
    readonly value: unknown;
}
export interface PromptCohortSnapshot {
    readonly id: string;
    readonly version: number;
    /** Prompts to run through historical LLM Mentions. Zero prompts → no
     * supported cell; the processor lands in `unsupported`. */
    readonly prompts: readonly string[];
}
export interface EngineSurfaceCellInput {
    readonly engine: string;
    readonly surface: WeeklyPulseCitationSurface;
    readonly supported: boolean;
    /** Nullable operator-safe reason string when supported=false. */
    readonly reason: string | null;
}
export interface CoverageSnapshot {
    readonly cells: readonly EngineSurfaceCellInput[];
}
export interface ConfirmedRankDrop {
    readonly keyword: string;
    readonly priorRank: number | null;
    readonly currentRank: number | null;
    readonly confirmedAt: string;
}
interface SemanticActionRow {
    readonly actionId: string;
    readonly messageKey: TranslationKey;
    readonly messageVars?: TranslationVars;
    readonly targetUrl: string | null;
    readonly targetMessageKey?: TranslationKey;
    readonly targetMessageVars?: TranslationVars;
    /** Terminal transition since prior compatible pulse. */
    readonly state: 'completed' | 'regressed' | 'open';
}
interface LegacyActionRow {
    readonly actionId: string;
    readonly verb: string;
    readonly target: string;
    readonly state: 'completed' | 'regressed' | 'open';
}
export type ActionRow = SemanticActionRow | LegacyActionRow;
export interface AudienceDecision {
    readonly id: string;
    readonly acceptedAt: string;
}
export interface CollectionPorts {
    /** Load frozen SiteMarket at run start. Missing → returns null and the
     * processor lands in `unsupported`. */
    loadSiteMarket(input: {
        accountId: string;
        siteId: string;
    }): Promise<SiteMarketSnapshot | null>;
    /** Immutable prompt cohort. */
    loadPromptCohort(input: {
        accountId: string;
        siteId: string;
    }): Promise<PromptCohortSnapshot | null>;
    /** Coverage per (engine, surface). */
    loadCoverage(input: {
        accountId: string;
        siteId: string;
    }): Promise<CoverageSnapshot>;
    /** Confirmed rank drops inside the comparison window. Zero
     * spend (read-only). */
    loadConfirmedRankDrops(input: {
        accountId: string;
        siteId: string;
        windowEnd: Date;
    }): Promise<readonly ConfirmedRankDrop[]>;
    /** Deterministic next-3 open actions. AI cannot reorder. */
    loadTopOpenActions(input: {
        accountId: string;
        siteId: string;
        limit: number;
    }): Promise<readonly ActionRow[]>;
    /** Actions completed / regressed since the prior compatible pulse. */
    loadActionTransitions(input: {
        accountId: string;
        siteId: string;
        windowEnd: Date;
    }): Promise<readonly ActionRow[]>;
    /** Accepted audience decisions — used in digest render. */
    loadAudienceDecisions(input: {
        accountId: string;
        siteId: string;
        windowEnd: Date;
    }): Promise<readonly AudienceDecision[]>;
}
// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------
export interface CollectionCellResult {
    readonly engine: string;
    readonly surface: WeeklyPulseCitationSurface;
    /** Per-URL rows normalized from the LLM Mentions response. */
    readonly citations: ReadonlyArray<{
        canonicalUrl: string;
        host: string;
        titleSafe: string | null;
        mentionCount: number;
        firstSeenAt: Date | null;
    }>;
    /** True when the vendor echo had no truncation/partial flag AND we
     * received rows (or explicit empty-complete). */
    readonly complete: boolean;
    /** Set when the provider terminated the cell in error. */
    readonly error: 'timeout' | 'malformed' | 'quota' | 'unavailable' | 'auth' | null;
}
export interface CollectionResult {
    readonly siteMarket: SiteMarketSnapshot;
    readonly cohort: PromptCohortSnapshot;
    readonly coverage: CoverageSnapshot;
    readonly cells: readonly CollectionCellResult[];
    readonly confirmedRankDrops: readonly ConfirmedRankDrop[];
    readonly topOpenActions: readonly ActionRow[];
    readonly actionTransitions: readonly ActionRow[];
    readonly audienceDecisions: readonly AudienceDecision[];
}
export interface RunCollectionInput {
    readonly accountId: string;
    readonly siteId: string;
    readonly siteDomain: string;
    readonly windowEnd: Date;
}
export interface RunCollectionDeps {
    readonly aiVisibility: AiVisibilityProvider;
    readonly ports: CollectionPorts;
}
/**
 * Reads the local + provider evidence for a single pulse run. NEVER calls
 * LLM Responses; NEVER enqueues/fetches a SERP. Caller is the pulse
 * processor which owns the weekly run claim — this function is invoked
 * ONLY after the claim has been taken.
 *
 * @throws when `loadSiteMarket` returns null (caller distinguishes into
 *   `unsupported`); the processor turns this into a state-machine leaf.
 */
export async function runCollection(deps: RunCollectionDeps, input: RunCollectionInput): Promise<CollectionResult> {
    const [siteMarket, cohort, coverage, confirmedRankDrops, topOpenActions, actionTransitions, audienceDecisions] = await Promise.all([
        deps.ports.loadSiteMarket({ accountId: input.accountId, siteId: input.siteId }),
        deps.ports.loadPromptCohort({ accountId: input.accountId, siteId: input.siteId }),
        deps.ports.loadCoverage({ accountId: input.accountId, siteId: input.siteId }),
        deps.ports.loadConfirmedRankDrops({
            accountId: input.accountId,
            siteId: input.siteId,
            windowEnd: input.windowEnd,
        }),
        deps.ports.loadTopOpenActions({
            accountId: input.accountId,
            siteId: input.siteId,
            limit: 3,
        }),
        deps.ports.loadActionTransitions({
            accountId: input.accountId,
            siteId: input.siteId,
            windowEnd: input.windowEnd,
        }),
        deps.ports.loadAudienceDecisions({
            accountId: input.accountId,
            siteId: input.siteId,
            windowEnd: input.windowEnd,
        }),
    ]);
    if (!siteMarket) {
        throw new UnsupportedPulseError('weeklyPulse.errors.missingMarket');
    }
    if (!cohort) {
        throw new UnsupportedPulseError('weeklyPulse.errors.missingCohort');
    }
    // `checkMentions` is already the provider's bounded Google + ChatGPT
    // historical fan-out for the whole cohort. Calling it once PER coverage
    // cell duplicated the paid request. Fetch once, then project its rows into
    // the supported cells below.
    const needsMentions = coverage.cells.some((cell) => cell.supported && cell.surface === 'mentions');
    let mentionRows: AiMentionRow[] = [];
    let mentionError: CollectionCellResult['error'] = null;
    if (needsMentions) {
        try {
            mentionRows = await deps.aiVisibility.checkMentions({
                domain: input.siteDomain,
                prompts: Array.from(cohort.prompts),
            });
        }
        catch (err) {
            mentionError = classifyProviderError(err);
        }
    }
    const cells: CollectionCellResult[] = [];
    for (const cell of coverage.cells) {
        if (!cell.supported) {
            cells.push({
                engine: cell.engine,
                surface: cell.surface,
                citations: [],
                complete: false,
                error: null,
            });
            continue;
        }
        if (cell.surface !== 'mentions') {
            // Only historical LLM Mentions cells are collected here — the
            // `citations` surface is an archival slot filled by other pipelines.
            // Absent supported implementation → treat as partial.
            cells.push({
                engine: cell.engine,
                surface: cell.surface,
                citations: [],
                complete: false,
                error: null,
            });
            continue;
        }
        if (mentionError !== null) {
            cells.push({
                engine: cell.engine,
                surface: cell.surface,
                citations: [],
                complete: false,
                error: mentionError,
            });
            continue;
        }
        // Filter to this cell's engine (provider reports one row per platform).
        const filtered = mentionRows.filter((row) => normalizeMentionEngine(row.model) === normalizeMentionEngine(cell.engine));
        // Aggregate per canonical URL. A URL cited by two cohort prompts is one
        // immutable row with `mentionCount=2`, not a conflict-discarded duplicate.
        const byUrl = new Map<string, {
            canonicalUrl: string;
            host: string;
            titleSafe: string | null;
            mentionCount: number;
            firstSeenAt: Date | null;
        }>();
        for (const row of filtered) {
            if (!row.mentioned || typeof row.citedUrl !== 'string' || row.citedUrl.length === 0) {
                continue;
            }
            const existing = byUrl.get(row.citedUrl);
            if (existing) {
                existing.mentionCount += 1;
                if (existing.firstSeenAt === null || row.checkedAt < existing.firstSeenAt) {
                    existing.firstSeenAt = row.checkedAt;
                }
            }
            else {
                byUrl.set(row.citedUrl, {
                    canonicalUrl: row.citedUrl,
                    host: safeHost(row.citedUrl),
                    titleSafe: null,
                    mentionCount: 1,
                    firstSeenAt: row.checkedAt,
                });
            }
        }
        cells.push({
            engine: cell.engine,
            surface: cell.surface,
            citations: Array.from(byUrl.values()),
            // Any successfully-returned provider response with no truncation flag
            // is complete; empty response is also `complete` (empty-complete).
            complete: true,
            error: null,
        });
    }
    return {
        siteMarket,
        cohort,
        coverage,
        cells,
        confirmedRankDrops,
        topOpenActions,
        actionTransitions,
        audienceDecisions,
    };
}
/**
 * Raised by `runCollection` when the site's SiteMarket or prompt cohort
 * cannot be loaded — the caller lands in `unsupported`.
 */
export class UnsupportedPulseError extends Error {
    constructor(public readonly messageKey: string) {
        super(messageKey);
        this.name = 'UnsupportedPulseError';
    }
}
function classifyProviderError(err: unknown): CollectionCellResult['error'] {
    const name = (err as {
        name?: string;
    })?.name ?? '';
    if (name.includes('Timeout'))
        return 'timeout';
    if (name.includes('Quota'))
        return 'quota';
    if (name.includes('Malformed'))
        return 'malformed';
    if (name.includes('Auth'))
        return 'auth';
    return 'unavailable';
}
function safeHost(url: string): string {
    try {
        return new URL(url).host.toLowerCase();
    }
    catch {
        return '';
    }
}
function normalizeMentionEngine(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/-/g, '_');
    return normalized === 'chatgpt' ? 'chat_gpt' : normalized;
}
