/**
 * Audience-research E2E helpers.
 *
 * The audience-research pipeline is consumed by a worker that is
 * not yet shipped; the queue itself lands terminal state only
 * through direct DB writes for this E2E surface. Partial/provider-blocked/cap
 * deterministic states are exercised through documented fake injection, not
 * live provider calls — this helper is that documented seam.
 *
 * The seam mutates ONLY the immutable `audience_research_runs`
 * Mongo document via the composed `mongo` service, mirroring the
 * `runComposePsql` pattern for Postgres. Every mutation writes safe, text-only
 * content (no HTML/script markers, output-encoding rule) that the shipped
 * schema `pre('validate')` guard accepts. No production route is added.
 */
import { randomBytes } from 'node:crypto';
import { runComposeCommand } from './compose';

export interface SeededAudienceSource {
  sourceId: string;
  canonicalUrl: string;
  title: string;
  sourceType: 'forum' | 'review' | 'comparison' | 'question' | 'other';
  registrableDomain: string;
  observedAt: string;
  excerpt: string;
}

export interface SeededAudienceSignal {
  signalId: string;
  type: 'complaint' | 'request' | 'question' | 'competitor_gap';
  title: string;
  summary: string;
  suggestedRoute: 'content' | 'comparison_page' | 'product' | 'seo';
  citedSourceIds: string[];
  independentDomainCount: number;
  sourceTypeCount: number;
  mostRecentSourceObservedAt: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface SeedTerminalRunInput {
  accountId: string;
  siteId: string;
  runId?: string;
  seedTopics: string[];
  competitorDomains?: string[];
  siteMarket?: {
    country: string;
    language: string;
    device: 'desktop' | 'mobile' | 'all';
  };
  state: 'completed' | 'partial' | 'failed';
  reasonCode?:
    | 'ok'
    | 'no_usable_public_evidence'
    | 'cost_ceiling_partial'
    | 'ai_dispatch_indeterminate'
    | 'processing_failure'
    | 'unsupported_market'
    | 'zdr_blocked';
  sources: SeededAudienceSource[];
  signals: SeededAudienceSignal[];
}

export interface SeededRun {
  runId: string;
  deterministicInputHash: string;
}

/**
 * Run a JavaScript snippet against the composed `mongo` service via
 * `mongosh --quiet --eval`. Variables are injected as a JSON blob into the
 * snippet's scope through a `const __args` binding — the caller MUST NOT
 * template raw strings into `js`. The helper is intentionally narrow.
 */
function runComposeMongo(
  js: string,
  args: Record<string, unknown>,
): string {
  const payload = JSON.stringify(args);
  const wrapped = `const __args = ${payload}; ${js}`;
  const stdout = runComposeCommand(
    [
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      'mongodb://mongo:27017/rankme',
      '--eval',
      wrapped,
    ],
  );
  return stdout.trim();
}

function newRunId(): string {
  // 24-hex ObjectId-compatible id — the model stores its own _id as an
  // ObjectId, but the API-surface `runId` string that the router emits is the
  // ObjectId's hex form, so an untyped hex string is enough to steer the URL.
  return randomBytes(12).toString('hex');
}

function newHash(seed: string): string {
  // A stable string that satisfies the unique
  // `(accountId, deterministicInputHash)` index. Real values are sha256 of a
  // canonicalized input; test-only hash lives under its own `e2e-` namespace
  // so it never collides with a production hash.
  return `e2e-${seed}-${randomBytes(16).toString('hex')}`;
}

/**
 * Insert a terminal-state audience research run directly into Mongo so the
 * browser can observe the read-only status/result/list endpoints without
 * waiting on a worker consumer. Mirrors the exact document shape of the
 * shipped Mongoose schema (`audience-research.model.ts`).
 */
export function seedTerminalAudienceResearchRun(
  input: SeedTerminalRunInput,
): SeededRun {
  const runId = input.runId ?? newRunId();
  const deterministicInputHash = newHash(runId);
  const now = new Date().toISOString();
  const doc = {
    _id: { $oid: runId },
    accountId: { $oid: input.accountId },
    siteId: { $oid: input.siteId },
    state: input.state,
    input: {
      siteMarket: input.siteMarket ?? {
        country: 'US',
        region: null,
        city: null,
        language: 'en',
        device: 'desktop',
      },
      competitorDomains: input.competitorDomains ?? [],
      seedTopics: input.seedTopics,
      queryTemplateVersion: 1,
    },
    deterministicInputHash,
    discovery: {
      queries: [],
      resultCount: input.sources.length,
      costMicros: 0,
      coverage: null,
    },
    candidates: [],
    sources: input.sources.map((source) => ({
      sourceId: source.sourceId,
      canonicalUrl: source.canonicalUrl,
      title: source.title,
      sourceType: source.sourceType,
      registrableDomain: source.registrableDomain,
      observedAt: source.observedAt,
      contentHash: `hash-${source.sourceId}`,
      excerpt: source.excerpt,
      observationMeta: {
        sourceKind: source.sourceType,
        sourceLabel: null,
        observedAt: source.observedAt,
        freshUntil: null,
        freshness: 'recent',
        market: null,
        sampleCount: 1,
        coverageNoteKey: null,
      },
      discoveryQueryIds: [],
    })),
    signals: input.signals.map((signal) => ({
      signalId: signal.signalId,
      type: signal.type,
      title: signal.title,
      summary: signal.summary,
      suggestedRoute: signal.suggestedRoute,
      citedSourceIds: signal.citedSourceIds,
      independentDomainCount: signal.independentDomainCount,
      sourceTypeCount: signal.sourceTypeCount,
      mostRecentSourceObservedAt: signal.mostRecentSourceObservedAt,
      confidence: signal.confidence,
    })),
    costLedger: [],
    aiClustering: {
      profileVersion: null,
      idempotencyKey: null,
      claimedAt: null,
      resolvedAt: null,
      resultDigest: null,
    },
    terminal: {
      state: input.state,
      reasonCode: input.reasonCode ?? (input.state === 'completed' ? 'ok' : 'processing_failure'),
      completedAt: { $date: now },
    },
    requestedAt: { $date: now },
    startedAt: { $date: now },
    completedAt: { $date: now },
    createdAt: { $date: now },
    updatedAt: { $date: now },
  };
  runComposeMongo(
    `db.getSiblingDB('rankme').audienceresearchruns.insertOne(EJSON.deserialize(__args.doc));`,
    { doc },
  );
  return { runId, deterministicInputHash };
}

/**
 * Remove every audience research document owned by a test account. Used at
 * spec teardown so re-running the same spec never accumulates rows across
 * runs (each fresh account already isolates state, but the delete is cheap
 * insurance).
 */
export function purgeAudienceResearchRunsForAccount(accountId: string): void {
  runComposeMongo(
    `db.getSiblingDB('rankme').audienceresearchruns.deleteMany({ accountId: ObjectId(__args.accountId) });`,
    { accountId },
  );
}
