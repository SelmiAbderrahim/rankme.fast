/**
 * Review Intelligence theme pass.
 *
 * One structured `review_themes` generation per settled sync run, over the
 * STORED, normalized review rows — never a raw vendor payload. The pass is
 * bounded by the `review_themes` AI profile cost ceiling.
 *
 * Citation-or-drop, enforced twice:
 *
 *   write boundary — the model is handed synthetic ids (`rev-001`, …) mapped
 *   to stored review document ids; a cited id the model invented resolves
 *   to nothing and is discarded, and a theme left with fewer than two cited
 *   rows is DROPPED.
 *
 *   read boundary — every persisted citation is re-checked against the rows
 *   CURRENTLY stored for the profile, so a deleted row cannot resurrect a
 *   stale citation; a theme left with fewer than two live citations is
 *   dropped, and every rendered excerpt is clamped to 300 characters through
 *   the shared output-encoding path.
 *
 * A dropped theme is never replaced. There is no "no data" placeholder theme.
 *
 * Terminal states written onto the run:
 *   `themes-ok`                 — at least one theme survived.
 *   `no-reliable-themes`        — the pass ran, zero themes survived.
 *   `ai-failed-reviews-intact`  — the pass threw; reviews stay queryable.
 *
 * Review text never reaches a log line from this file.
 */
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { loadOwnedProfile, resolveReviewOutputLocale, REVIEW_NOT_FOUND_KEY, } from './review-sync.service.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { neutralizeExportCell } from '../../shared/utils/csv.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { UnrecoverableError } from 'bullmq';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { LocalSeoReviewRow, LocalSeoReviewSyncRun, REVIEW_THEME_EXCERPT_MAX_CHARS, REVIEW_THEME_LABEL_MAX_CHARS, REVIEW_THEME_MAX_CITATIONS, REVIEW_THEME_MAX_PER_KIND, REVIEW_THEME_MIN_CITATIONS, REVIEW_THEME_SUMMARY_MAX_CHARS, type ReviewAiTerminalState, type ReviewSourceName, type ReviewThemeKind, } from './review-sync.model.js';
export const REVIEW_THEMES_PROFILE_NAME = 'review_themes' as const;
/** Newest rows handed to one generation — matches the profile input bound. */
export const REVIEW_THEMES_INPUT_MAX_ROWS = 60;
const SYNTHETIC_ID_PREFIX = 'rev-';
export interface ReviewThemesDeps {
    ai: AiProfileRunner;
    aiProviderOrder: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
export interface RunReviewThemesInput {
    accountId: string;
    runId: string;
}
export interface RunReviewThemesResult {
    terminal: ReviewAiTerminalState;
    themeCount: number;
    costMicros: number | null;
}
interface GeneratedTheme {
    label: string;
    summary: string;
    citedReviewIds: string[];
}
interface ThemeExtraction {
    complaintThemes: GeneratedTheme[];
    praiseThemes: GeneratedTheme[];
    citations: string[];
}
function syntheticIdFor(index: number): string {
    return `${SYNTHETIC_ID_PREFIX}${String(index + 1).padStart(3, '0')}`;
}
function clamp(value: string, max: number): string {
    const glyphs = [...value];
    return glyphs.length > max ? glyphs.slice(0, max).join('') : value;
}
/**
 * Read-boundary excerpt bound. Collapses whitespace, clamps to 300 grapheme
 * code points, and routes the result through the shared output-encoding helper
 * so a downstream CSV/spreadsheet re-export of the same text cannot execute a
 * formula.
 */
export function buildCitationExcerpt(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    // Neutralize first: the leading quote is part of the returned excerpt and
    // therefore must count toward the hard 300-character wire bound.
    return clamp(neutralizeExportCell(collapsed), REVIEW_THEME_EXCERPT_MAX_CHARS);
}
/**
 * Write-boundary citation enforcement. `known` maps the synthetic id handed to
 * the model back to the stored review document id. An unknown id is discarded;
 * a theme with fewer than two surviving citations is dropped outright.
 */
export function enforceThemeCitations(themes: readonly GeneratedTheme[], known: ReadonlyMap<string, string>, kind: ReviewThemeKind): Array<{
    kind: ReviewThemeKind;
    label: string;
    summary: string;
    citedReviewIds: string[];
}> {
    const kept = [];
    for (const theme of themes) {
        if (kept.length >= REVIEW_THEME_MAX_PER_KIND)
            break;
        const cited: string[] = [];
        for (const id of theme.citedReviewIds.slice(0, REVIEW_THEME_MAX_CITATIONS)) {
            const resolved = known.get(id);
            if (resolved === undefined || cited.includes(resolved))
                continue;
            cited.push(resolved);
        }
        if (cited.length < REVIEW_THEME_MIN_CITATIONS)
            continue;
        kept.push({
            kind,
            label: clamp(theme.label, REVIEW_THEME_LABEL_MAX_CHARS),
            summary: clamp(theme.summary, REVIEW_THEME_SUMMARY_MAX_CHARS),
            citedReviewIds: cited,
        });
    }
    return kept;
}
/**
 * Run the theme pass for one settled sync run.
 *
 * An atomic `aiPassStartedAt: null → timestamp` claim is taken immediately
 * before dispatch, so a replayed job never makes a second AI call or books a
 * second cost. The terminal write must match that claim timestamp.
 */
export async function runReviewThemesPass(input: RunReviewThemesInput, deps: ReviewThemesDeps): Promise<RunReviewThemesResult> {
    const now = deps.now ?? (() => new Date());
    const run = await LocalSeoReviewSyncRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!run) {
        return { terminal: 'pending', themeCount: 0, costMicros: null };
    }
    if (run.aiTerminalState !== 'pending') {
        return {
            terminal: run.aiTerminalState as ReviewAiTerminalState,
            themeCount: run.aiThemes.length,
            costMicros: run.aiCostMicros ?? null,
        };
    }
    // Another worker has already crossed the exactly-once dispatch boundary.
    // It owns the terminal write; a replay must not make a second AI call.
    if (run.aiPassStartedAt) {
        return { terminal: 'pending', themeCount: 0, costMicros: run.aiCostMicros ?? null };
    }
    if (!isSupportedLocale(run.outputLocale)) {
        throw new UnrecoverableError('review themes run has no valid output locale');
    }
    const outputLocale: SupportedLocale = run.outputLocale;
    const profileId = String(run.profileId);
    const rows = await LocalSeoReviewRow.find({ accountId: input.accountId, profileId })
        .sort({ reviewedAt: -1, _id: -1 })
        .limit(REVIEW_THEMES_INPUT_MAX_ROWS)
        .select({ sourceReviewId: 1, rating: 1, title: 1, text: 1, reviewedAt: 1 });
    // The pass runs only when the run actually has review material
    // behind it. A settled run with an empty inventory has nothing to theme, so
    // it terminates honestly instead of sitting on `pending` forever.
    if (rows.length === 0) {
        const settled = await settleThemes({
            input,
            themes: [],
            costMicros: null,
            terminal: 'no-reliable-themes',
            startedAt: null,
            completedAt: now(),
            inputCount: 0,
        });
        if (!settled) {
            return readCurrentPassResult(input, 'no-reliable-themes', null);
        }
        return { terminal: 'no-reliable-themes', themeCount: 0, costMicros: null };
    }
    const known = new Map<string, string>();
    const reviews = rows.map((row, index) => {
        const syntheticId = syntheticIdFor(index);
        known.set(syntheticId, String(row._id));
        return {
            id: syntheticId,
            rating: row.rating ?? null,
            title: row.title ?? '',
            text: row.text,
            reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
        };
    });
    // Claim immediately before dispatch. The predicate is the exactly-once
    // boundary: only the worker that changes null → timestamp may call AI.
    const startedAt = now();
    const claimed = await LocalSeoReviewSyncRun.findOneAndUpdate({
        _id: input.runId,
        accountId: input.accountId,
        aiTerminalState: 'pending',
        aiPassStartedAt: null,
    }, { $set: { aiPassStartedAt: startedAt, aiInputCount: reviews.length } }, { new: true });
    if (!claimed) {
        return readCurrentPassResult(input, 'pending', null);
    }
    let generated;
    try {
        generated = await deps.ai.run<ThemeExtraction>({
            profile: REVIEW_THEMES_PROFILE_NAME,
            input: { reviews },
            locale: outputLocale,
            // Stable across job replay and content-free for telemetry.
            correlationId: `review-themes-${input.runId}`,
            usage: { accountId: input.accountId, siteId: profileId, jobId: input.runId },
            configuredProviderOrder: deps.aiProviderOrder,
        });
    }
    catch {
        // Reviews already landed — they stay queryable.
        const settled = await settleThemes({
            input,
            themes: [],
            costMicros: null,
            terminal: 'ai-failed-reviews-intact',
            startedAt,
            completedAt: now(),
            inputCount: reviews.length,
        });
        if (!settled) {
            return readCurrentPassResult(input, 'ai-failed-reviews-intact', null);
        }
        return { terminal: 'ai-failed-reviews-intact', themeCount: 0, costMicros: null };
    }
    const themes = [
        ...enforceThemeCitations(generated.object.complaintThemes, known, 'complaint'),
        ...enforceThemeCitations(generated.object.praiseThemes, known, 'praise'),
    ];
    const costMicros = Number(generated.provenance.actualOrEstimatedCostMicros);
    const terminal: ReviewAiTerminalState = themes.length > 0 ? 'themes-ok' : 'no-reliable-themes';
    const settled = await settleThemes({
        input,
        themes,
        costMicros,
        terminal,
        startedAt,
        completedAt: now(),
        inputCount: reviews.length,
    });
    if (!settled) {
        // A concurrent settle won the `pending` claim. Report what actually
        // landed rather than the result this attempt computed.
        return readCurrentPassResult(input, terminal, costMicros);
    }
    return { terminal, themeCount: themes.length, costMicros };
}
interface SettleThemesInput {
    input: RunReviewThemesInput;
    themes: ReturnType<typeof enforceThemeCitations>;
    costMicros: number | null;
    terminal: ReviewAiTerminalState;
    startedAt: Date | null;
    completedAt: Date;
    inputCount: number;
}
async function settleThemes(settlement: SettleThemesInput): Promise<boolean> {
    const claimed = await LocalSeoReviewSyncRun.findOneAndUpdate({
        _id: settlement.input.runId,
        accountId: settlement.input.accountId,
        aiTerminalState: 'pending',
        aiPassStartedAt: settlement.startedAt,
    }, {
        $set: {
            aiTerminalState: settlement.terminal,
            aiThemes: settlement.themes,
            aiCostMicros: settlement.costMicros,
            aiCompletedAt: settlement.completedAt,
            aiInputCount: settlement.inputCount,
        },
    }, { new: true });
    return claimed !== null;
}
async function readCurrentPassResult(input: RunReviewThemesInput, fallbackTerminal: ReviewAiTerminalState, fallbackCostMicros: number | null): Promise<RunReviewThemesResult> {
    const current = await LocalSeoReviewSyncRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    return {
        terminal: (current?.aiTerminalState ?? fallbackTerminal) as ReviewAiTerminalState,
        themeCount: current?.aiThemes.length ?? 0,
        costMicros: current?.aiCostMicros ?? fallbackCostMicros,
    };
}
export interface ReviewThemeCitation {
    reviewId: string;
    sourceReviewId: string;
    source: ReviewSourceName;
    rating: number | null;
    reviewedAt: string | null;
    excerpt: string;
}
export interface ReviewThemeView {
    label: string;
    summary: string;
    citedReviewIds: string[];
    citations: ReviewThemeCitation[];
}
export interface ReviewThemesView {
    runId: string;
    outputLocale: SupportedLocale | null;
    terminal: ReviewAiTerminalState;
    complaintThemes: ReviewThemeView[];
    praiseThemes: ReviewThemeView[];
    observation: ObservationMeta | null;
}
/**
 * Read boundary for `GET /api/local-seo/reviews/themes/:runId`.
 *
 * Cross-account and unknown runs both 404. Every citation is resolved against
 * the rows CURRENTLY persisted for the profile — a deleted row drops its
 * citation, and a theme below the two-citation bar drops with it.
 */
export async function getReviewThemes(accountId: string, runId: string): Promise<ReviewThemesView> {
    const run = await LocalSeoReviewSyncRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'REVIEW_NOT_FOUND', messageKey: REVIEW_NOT_FOUND_KEY });
    await loadOwnedProfile(accountId, String(run.profileId));
    const citedIds = [
        ...new Set(run.aiThemes.flatMap((theme) => [...theme.citedReviewIds])),
    ];
    const rows = citedIds.length
        ? await LocalSeoReviewRow.find({
            accountId,
            profileId: run.profileId,
            _id: { $in: citedIds },
        }).select({ sourceReviewId: 1, source: 1, rating: 1, reviewedAt: 1, text: 1 })
        : [];
    const byId = new Map(rows.map((row) => [String(row._id), row] as const));
    const complaintThemes: ReviewThemeView[] = [];
    const praiseThemes: ReviewThemeView[] = [];
    for (const theme of run.aiThemes) {
        const citations: ReviewThemeCitation[] = [];
        const seen = new Set<string>();
        for (const id of theme.citedReviewIds) {
            const row = byId.get(id);
            if (!row || seen.has(id))
                continue;
            seen.add(id);
            citations.push({
                reviewId: String(row._id),
                sourceReviewId: row.sourceReviewId,
                source: row.source as ReviewSourceName,
                rating: row.rating ?? null,
                reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
                excerpt: buildCitationExcerpt(row.text),
            });
        }
        // Drop, never invent: a theme whose evidence no longer exists disappears.
        if (citations.length < REVIEW_THEME_MIN_CITATIONS)
            continue;
        const view: ReviewThemeView = {
            label: theme.label,
            summary: theme.summary,
            citedReviewIds: citations.map((citation) => citation.reviewId),
            citations,
        };
        (theme.kind === 'complaint' ? complaintThemes : praiseThemes).push(view);
    }
    const visibleThemeCount = complaintThemes.length + praiseThemes.length;
    const terminal = run.aiTerminalState === 'themes-ok' && visibleThemeCount === 0
        ? 'no-reliable-themes'
        : (run.aiTerminalState as ReviewAiTerminalState);
    const observation = run.aiCompletedAt && run.aiInputCount && run.aiInputCount > 0
        ? buildObservationMeta({
            sourceKind: 'ai_interpretation',
            sourceLabel: 'rankme_ai',
            observedAt: run.aiCompletedAt,
            freshUntil: null,
            sampleCount: run.aiInputCount,
            coverageNoteKey: 'observations.coverage.aiInterpretation',
            ...(terminal === 'ai-failed-reviews-intact' ? { status: 'failed' as const } : {}),
        })
        : null;
    return {
        runId: String(run._id),
        outputLocale: resolveReviewOutputLocale(run),
        terminal,
        complaintThemes,
        praiseThemes,
        observation,
    };
}
