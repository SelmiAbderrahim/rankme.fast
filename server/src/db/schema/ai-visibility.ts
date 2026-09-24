import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
export const aiMentionSnapshots = pgTable('ai_mention_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    prompt: text('prompt').notNull(),
    model: text('model').notNull(),
    mentioned: boolean('mentioned').notNull(),
    citedUrl: text('cited_url'),
    sentiment: text('sentiment', { enum: ['positive', 'neutral', 'negative'] }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
}, (table) => [
    index('ai_mention_snapshots_site_checked_idx').on(table.siteId, table.checkedAt),
]);
export const aiCompetitorMentions = pgTable('ai_competitor_mentions', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    prompt: text('prompt').notNull(),
    model: text('model').notNull(),
    competitorDomain: text('competitor_domain').notNull(),
    mentioned: boolean('mentioned').notNull(),
    cited: boolean('cited').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
}, (table) => [
    index('ai_competitor_mentions_site_checked_idx').on(table.siteId, table.checkedAt),
]);
export const aiTrackedPrompts = pgTable('ai_tracked_prompts', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    prompt: text('prompt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('ai_tracked_prompts_site_prompt_idx').on(table.siteId, table.prompt),
]);
// ---------------------------------------------------------------------------
// AI Visibility prompt-suggestion runs.
//
// One row per metered "Generate suggestions" click. Append-only and read-latest
// rather than upsert-one-row: a generation that fails after the AI call must
// leave the account's previous good set intact, and an upsert would clobber it.
// The row IS the "has this ever been generated" signal — a null latest row is
// what distinguishes "never generated" from "generated, produced nothing".
// ---------------------------------------------------------------------------
/** Max prompts retained per run — mirrors `SUGGESTION_TARGET` in the service. */
export const AI_PROMPT_SUGGESTION_LIMIT = 8;
/** Where a retained prompt came from. `ideas` is gone with the paid top-up. */
export const AI_PROMPT_SUGGESTION_SOURCES = ['template', 'ai'] as const;
/** Which path actually produced the retained set for a run. */
export const AI_PROMPT_SUGGESTION_GENERATORS = ['ai', 'template'] as const;
const aiPromptSuggestionRowSchema = z
    .object({
    prompt: z.string().min(1).max(280),
    source: z.enum(AI_PROMPT_SUGGESTION_SOURCES),
    // Taxonomy carried through from the profile output so the panel can group
    // and the honesty tests can assert the generation mix. Nullable because
    // the template fallback produces prompts with no model-assigned taxonomy.
    funnelStage: z
        .enum(['awareness', 'consideration', 'decision', 'postPurchase'])
        .nullable(),
    promptType: z
        .enum([
        'categoryDiscovery',
        'comparison',
        'alternatives',
        'problemFirst',
        'useCase',
        'pricingCommercial',
        'brandAccuracy',
        'objection',
    ])
        .nullable(),
    intent: z
        .enum(['informational', 'commercial', 'transactional', 'navigational'])
        .nullable(),
    branded: z.boolean().nullable(),
    evidenceSource: z
        .enum(['gsc', 'keyword', 'title', 'competitor', 'llmSynthesis'])
        .nullable(),
    /** The exact GSC query / seed the row derives from; null on templates. */
    evidenceRef: z.string().max(280).nullable(),
})
    .strict();
export const aiPromptSuggestionSetSchema = z
    .array(aiPromptSuggestionRowSchema)
    .max(AI_PROMPT_SUGGESTION_LIMIT);
/**
 * The free first-party seeds the run was built from. Bounds mirror the
 * `ai_visibility_prompt_suggestions` profile input schema exactly, so a stored
 * seed set can always be replayed into the profile without re-truncation.
 */
export const aiPromptSuggestionSeedsSchema = z
    .object({
    keywords: z.array(z.string().max(200)).max(15),
    titles: z.array(z.string().max(500)).max(15),
    competitors: z.array(z.string().max(253)).max(15),
    gscQueries: z.array(z.string().max(200)).max(15),
})
    .strict();
export type AiPromptSuggestionRow = z.infer<typeof aiPromptSuggestionRowSchema>;
export type AiPromptSuggestionSet = z.infer<typeof aiPromptSuggestionSetSchema>;
export type AiPromptSuggestionSeeds = z.infer<typeof aiPromptSuggestionSeedsSchema>;
/** Parse every retained-prompt jsonb read before it reaches a DTO. */
export function parseAiPromptSuggestionSet(payload: unknown): AiPromptSuggestionSet {
    return aiPromptSuggestionSetSchema.parse(payload);
}
/** Parse every seed jsonb read before it reaches a DTO. */
export function parseAiPromptSuggestionSeeds(payload: unknown): AiPromptSuggestionSeeds {
    return aiPromptSuggestionSeedsSchema.parse(payload);
}
export const aiPromptSuggestionRuns = pgTable('ai_prompt_suggestion_runs', {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    siteId: text('site_id').notNull(),
    outputLocale: text('output_locale', { enum: SUPPORTED_LOCALES })
        .notNull()
        .default('en'),
    generatedAt: timestamp('generated_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
    prompts: jsonb('prompts').$type<AiPromptSuggestionSet>().notNull(),
    seeds: jsonb('seeds').$type<AiPromptSuggestionSeeds>().notNull(),
    generator: text('generator', {
        enum: AI_PROMPT_SUGGESTION_GENERATORS,
    }).notNull(),
    /** Provider model id; null when the template fallback produced the set. */
    model: text('model'),
}, (table) => [
    // Serves the only read: newest run for one owned site.
    index('ai_prompt_suggestion_runs_account_site_locale_generated_idx').on(table.accountId, table.siteId, table.outputLocale, table.generatedAt.desc()),
    check('ai_prompt_suggestion_runs_output_locale_check', sql `${table.outputLocale} in ('en', 'ar', 'fr', 'de', 'es', 'ru', 'zh')`),
    check('ai_prompt_suggestion_runs_prompts_check', sql `jsonb_typeof(${table.prompts}) = 'array' and jsonb_array_length(${table.prompts}) <= ${sql.raw(String(AI_PROMPT_SUGGESTION_LIMIT))}`),
    check('ai_prompt_suggestion_runs_seeds_size_check', sql `jsonb_typeof(${table.seeds}) = 'object' and octet_length(${table.seeds}::text) between 2 and 32768`),
    check('ai_prompt_suggestion_runs_generator_check', sql `${table.generator} in ('ai', 'template')`),
    // A template-only run has no model; an AI run always names one.
    check('ai_prompt_suggestion_runs_model_shape_check', sql `(${table.generator} = 'ai' and ${table.model} is not null) or (${table.generator} = 'template' and ${table.model} is null)`),
]);
export type AiPromptSuggestionRunRow = typeof aiPromptSuggestionRuns.$inferSelect;
export type NewAiPromptSuggestionRunRow = typeof aiPromptSuggestionRuns.$inferInsert;
export type AiMentionSnapshotRow = typeof aiMentionSnapshots.$inferSelect;
export type NewAiMentionSnapshotRow = typeof aiMentionSnapshots.$inferInsert;
export type AiCompetitorMentionRow = typeof aiCompetitorMentions.$inferSelect;
export type NewAiCompetitorMentionRow = typeof aiCompetitorMentions.$inferInsert;
export type AiTrackedPromptRow = typeof aiTrackedPrompts.$inferSelect;
export type NewAiTrackedPromptRow = typeof aiTrackedPrompts.$inferInsert;
