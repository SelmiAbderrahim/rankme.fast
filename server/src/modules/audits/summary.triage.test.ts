import mongoose, { type Types } from "mongoose";
import type { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState } from "../../db/schema/action-events.js";
import type { SummaryProvider } from "../../shared/providers/index.js";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "../../shared/testing/mongo.js";
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables, } from "../../shared/testing/postgres.js";
import { appendActionEvent, hashActionId } from "../actions/index.js";
import { legacyAuditActionId } from "../actions/actions.identity.js";
import { Site } from "../sites/index.js";
import { AuditRun } from "./audit-run.model.js";
import { ReportSnapshot } from "./report-snapshot.model.js";
import { DETERMINISTIC_SUMMARY_MODEL } from "./summary.guard.js";
import { MAX_SUMMARY_EVIDENCE_LINES, MAX_SUMMARY_FINDINGS, NOTHING_URGENT_SUMMARY_MODEL, SUMMARY_MAX_GENERATIONS, evaluateSummaryFreshness, fallbackStructuredSummary, generateAuditSummary, getAuditSummaryState, selectSummaryFindings, startAuditSummary, summaryEvidenceFor, summaryInputHash, } from "./summary.service.js";

// Triage-aware summary input, freshness, validation and regeneration.
const stubGeneratePrompts = async () => ({ prompts: [], model: "stub-summary" });
function fakeProvider(overrides: Partial<SummaryProvider> = {}): SummaryProvider {
  return {
    generatePrompts: stubGeneratePrompts,
    async summarize() {
      return { summary: "Fix titles first.", truncated: false, model: "test-model" };
    },
    ...overrides,
  };
}
function fakeQueue(add = vi.fn().mockResolvedValue({ id: "summary-job" })): Queue {
  return { add } as unknown as Queue;
}
interface SeedFinding {
  ruleId: string;
  bucket: string;
  severity: string;
  affectedUrls: string[];
  meta: Record<string, unknown> | null;
}
async function seedOne(options: { findings?: SeedFinding[] } = {}): Promise<{ runId: string; accountId: string; siteId: string }> {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: "https://example.com", domain: "example.com", displayName: "Example" });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: "succeeded" });
  await ReportSnapshot.create({
    runId: run._id,
    siteId: site._id,
    accountId,
    counts: { fixNow: 1, watch: 1, passed: 0 },
    findings: options.findings ?? [
      { ruleId: "title-missing-or-weak", bucket: "fix-now", severity: "critical", affectedUrls: ["https://example.com/a"], meta: null },
      { ruleId: "headings-weak", bucket: "watch", severity: "warning", affectedUrls: [], meta: null },
    ],
  });
  return {
    runId: (run._id as Types.ObjectId).toHexString(),
    accountId: (accountId as Types.ObjectId).toHexString(),
    siteId: (site._id as Types.ObjectId).toHexString(),
  };
}
beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("summary input selection", () => {
  const finding = (
    ruleId: string,
    bucket: string,
    meta: Record<string, unknown> | null = null,
    affected = 1,
  ): SeedFinding => ({
    ruleId,
    bucket,
    severity: bucket === "fix-now" ? "critical" : "warning",
    affectedUrls: Array.from({ length: affected }, (_, i) => `https://example.com/${i}`),
    meta,
  });

  it("puts every fix-now finding before watch findings and skips passed / not-evaluated / insufficient-data", () => {
    const selected = selectSummaryFindings(
      [
        finding("headings-weak", "watch"),
        finding("title-missing-or-weak", "fix-now"),
        finding("meta-description-missing", "passed"),
        finding("page-speed", "not-evaluated", { insufficientData: true }),
        // Legacy snapshots stored insufficient-data findings as watch/fix-now.
        finding("core-web-vitals-poor", "watch", { insufficientData: true }),
        finding("index-coverage", "fix-now", { insufficientData: true }),
        finding("structured-data-missing", "watch", { insufficientData: false }, 3),
        finding("broken-links", "fix-now", { offenders: [] }),
      ],
      "en",
    );
    expect(selected.map((f) => [f.ruleId, f.priority])).toEqual([
      ["title-missing-or-weak", "fix-now"],
      ["broken-links", "fix-now"],
      ["headings-weak", "watch"],
      ["structured-data-missing", "watch"],
    ]);
    expect(selected[3]).toMatchObject({ affectedCount: 3 });
    expect(selected[0]!.title).not.toContain("auditRules.");
  });

  it("marks site-wide findings as open problems and passes the host-variant evidence", () => {
    const hostVariants = {
      canonicalOrigin: "https://example.com",
      variants: [
        { url: "https://example.com/", scheme: "https", host: "apex", status: 200, finalUrl: "https://example.com/", outcome: "canonical" },
        { url: "http://www.example.com/", scheme: "http", host: "www", status: 200, finalUrl: "http://www.example.com/", outcome: "not-canonical" },
        { url: "https://www.example.com/", scheme: "https", host: "www", status: null, finalUrl: null, outcome: "not-canonical" },
        { url: "http://example.com/", scheme: "http", host: "apex", status: 200, finalUrl: "not a url", outcome: "not-canonical" },
        { url: "https://x/", scheme: "https", host: "www", status: 200, finalUrl: "https://x/", outcome: "not-canonical" },
        { url: "https://y/", scheme: "https", host: "www", status: 200, finalUrl: "https://y/", outcome: "not-canonical" },
        { bogus: true },
        null,
      ],
    };
    const selected = selectSummaryFindings(
      [
        finding("https-canonicalization", "watch", { hostVariants }, 0),
        finding("headings-weak", "watch", null, 2),
      ],
      "en",
    );
    expect(selected[0]).toMatchObject({
      ruleId: "https-canonicalization",
      affectedCount: 0,
      siteWide: true,
    });
    const evidence = selected[0]!.evidence!;
    expect(evidence).toHaveLength(MAX_SUMMARY_EVIDENCE_LINES);
    expect(evidence[0]).toBe(
      "the http www address answers with status 200 and ends on www.example.com over http instead of example.com over https",
    );
    expect(evidence[1]).toBe(
      "the https www address answers with no status and ends on no answer instead of example.com over https",
    );
    expect(evidence[2]).toContain("the http non-www address answers with status 200 and ends on an unreadable address");
    // The AI input sanitizer strips links, so evidence never carries a raw URL.
    expect(evidence.join(" ")).not.toMatch(/https?:\/\//);
    expect(selected[1]).toMatchObject({ affectedCount: 2 });
    expect(selected[1]).not.toHaveProperty("siteWide");
    expect(selected[1]).not.toHaveProperty("evidence");
  });

  it("carries no evidence for malformed or absent host-variant meta", () => {
    for (const meta of [
      null,
      { hostVariants: null },
      { hostVariants: { canonicalOrigin: 1, variants: [] } },
      { hostVariants: { canonicalOrigin: "https://example.com", variants: "x" } },
    ]) {
      expect(
        summaryEvidenceFor(finding("https-canonicalization", "watch", meta as Record<string, unknown> | null, 0)),
      ).toEqual([]);
    }
    expect(summaryEvidenceFor(finding("headings-weak", "watch", { hostVariants: {} }, 0))).toEqual([]);
  });

  it("bounds the selection to the profile ceiling, keeping fix-now first", () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => finding(`watch-${i}`, "watch")),
      ...Array.from({ length: 3 }, (_, i) => finding(`fix-${i}`, "fix-now")),
    ];
    const selected = selectSummaryFindings(many, "en");
    expect(selected).toHaveLength(MAX_SUMMARY_FINDINGS);
    expect(selected.slice(0, 3).every((f) => f.priority === "fix-now")).toBe(true);
    expect(selected.slice(3).every((f) => f.priority === "watch")).toBe(true);
  });

  it("feeds watch findings to the model when the audit has no fix-now findings", async () => {
    const ids = await seedOne({
      findings: [
        finding("headings-weak", "watch"),
        finding("structured-data-missing", "watch", null, 170),
        finding("title-missing-or-weak", "passed"),
      ],
    });
    const summarize = vi.fn().mockResolvedValue({
      summary: "Nothing is urgent; consider adding headings.",
      truncated: false,
      model: "model-1",
    });
    const result = await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }) },
    );
    expect(result.text).toBe("Nothing is urgent; consider adding headings.");
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]![0].findings).toEqual([
      expect.objectContaining({ ruleId: "headings-weak", priority: "watch" }),
      expect.objectContaining({ ruleId: "structured-data-missing", priority: "watch", affectedCount: 170 }),
    ]);
  });

  it("answers deterministically without enqueueing when nothing is actionable", async () => {
    const ids = await seedOne({
      findings: [
        finding("title-missing-or-weak", "passed"),
        finding("core-web-vitals-poor", "watch", { insufficientData: true }),
      ],
    });
    const add = vi.fn();
    const preflightSummarize = vi.fn();
    const at = new Date("2026-09-27T12:00:00.000Z");
    const state = await startAuditSummary(
      { ...ids, locale: "fr" },
      {
        db: getTestDb(),
        provider: fakeProvider({ preflightSummarize }),
        queue: fakeQueue(add),
        now: () => at,
      },
    );
    expect(state).toMatchObject({
      status: "succeeded",
      requestedLocale: "fr",
      availableLocales: ["fr"],
      aiSummary: {
        locale: "fr",
        model: NOTHING_URGENT_SUMMARY_MODEL,
        truncated: false,
        createdAt: at.toISOString(),
      },
    });
    expect(state.aiSummary?.text).toContain("example.com");
    expect(state.aiSummary?.text).toMatch(/urgent/u);
    expect(add).not.toHaveBeenCalled();
    expect(preflightSummarize).not.toHaveBeenCalled();
    // Persisted: a later poll reads the same answer.
    const polled = await getAuditSummaryState({ ...ids, locale: "fr" });
    expect(polled).toMatchObject({ status: "succeeded", aiSummary: { model: NOTHING_URGENT_SUMMARY_MODEL } });
  });

  it("localizes the deterministic answer and uses the wall clock by default", async () => {
    const ids = await seedOne({ findings: [] });
    const state = await startAuditSummary(
      { ...ids, locale: "de" },
      { db: getTestDb(), provider: fakeProvider(), queue: fakeQueue() },
    );
    expect(state.status).toBe("succeeded");
    expect(state.aiSummary?.text).toContain("Nichts Dringendes");
  });

  it("returns the current state when a concurrent claim wins the deterministic write", async () => {
    const ids = await seedOne({ findings: [] });
    vi.spyOn(ReportSnapshot, "findOneAndUpdate").mockResolvedValueOnce(null);
    const state = await startAuditSummary(
      { ...ids, locale: "en" },
      { db: getTestDb(), provider: fakeProvider(), queue: fakeQueue() },
    );
    expect(state).toMatchObject({ status: "idle", aiSummary: null });
  });

  it("never calls the model for a queued job whose audit has nothing actionable", async () => {
    const ids = await seedOne({ findings: [finding("title-missing-or-weak", "passed")] });
    const summarize = vi.fn();
    const at = new Date("2026-09-27T13:00:00.000Z");
    const withClock = await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }), now: () => at },
    );
    expect(withClock).toMatchObject({
      locale: "en",
      model: NOTHING_URGENT_SUMMARY_MODEL,
      createdAt: at.toISOString(),
    });
    const wallClock = await generateAuditSummary(
      { ...ids, locale: "ar", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }) },
    );
    expect(wallClock).toMatchObject({ locale: "ar", model: NOTHING_URGENT_SUMMARY_MODEL });
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe("summary respects the user's finding decisions", () => {
  const TWO_FIX_NOW: SeedFinding[] = [
    { ruleId: "broken-internal-links", bucket: "fix-now", severity: "critical", affectedUrls: ["https://example.com/a"], meta: null },
    { ruleId: "title-missing-or-weak", bucket: "fix-now", severity: "critical", affectedUrls: ["https://example.com/b"], meta: null },
    { ruleId: "headings-weak", bucket: "watch", severity: "warning", affectedUrls: [], meta: null },
    { ruleId: "https-canonicalization", bucket: "watch", severity: "warning", affectedUrls: [], meta: null },
  ];

  async function decide(
    ids: { accountId: string; siteId: string; runId: string },
    ruleId: string,
    newState: ActionState,
    options: { legacy?: boolean } = {},
  ): Promise<void> {
    const base = { accountId: ids.accountId, siteId: ids.siteId, sourceType: "audit_finding" as const, sourceId: ruleId };
    const actionId = options.legacy
      ? legacyAuditActionId({ ...base, sourceRef: `${ids.runId}:${ruleId}` })!
      : hashActionId(base);
    await appendActionEvent(getTestDb(), {
      accountId: ids.accountId,
      siteId: ids.siteId,
      actionId,
      sourceType: "audit_finding",
      sourceIdRef: ruleId,
      priorState: null,
      newState,
      eventKind: newState === "dismissed" ? "dismiss" : newState === "completed" ? "complete" : "plan",
      actorUserId: ids.accountId,
      note: null,
      idempotencyKey: `${ruleId}-${newState}-${options.legacy ? "legacy" : "current"}`,
    });
  }

  it("the model only sees open or planned findings; legacy-id decisions count too", async () => {
    const ids = await seedOne({ findings: TWO_FIX_NOW });
    await decide(ids, "broken-internal-links", "dismissed");
    await decide(ids, "title-missing-or-weak", "completed", { legacy: true });
    await decide(ids, "headings-weak", "planned");
    const summarize = vi.fn<SummaryProvider["summarize"]>().mockResolvedValue({
      summary: "Only the open work.",
      truncated: false,
      model: "test-model",
    });
    await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }), db: getTestDb() },
    );
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]![0].findings.map((finding) => finding.ruleId)).toEqual([
      "headings-weak",
      "https-canonicalization",
    ]);
  });

  it("a reopened finding is summarized again (the latest decision wins)", async () => {
    const ids = await seedOne({ findings: TWO_FIX_NOW.slice(0, 1) });
    await decide(ids, "broken-internal-links", "dismissed");
    await decide(ids, "broken-internal-links", "open");
    const summarize = vi.fn<SummaryProvider["summarize"]>().mockResolvedValue({
      summary: "Fix links.",
      truncated: false,
      model: "test-model",
    });
    await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }), db: getTestDb() },
    );
    expect(summarize.mock.calls[0]![0].findings.map((finding) => finding.ruleId)).toEqual([
      "broken-internal-links",
    ]);
  });

  it("when every actionable finding is resolved, start answers deterministically", async () => {
    const ids = await seedOne({ findings: TWO_FIX_NOW.slice(0, 2) });
    await decide(ids, "broken-internal-links", "dismissed");
    await decide(ids, "title-missing-or-weak", "completed");
    const add = vi.fn().mockResolvedValue({ id: "summary-job" });
    const state = await startAuditSummary(
      { ...ids, locale: "en" },
      { db: getTestDb(), provider: fakeProvider(), queue: fakeQueue(add) },
    );
    expect(state.status).toBe("succeeded");
    expect(state.aiSummary?.model).toBe(NOTHING_URGENT_SUMMARY_MODEL);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("summary freshness follows triage and evidence", () => {
  const FINDINGS: SeedFinding[] = [
    { ruleId: "broken-internal-links", bucket: "fix-now", severity: "critical", affectedUrls: ["https://example.com/a"], meta: null },
    { ruleId: "structured-data-missing", bucket: "watch", severity: "warning", affectedUrls: ["https://example.com/b"], meta: null },
    { ruleId: "title-missing-or-weak", bucket: "watch", severity: "warning", affectedUrls: ["https://example.com/c"], meta: null },
  ];
  const WRITTEN_AT = new Date("2026-08-01T00:00:00.000Z");

  async function storeSummary(
    runId: string,
    summary: { basisRuleIds?: string[] } = {},
  ): Promise<void> {
    await ReportSnapshot.updateOne(
      { runId },
      {
        $set: {
          "aiSummaryVariantsByLocale.en": {
            text: "Fix the broken links, structured data and page titles.",
            locale: "en",
            model: "test-model",
            truncated: false,
            createdAt: WRITTEN_AT,
            ...summary,
          },
        },
      },
    );
  }

  async function decide(
    ids: { accountId: string; siteId: string },
    ruleId: string,
    newState: "dismissed" | "completed" | "open",
    createdAt = new Date(),
  ): Promise<void> {
    const actionId = hashActionId({
      accountId: ids.accountId,
      siteId: ids.siteId,
      sourceType: "audit_finding",
      sourceId: ruleId,
    });
    await appendActionEvent(getTestDb(), {
      accountId: ids.accountId,
      siteId: ids.siteId,
      actionId,
      sourceType: "audit_finding",
      sourceIdRef: ruleId,
      priorState: null,
      newState,
      eventKind: newState === "dismissed" ? "dismiss" : newState === "completed" ? "complete" : "reopen",
      actorUserId: ids.accountId,
      note: null,
      idempotencyKey: `${ruleId}-${newState}-${createdAt.getTime()}`,
    });
    // Backdate/forward-date the stored event so ordering is explicit.
    const { actionEvents } = await import("../../db/schema/action-events.js");
    const { eq } = await import("drizzle-orm");
    await getTestDb()
      .update(actionEvents)
      .set({ createdAt })
      .where(eq(actionEvents.idempotencyKey, `${ruleId}-${newState}-${createdAt.getTime()}`));
  }

  it("records the findings a generated summary was built from as its evidence references", async () => {
    const ids = await seedOne({ findings: FINDINGS });
    await decide(ids, "broken-internal-links", "dismissed");
    const summarize = vi.fn<SummaryProvider["summarize"]>().mockResolvedValue({
      summary: "Structured data and titles.",
      truncated: false,
      model: "test-model",
    });
    const generated = await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }), db: getTestDb() },
    );
    // Dismissed work is neither sent to the model nor cited as evidence.
    expect(generated.basisRuleIds).toEqual(["structured-data-missing", "title-missing-or-weak"]);
    expect(summarize.mock.calls[0]![0].findings.map((f) => f.ruleId)).toEqual(generated.basisRuleIds);
  });

  it("flags a stored summary stale once a finding it covers is dismissed", async () => {
    const ids = await seedOne({ findings: FINDINGS });
    await storeSummary(ids.runId, {
      basisRuleIds: ["broken-internal-links", "structured-data-missing", "title-missing-or-weak"],
    });
    const fresh = await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() });
    expect(fresh.freshness).toEqual({
      stale: false,
      reason: null,
      evidenceRuleIds: ["broken-internal-links", "structured-data-missing", "title-missing-or-weak"],
      changedRuleIds: [],
    });

    await decide(ids, "broken-internal-links", "dismissed");
    const stale = await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() });
    expect(stale.freshness).toMatchObject({
      stale: true,
      reason: "triage_changed",
      changedRuleIds: ["broken-internal-links"],
    });
    // The text is retained; only the flag changes.
    expect(stale.aiSummary?.text).toContain("broken links");
  });

  it("flags a summary stale when a completed finding is reopened and covers a rule it never saw", async () => {
    const ids = await seedOne({ findings: FINDINGS });
    // The audit finished before the fix was claimed, so it disproves nothing.
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { finishedAt: new Date("2026-06-01T00:00:00.000Z") } });
    await decide(ids, "structured-data-missing", "completed", new Date("2026-07-01T00:00:00.000Z"));
    await storeSummary(ids.runId, { basisRuleIds: ["broken-internal-links", "title-missing-or-weak"] });
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toMatchObject({
      stale: false,
    });
    await decide(ids, "structured-data-missing", "open", new Date("2026-08-15T00:00:00.000Z"));
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toMatchObject({
      stale: true,
      changedRuleIds: ["structured-data-missing"],
    });
  });

  it("flags a summary that cites a check no current bucket contains (page titles absent from every bucket)", async () => {
    const ids = await seedOne({
      findings: [
        { ruleId: "title-missing-or-weak", bucket: "passed", severity: "info", affectedUrls: [], meta: null },
        FINDINGS[0]!,
      ],
    });
    await storeSummary(ids.runId, {
      basisRuleIds: ["broken-internal-links", "title-missing-or-weak"],
    });
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toMatchObject({
      stale: true,
      changedRuleIds: ["title-missing-or-weak"],
    });
  });

  it("judges older summaries without a recorded basis by decisions made after they were written", async () => {
    const ids = await seedOne({ findings: FINDINGS });
    await storeSummary(ids.runId);
    // A decision made BEFORE the summary was written is already reflected in it.
    await decide(ids, "broken-internal-links", "dismissed", new Date("2026-07-15T00:00:00.000Z"));
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toEqual({
      stale: false,
      reason: null,
      evidenceRuleIds: null,
      changedRuleIds: [],
    });
    await decide(ids, "title-missing-or-weak", "completed", new Date("2026-08-20T00:00:00.000Z"));
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toMatchObject({
      stale: true,
      evidenceRuleIds: null,
      changedRuleIds: ["title-missing-or-weak"],
    });
  });

  it("has no freshness without a stored summary or without a decisions store", async () => {
    const ids = await seedOne({ findings: FINDINGS });
    expect(await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).not.toHaveProperty("freshness");
    await storeSummary(ids.runId, { basisRuleIds: [] });
    expect(await getAuditSummaryState({ ...ids, locale: "en" })).not.toHaveProperty("freshness");
  });

  it("a deterministic nothing-to-fix summary records an empty basis and goes stale when work reopens", async () => {
    const ids = await seedOne({ findings: FINDINGS.slice(0, 1) });
    await decide(ids, "broken-internal-links", "dismissed", new Date("2026-07-01T00:00:00.000Z"));
    const state = await startAuditSummary(
      { ...ids, locale: "en" },
      { db: getTestDb(), provider: fakeProvider(), queue: fakeQueue() },
    );
    expect(state.aiSummary?.basisRuleIds).toEqual([]);
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness?.stale).toBe(false);
    await decide(ids, "broken-internal-links", "open", new Date(Date.now() + 60_000));
    expect((await getAuditSummaryState({ ...ids, locale: "en" }, { db: getTestDb() })).freshness).toMatchObject({
      stale: true,
      changedRuleIds: ["broken-internal-links"],
    });
  });

  it("summarizes a completed finding again when a newer audit still reports it", async () => {
    const ids = await seedOne({ findings: FINDINGS.slice(0, 1) });
    await AuditRun.updateOne({ _id: ids.runId }, { $set: { finishedAt: new Date("2026-08-20T00:00:00.000Z") } });
    await decide(ids, "broken-internal-links", "completed", new Date("2026-08-10T00:00:00.000Z"));
    const summarize = vi.fn<SummaryProvider["summarize"]>().mockResolvedValue({
      summary: "Links are still broken.",
      truncated: false,
      model: "test-model",
    });
    const generated = await generateAuditSummary(
      { ...ids, locale: "en", generationId: new mongoose.Types.ObjectId().toHexString() },
      { provider: fakeProvider({ summarize }), db: getTestDb() },
    );
    expect(generated.basisRuleIds).toEqual(["broken-internal-links"]);
  });

  it("evaluateSummaryFreshness compares bases by rule and legacy summaries by decision time", () => {
    const decision = (state: "open" | "dismissed" | "planned", regressed: boolean, decidedAt: string) => ({
      state,
      regressed,
      decidedAt: new Date(decidedAt),
      actorUserId: "user-1",
      ordinal: 1,
    });
    expect(
      evaluateSummaryFreshness({ createdAt: WRITTEN_AT.toISOString(), basisRuleIds: ["a", "b"] }, ["b", "c"], new Map()),
    ).toEqual({ stale: true, reason: "triage_changed", evidenceRuleIds: ["a", "b"], changedRuleIds: ["a", "c"] });
    const legacy = (decisions: Map<string, ReturnType<typeof decision>>) =>
      evaluateSummaryFreshness({ createdAt: WRITTEN_AT.toISOString() }, [], decisions);
    // Planned work, or a regression after the summary, only counts when it changes resolved status.
    expect(legacy(new Map([["a", decision("planned", false, "2026-09-01T00:00:00.000Z")]])).stale).toBe(false);
    expect(legacy(new Map([["a", decision("open", true, "2026-09-01T00:00:00.000Z")]])).stale).toBe(true);
    expect(legacy(new Map([["a", decision("dismissed", false, "2026-07-01T00:00:00.000Z")]])).stale).toBe(false);
  });
});

describe("structured summaries, validation and regeneration", () => {
  const genId = () => new mongoose.Types.ObjectId().toHexString();
  const item = (ruleId: string, what = "The titles are weak.") => ({
    ruleId,
    what,
    why: "Searchers read titles first.",
    firstStep: "Rewrite the title on the affected page.",
  });

  it("stores an accepted structured summary with where-to-act areas and dismissed findings in its input", async () => {
    const ids = await seedOne();
    await appendActionEvent(getTestDb(), {
      accountId: ids.accountId,
      siteId: ids.siteId,
      actionId: hashActionId({ accountId: ids.accountId, siteId: ids.siteId, sourceType: "audit_finding", sourceId: "headings-weak" }),
      sourceType: "audit_finding",
      sourceIdRef: "headings-weak",
      priorState: null,
      newState: "dismissed",
      eventKind: "dismiss",
      actorUserId: ids.accountId,
      note: null,
      idempotencyKey: "headings-dismissed",
    });
    const summarize = vi.fn().mockResolvedValue({
      summary: "composed",
      structured: { status: "1 finding to fix now.", items: [item("title-missing-or-weak")] },
      truncated: false,
      model: "model-s",
    });
    const result = await generateAuditSummary(
      { ...ids, locale: "en", generationId: genId() },
      { provider: fakeProvider({ summarize }), db: getTestDb() },
    );
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(summarize.mock.calls[0]?.[0]).toMatchObject({
      findings: [expect.objectContaining({ ruleId: "title-missing-or-weak" })],
      dismissed: [expect.objectContaining({ ruleId: "headings-weak", affectedCount: 0 })],
    });
    expect(result).toMatchObject({
      text: "composed",
      model: "model-s",
      basisRuleIds: ["title-missing-or-weak"],
      structured: {
        status: "1 finding to fix now.",
        items: [{ ruleId: "title-missing-or-weak", whereToAct: "pages" }],
      },
    });
  });

  it("regenerates once after a rejected output and keeps the accepted one", async () => {
    const ids = await seedOne();
    const info = vi.fn();
    const summarize = vi
      .fn()
      .mockResolvedValueOnce({
        summary: "bad",
        structured: { status: "AI overviews frequently quote 9 pages.", items: [] },
        truncated: false,
        model: "model-r",
      })
      .mockResolvedValueOnce({ summary: "Fix the title on 1 page.", truncated: false, model: "model-r" });
    const result = await generateAuditSummary(
      { ...ids, locale: "en", generationId: genId() },
      { provider: fakeProvider({ summarize }), logger: { info } },
    );
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Fix the title on 1 page.");
    expect(result).not.toHaveProperty("structured");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, issues: expect.arrayContaining(["unknown_number", "unsupported_claim"]) }),
      "ai summary rejected by validator",
    );
    // The rejection log never carries the text.
    expect(JSON.stringify(info.mock.calls)).not.toContain("frequently");
  });

  it("falls back to the rule copy when every generation is rejected", async () => {
    const ids = await seedOne();
    const archive = vi.fn().mockResolvedValue(undefined);
    const summarize = vi.fn().mockResolvedValue({
      summary: "x",
      structured: { status: "Visit rival.example now.", items: [item("made-up")] },
      truncated: true,
      model: "model-f",
    });
    const result = await generateAuditSummary(
      { ...ids, locale: "de", generationId: genId() },
      { provider: fakeProvider({ summarize }), archiveVendorResponse: archive, logger: { info: vi.fn() } },
    );
    expect(summarize).toHaveBeenCalledTimes(SUMMARY_MAX_GENERATIONS);
    expect(result.model).toBe(DETERMINISTIC_SUMMARY_MODEL);
    expect(result.truncated).toBe(false);
    expect(result.structured?.status).toContain("example.com");
    expect(result.structured?.items.map((i) => [i.ruleId, i.whereToAct])).toEqual([
      ["title-missing-or-weak", "pages"],
      ["headings-weak", "pages"],
    ]);
    expect(result.text.startsWith(result.structured!.status)).toBe(true);
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ attempts: 2, accepted: false, model: DETERMINISTIC_SUMMARY_MODEL }) }),
    );
  });

  it("builds the fallback from the top three findings with localized status", () => {
    const fallback = fallbackStructuredSummary({
      siteDomain: "example.com",
      locale: "fr",
      findings: ["a", "b", "c", "d"].map((ruleId, i) => ({
        ruleId,
        title: `T${ruleId}`,
        why: "W",
        fix: "F",
        affectedCount: i,
        priority: i === 0 ? ("fix-now" as const) : ("watch" as const),
      })),
    });
    expect(fallback.status).toContain("1 à corriger");
    expect(fallback.items.map((i) => i.ruleId)).toEqual(["a", "b", "c"]);
  });

  it("passes each finding's comparison status to the model", () => {
    const selected = selectSummaryFindings(
      [
        { ruleId: "title-missing-or-weak", bucket: "fix-now", affectedUrls: ["a"], comparisonStatus: "regressed" },
        { ruleId: "headings-weak", bucket: "watch", affectedUrls: [] },
      ],
      "en",
    );
    expect(selected[0]).toMatchObject({ comparisonStatus: "regressed" });
    expect(selected[1]).not.toHaveProperty("comparisonStatus");
  });

  it("changes the input hash when dismissals or decisions change", () => {
    const findings = [{ ruleId: "a", priority: "fix-now" as const, affectedCount: 2 }];
    const base = summaryInputHash({ findings, dismissed: [], decisions: [] });
    expect(summaryInputHash({ findings, dismissed: [], decisions: [] })).toBe(base);
    expect(summaryInputHash({ findings, dismissed: [{ ruleId: "b", affectedCount: 1 }], decisions: [] })).not.toBe(base);
    expect(summaryInputHash({ findings, dismissed: [], decisions: [["a", "planned", false]] })).not.toBe(base);
    expect(summaryInputHash({ findings: [{ ruleId: "a", affectedCount: 2 }], dismissed: [], decisions: [] })).not.toBe(base);
  });

  it("is stale when the stored input hash differs, fresh when it matches", () => {
    const summary = { createdAt: "2026-10-01T00:00:00.000Z", basisRuleIds: ["a"], inputHash: "h1" };
    expect(evaluateSummaryFreshness(summary, ["a"], new Map(), "h1")).toMatchObject({ stale: false, reason: null });
    expect(evaluateSummaryFreshness(summary, ["a"], new Map(), "h2")).toMatchObject({ stale: true, reason: "triage_changed", changedRuleIds: [] });
  });
});
