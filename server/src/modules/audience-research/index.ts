/**
 * Audience Research feature module — public API.
 *
 * The queue processor, API routes, and workspace UI
 * import ONLY from this barrel — never from the internal files directly.
 */
export { AUDIENCE_RESEARCH_STATES, TERMINAL_STATES, assertTransition, canTransition, isTerminal, AudienceResearchTransitionError, type AudienceResearchState, } from './audience-research.state.js';
export { AUDIENCE_RESEARCH_CONFIDENCE, AUDIENCE_RESEARCH_LEDGER_OUTCOMES, AUDIENCE_RESEARCH_LEDGER_STAGES, AUDIENCE_RESEARCH_SIGNAL_TYPES, AUDIENCE_RESEARCH_SOURCE_TYPES, AUDIENCE_RESEARCH_SUGGESTED_ROUTES, AUDIENCE_RESEARCH_TERMINAL_REASON_CODES, AudienceResearchRun, isTerminalState, type AudienceResearchConfidence, type AudienceResearchLedgerOutcome, type AudienceResearchLedgerStage, type AudienceResearchRunDocument, type AudienceResearchRunHydrated, type AudienceResearchSignalType, type AudienceResearchSourceType, type AudienceResearchSuggestedRoute, type AudienceResearchTerminalReasonCode, } from './audience-research.model.js';
export { MAX_COMPETITOR_DOMAINS, MAX_SEED_TOPICS, SEED_TOPIC_MAX, SEED_TOPIC_MIN, audienceResearchInputSchema, type AudienceResearchInput, } from './audience-research.schemas.js';
export { computeDeterministicInputHash, type DeterministicInputHashInput, } from './deterministic-input-hash.js';
export { PER_QUERY_LIMIT, QUERY_CAP, QUERY_TEMPLATE_VERSION, TRACKED_KEYWORD_CAP, generateQueries, type GeneratedQuery, type QueryCategory, type QueryGenerationInput, type QueryTemplateId, } from './query-templates.js';
export { classifySourceType, registrableDomain, } from './source-classifier.js';
export { MAX_CANDIDATES, MAX_PER_REGISTRABLE_DOMAIN, dedupeByCanonical, dedupeByContentHash, selectCandidates, type Candidate, type SelectCandidatesInput, } from './selection.js';
export { computeConfidence, type Confidence, type ConfidenceCitedSource, type ConfidenceReasonCode, type ConfidenceResult, type ComputeConfidenceInput, } from './confidence.js';
export { EXCERPT_MAX_LENGTH, buildEvidenceExcerpt, } from './excerpt.js';
// HTTP API surface.
export { getAudienceResearchDb, getAudienceResearchQueue, setAudienceResearchDb, setAudienceResearchQueue, } from './audience-research.holders.js';
export { createAudienceResearchSiteRouter } from './audience-research.routes.js';
export { getAudienceResearchRun, getAudienceResearchRunResult, listAudienceResearchRuns, previewAudienceResearchRun, startAudienceResearchRun, type ListRunsInput, type ListRunsResult, type PreviewRunInput, type RunResultView, type RunStatusView, type StartRunDeps, type StartRunInput, type StartedRun, } from './audience-research.service.js';
export { decisionBodySchema, listRunsQuerySchema, runIdParamsSchema, runInputBodySchema, signalIdParamsSchema, siteIdParamsSchema as audienceResearchSiteIdParamsSchema, type DecisionBody, type ListRunsQuery, type RunIdParams, type RunInputBody, type SignalIdParams, } from './audience-research.api.schemas.js';
export { decideAudienceResearchSignal, listTerminalSignalDecisions, type DecideSignalInput, type DecideSignalResult, } from './audience-research.decisions.js';
export { createAudienceResearchReportExportAdapter } from './report-export.adapter.js';
// Queue processor, reconciliation.
export { runAudienceResearchPipeline, AI_CLUSTER_PROFILE_NAME, AI_CLUSTER_PROFILE_VERSION, TOTAL_COST_CEILING_MICROS, AI_COST_CEILING_MICROS, DISCOVERY_COST_PER_QUERY_MICROS, COLLECT_COST_PER_PAGE_MICROS, AI_CALL_ESTIMATE_MICROS, type AudienceResearchPipelineDeps, type RunAudienceResearchPipelineInput, type RunAudienceResearchPipelineResult, } from './audience-research.pipeline.js';
export { createAudienceResearchProcessor, type AudienceResearchProcessorDeps, } from './audience-research.processor.js';
export { runAudienceResearchReconciliationSweep, createAudienceResearchReconciliationProcessor, AUDIENCE_RESEARCH_RECON_QUEUE, AUDIENCE_RESEARCH_RECON_JOB, AUDIENCE_RESEARCH_RECON_SCHEDULER_KEY, AUDIENCE_RESEARCH_RECON_INTERVAL_MS, AUDIENCE_RESEARCH_RECON_BATCH_SIZE, DEFAULT_QUEUED_ORPHAN_MS, DEFAULT_STUCK_RUN_MS, type ReconcileDeps, type ReconcileOutcome, } from './audience-research.reconciliation.js';
