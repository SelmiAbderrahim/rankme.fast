/**
 * Content Intelligence public API.
 *
 * Downstream prompts (05 pipeline, 06 site workspace, 07 outcome loop,
 * 09 competitor intelligence, 11 superadmin, 12 MCP) consume this module
 * exclusively through the barrel — never by reaching into internal files.
 */
export { CONTENT_ANALYSIS_STATUSES, CONTENT_ANALYSIS_TERMINAL_STATUSES, CONTENT_ANALYSIS_ERROR_CATEGORIES, ContentAnalysis, isContentAnalysisCancellable, type ContentAnalysisDocument, type ContentAnalysisErrorCategory, type ContentAnalysisHydrated, type ContentAnalysisStatus, } from './content-analysis.model.js';
export { CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS, CONTENT_SNAPSHOT_ROLES, ContentSnapshot, type ContentSnapshotDocument, type ContentSnapshotHydrated, type ContentSnapshotRole, } from './content-snapshot.model.js';
export { CONTENT_ANALYSIS_STAGE_ORDER, ContentAnalysisTransitionError, assertContentAnalysisTransition, canTransition, isTerminalStatus, } from './content-analysis.state.js';
export { recordContentAnalysisEvent, type RecordContentAnalysisEventInput, } from './content-analysis.events.js';
export { cancelAnalysis, getAnalysis, listAnalyses, preflightAnalysis, regenerateAnalysis, resolveOwnedAnalysisSiteId, saveBriefVersion, saveDraftVersion, startAnalysis, toPublicAnalysis, type CreateAnalysisInput, type CreateAnalysisDeps, type ListAnalysesInput, type ListAnalysesResult, type PreflightInput, type PreflightResult, type SavedBriefVersion, type SavedDraftVersion, type StartedAnalysis, } from './content-intelligence.service.js';
export { advanceContentAnalysisStage, createContentAnalysisProcessor, type AdvanceStageInput, type ContentAnalysisProcessorDeps, } from './content-analysis.processor.js';
export { CONTENT_ANALYSIS_RECON_BATCH_SIZE, CONTENT_ANALYSIS_RECON_INTERVAL_MS, CONTENT_ANALYSIS_RECON_JOB, CONTENT_ANALYSIS_RECON_QUEUE, CONTENT_ANALYSIS_RECON_SCHEDULER_KEY, DEFAULT_QUEUED_ORPHAN_MS, DEFAULT_STUCK_RUN_MS, createContentAnalysisReconciliationProcessor, runContentAnalysisReconciliationSweep, type ReconcileDeps, type ReconcileOutcome, } from './content-analysis.reconciliation.js';
export { createContentIntelligenceAnalysisRouter, createContentIntelligenceSiteRouter, } from './content-intelligence.routes.js';
export { getContentAnalysisQueue, getContentInventoryQueue, getContentIntelligenceDb, setContentAnalysisQueue, setContentInventoryQueue, setContentIntelligenceDb, } from './content-intelligence.holders.js';
// ---- Content inventory + cannibalization ---------------------
export { CONTENT_INVENTORY_STATUSES, CONTENT_INVENTORY_TERMINAL_STATUSES, CONTENT_INVENTORY_ERROR_CATEGORIES, ContentInventoryRun, ContentInventoryPage, ContentInventorySnapshot, type ContentInventoryRunDocument, type ContentInventoryRunHydrated, type ContentInventoryPageDocument, type ContentInventorySnapshotDocument, type ContentInventoryStatus, type ContentInventoryErrorCategory, } from './inventory.model.js';
export { createContentInventoryRouter, } from './inventory.routes.js';
export { createContentInventoryProcessor, type ContentInventoryProcessorDeps, } from './inventory.processor.js';
export { startInventoryRun, listInventoryRuns, getInventoryRun, cancelInventoryRun, toPublicInventoryRun, type StartInventoryInput, type StartInventoryDeps, type StartedInventory, } from './inventory.service.js';
export { loadInventoryEvidence, loadGscQueryPageEvidence, GSC_QUERY_PAGE_DIMENSION, GSC_QUERY_PAGE_WINDOW_DAYS, type GscQueryPageEvidenceSnapshot, } from './inventory.evidence.js';
export { loadCompletedInventorySnapshot, COMPLETED_INVENTORY_PAGE_READ_LIMIT, type CompletedInventorySnapshot, } from './inventory.reads.js';
export { crawlInventory, CONTENT_INVENTORY_DEFAULT_DENYLIST, type CrawlInventoryResult, } from './inventory.crawler.js';
export { analyzeInventory, buildInventoryInboundCounts, normalizeUrlKey, type InventoryEvidence, } from './inventory.analysis.js';
export { inventoryPageFactsSchema, type InventoryPageFacts, } from './inventory.schemas.js';
export { AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX, createRecommendationForAudienceResearchSignal, type AudienceResearchRecommendationResult, type CreateAudienceResearchRecommendationInput, } from './content-recommendation.service.js';
export { CITATION_GAP_RECOMMENDATION_PREFIX, KEYWORD_CLUSTER_RECOMMENDATION_PREFIX, createRecommendationForKeywordCluster, getRecommendationApplicationCheck, listRecommendationHistory, mutateRecommendation, recommendationStatesForAnalysis, type CreateKeywordClusterRecommendationInput, type KeywordClusterRecommendationResult, type PublicRecommendationEvent, type PublicRecommendationState, type RecommendationApplicationCheck, type RecommendationAction, type RecommendationMutationInput, } from './content-recommendation.service.js';
// Versioned recommendation contract — consumed by the Next Actions content
// adapter to parse the Mixed `recommendations` array without reaching into
// private files.
export { recommendationSchema, type Recommendation, } from './content-analysis.schemas.js';
export { CONTENT_OUTCOME_AGGREGATION_VERSION, CONTENT_OUTCOME_REFRESH_INTERVAL_MS, CONTENT_OUTCOME_REFRESH_JOB, CONTENT_OUTCOME_REFRESH_QUEUE, CONTENT_OUTCOME_REFRESH_SCHEDULER_KEY, CONTENT_OUTCOME_WINDOW_DAYS, createContentOutcomeRefreshProcessor, getRecommendationOutcome, getStoredRecommendationOutcome, refreshAllRecommendationOutcomes, refreshRecommendationOutcome, } from './content-recommendation-outcomes.service.js';
export { createContentIntelligenceReportExportAdapters } from './report-export.adapters.js';
