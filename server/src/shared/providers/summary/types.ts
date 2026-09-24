/**
 * SummaryProvider contract.
 *
 * Optional AI helper that turns the audit's Fix-now findings into a plain-
 * English business-owner summary. The rest of the audit never depends on
 * this — feature off, key absent, or provider failure produces byte-
 * identical report output to the pre-feature snapshot.
 */
import type { SupportedLocale } from '../../i18n/index.js';
import type { AiUsageContext } from '../ai-generation.js';
export interface SummaryFindingInput {
    ruleId: string;
    /** Localized title (never a translation key) — what the provider quotes. */
    title: string;
    /** Localized "why it matters" copy. */
    why: string;
    /** Localized imperative fix copy. */
    fix: string;
    /** Count of affected URLs for this rule (0 for site-wide findings). */
    affectedCount: number;
}
export interface SummarizeInput {
    findings: SummaryFindingInput[];
    locale: SupportedLocale;
    siteDomain: string;
    /** Safe ownership metadata for content-free AI usage events. */
    usage?: AiUsageContext;
    correlationId?: string;
}
export interface SummarizeResult {
    summary: string;
    /** True when `stop_reason: max_tokens` — the UI adds a "shortened" note. */
    truncated: boolean;
    /** Model id used to produce the summary (e.g. `claude-haiku-4-5`). */
    model: string;
}
export interface GeneratePromptsInput {
    siteDomain: string;
    locale: SupportedLocale;
    /** How many prompts the caller wants back (clamped by the adapter). */
    count: number;
    /** Topic seeds the questions must stay grounded in — never free-associate. */
    seeds: {
        keywords: string[];
        titles: string[];
        competitors: string[];
        /**
         * Real Google Search Console queries for this site. Highest-signal seed
         * available and free — the rows are already stored from the daily
         * snapshot. Separate from `keywords` so the model can be told to weight
         * observed audience language above synthetic seeds.
         */
        gscQueries: string[];
    };
    usage?: AiUsageContext;
    correlationId?: string;
}
/** Taxonomy the generator assigns to each suggestion. */
export interface GeneratedPrompt {
    promptText: string;
    funnelStage: 'awareness' | 'consideration' | 'decision' | 'postPurchase';
    promptType: 'categoryDiscovery' | 'comparison' | 'alternatives' | 'problemFirst' | 'useCase' | 'pricingCommercial' | 'brandAccuracy' | 'objection';
    intent: 'informational' | 'commercial' | 'transactional' | 'navigational';
    branded: boolean;
    evidenceSource: 'gsc' | 'keyword' | 'title' | 'competitor' | 'llmSynthesis';
    /** Verbatim copy of the supplied seed this question derives from. */
    evidenceRef: string;
}
export interface GeneratePromptsResult {
    /**
     * Buyer-style questions people would ask an AI assistant, each tagged with
     * the taxonomy the server uses to enforce a generation mix. Empty when the
     * model answered but not with parseable structured output, or when every
     * row failed a task invariant — callers treat suggestions as best-effort and
     * must tolerate `[]`.
     */
    prompts: GeneratedPrompt[];
    model: string;
}
export interface SummaryProvider {
    /** Optional non-spending profile validation used before capacity reservation. */
    preflightSummarize?(input: SummarizeInput): void;
    /** Optional non-spending profile validation used before capacity reservation. */
    preflightGeneratePrompts?(input: GeneratePromptsInput): void;
    summarize(input: SummarizeInput): Promise<SummarizeResult>;
    generatePrompts(input: GeneratePromptsInput): Promise<GeneratePromptsResult>;
}
