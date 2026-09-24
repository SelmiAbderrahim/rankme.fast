/**
 * Competitor content intelligence public API.
 *
 * The `?tab=content&view=competitors` surface. Downstream (client slice,
 * legal purge/export, superadmin) consume this module exclusively through the
 * barrel — never by reaching into internal files.
 */
export { COMPETITOR_CONTENT_STATUSES, COMPETITOR_CONTENT_TERMINAL_STATUSES, COMPETITOR_CONTENT_ERROR_CATEGORIES, COMPETITOR_CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS, CompetitorContentRun, CompetitorPageFacts, CompetitorContentSnapshot, type CompetitorContentRunDocument, type CompetitorContentRunHydrated, type CompetitorPageFactsDocument, type CompetitorContentSnapshotDocument, type CompetitorContentStatus, type CompetitorContentErrorCategory, } from './competitor-content.model.js';
export { COMPETITOR_CONTENT_STAGE_ORDER, CompetitorContentTransitionError, assertCompetitorContentTransition, canCompetitorContentTransition, isCompetitorContentCancellable, isCompetitorContentTerminalStatus, } from './competitor-content.state.js';
export { recordCompetitorContentEvent, type RecordCompetitorContentEventInput, } from './competitor-content.events.js';
export { addCompetitor, archiveCompetitor, canonicalOrigin, listCompetitors, loadActiveCompetitorProfiles, registrableDomainKey, restoreCompetitor, suggestCompetitors, toPublicCompetitorProfile, type AddCompetitorResult, type CompetitorSuggestion, type PublicCompetitorProfile, } from './competitor-content.profiles.service.js';
export { cancelCompetitorRun, getCompetitorRun, listCompetitorRuns, startCompetitorRun, toPublicCompetitorRun, type StartCompetitorRunDeps, type StartCompetitorRunInput, type StartedCompetitorRun, } from './competitor-content.runs.service.js';
export { createCompetitorContentRouter, } from './competitor-content.routes.js';
export { createCompetitorContentProcessor, type CompetitorContentProcessorDeps, } from './competitor-content.processor.js';
export { getCompetitorContentDb, getCompetitorContentQueue, setCompetitorContentDb, setCompetitorContentQueue, } from './competitor-content.holders.js';
export { createCompetitorContentReportExportAdapter } from './report-export.adapter.js';
export { localizeCompetitorContentFindings, localizeCompetitorContentWarning, } from './competitor-content.copy.js';
export { loadCompetitorEvidence, type CompetitorDomainEvidence, type CompetitorEvidenceMap, } from './competitor-content.evidence.js';
export { COMPETITOR_CONTENT_THRESHOLDS, buildDelta, compareCompetitors, compareReviewedPairs, detectOpportunities, type CompetitorContentThresholds, type CompetitorPageInput, type ReviewedCompetitorPairInput, } from './competitor-content.delta.js';
export { collectPages, documentToFacts, sanitizeSnippet, stripHtmlMarkers, type CollectResult, type CollectedPage, } from './competitor-content.collect.js';
export { evaluateCopySimilarity, jaccardSimilarity, shingleSet, tokenizeWords, type NgramGuardResult, } from './competitor-content.ngram.js';
export { COMPETITOR_CONTENT_SCHEMA_VERSION, COMPETITOR_CONTENT_THRESHOLDS_VERSION, competitorContentFindingsSchema, competitorPageFactsSchema, type CompetitorContentFindings, type CompetitorDelta, type CompetitorOpportunity, type CompetitorPageFacts as CompetitorPageFactsShape, } from './competitor-content.schemas.js';
