/** Summary job progress reads and failure codes. */
import type { Job } from "bullmq";
import mongoose, { type Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryProvider } from "../../shared/providers/index.js";
import { VendorQuotaError, VendorTimeoutError } from "../../shared/providers/errors.js";
import { clearCollections, startMemoryMongo, stopMemoryMongo } from "../../shared/testing/mongo.js";
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from "../../shared/testing/postgres.js";
import { Site } from "../sites/index.js";
import { AuditRun } from "./audit-run.model.js";
import { ReportSnapshot } from "./report-snapshot.model.js";
import { auditSummaryFailureCode, auditSummaryProcessorTestables, createAuditSummaryProcessor, onAuditSummaryJobExhausted, } from "./summary.processor.js";
import { selectAuditSummaryProgress } from "./summary.selection.js";
import { getAuditSummaryProgress } from "./summary.service.js";

const provider = (summarize: SummaryProvider["summarize"]): SummaryProvider => ({
  summarize,
  generatePrompts: async () => ({ prompts: [], model: "stub" }),
});
const jobFor = (data: unknown): Job => ({ data, name: "audit-summary" }) as Job;

async function seed(status: "queued" | "running" = "queued") {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({ accountId, url: "https://example.com", domain: "example.com", displayName: "Example" });
  const run = await AuditRun.create({ accountId, siteId: site._id, pageCap: 100, status: "succeeded" });
  const generationId = new mongoose.Types.ObjectId().toHexString();
  await ReportSnapshot.create({
    runId: run._id,
    siteId: site._id,
    accountId,
    counts: { fixNow: 1, watch: 0, passed: 0 },
    findings: [
      { ruleId: "title-missing-or-weak", bucket: "fix-now", severity: "critical", affectedUrls: ["https://example.com/a"], meta: null },
    ],
    aiSummaryJobsByLocale: {
      en: { generationId, locale: "en", status, requestedAt: new Date("2026-07-16T09:00:00.000Z") },
    },
  });
  return {
    accountId: (accountId as Types.ObjectId).toHexString(),
    runId: (run._id as Types.ObjectId).toHexString(),
    generationId,
    locale: "en" as const,
  };
}

async function storedJob(runId: string) {
  return (await ReportSnapshot.findOne({ runId }))?.toObject().aiSummaryJobsByLocale?.en;
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
  vi.restoreAllMocks();
});

describe("auditSummaryFailureCode", () => {
  it("separates timeouts, provider faults and our own errors", () => {
    expect(auditSummaryFailureCode(new VendorTimeoutError("slow", { provider: "p", operation: "o" }))).toBe("timeout");
    expect(auditSummaryFailureCode(new VendorQuotaError("busy", { provider: "p", operation: "o", retryAfterSeconds: 1 }))).toBe("provider_unavailable");
    expect(auditSummaryFailureCode(new Error("bug"))).toBe("internal");
    expect(auditSummaryFailureCode("odd")).toBe("internal");
  });
});

describe("summary processor stages and failures", () => {
  it("records each stage before the provider call", async () => {
    const payload = await seed();
    const seen: unknown[] = [];
    const process = createAuditSummaryProcessor({
      db: getTestDb(),
      provider: provider(vi.fn().mockImplementation(async () => {
        seen.push((await storedJob(payload.runId))?.stage);
        return { summary: "Done.", truncated: false, model: "m" };
      })),
    });
    await expect(process(jobFor(payload))).resolves.toBe("succeeded");
    expect(seen).toEqual(["writing_summary"]);
    expect(await storedJob(payload.runId)).toMatchObject({ status: "succeeded" });
  });

  it("fails with a code, and a retried job changes nothing", async () => {
    const payload = await seed();
    const failure = new VendorTimeoutError("slow", { provider: "ai-generation", operation: "summarize" });
    const process = createAuditSummaryProcessor({ db: getTestDb(), provider: provider(vi.fn().mockRejectedValue(failure)) });
    await expect(process(jobFor(payload))).rejects.toBe(failure);
    expect(await storedJob(payload.runId)).toMatchObject({ status: "failed", failureCode: "timeout" });
    await expect(process(jobFor(payload))).resolves.toBe("stale");
    await onAuditSummaryJobExhausted(jobFor(payload), failure);
    expect(await storedJob(payload.runId)).toMatchObject({ status: "failed", failureCode: "timeout" });
  });

  it("marks failed with an internal code when no decisions store is wired", async () => {
    const payload = await seed();
    const process = createAuditSummaryProcessor({ provider: provider(vi.fn().mockRejectedValue(new Error("bug"))) });
    await expect(process(jobFor(payload))).rejects.toThrow("bug");
    expect(await storedJob(payload.runId)).toMatchObject({ status: "failed", failureCode: "internal" });
  });

  it("fails a job the processor never reached, and ignores a malformed payload", async () => {
    const payload = await seed("running");
    await onAuditSummaryJobExhausted(jobFor({ nonsense: true }), new Error("lease refused"));
    expect(await storedJob(payload.runId)).toMatchObject({ status: "running" });
    await onAuditSummaryJobExhausted(jobFor(payload), new Error("lease refused"));
    expect(await storedJob(payload.runId)).toMatchObject({ status: "failed", failureCode: "internal" });
    await auditSummaryProcessorTestables.failSummaryJob(payload, "timeout", new Date());
    expect(await storedJob(payload.runId)).toMatchObject({ status: "failed", failureCode: "internal" });
  });
});

describe("summary progress reads", () => {
  const requestedAt = new Date("2026-07-16T09:00:00.000Z");
  const at = (seconds: number) => new Date(requestedAt.getTime() + seconds * 1000);
  const snapshot = (job: Record<string, unknown> | null, legacy: Record<string, unknown> | null = null) => ({
    aiSummaryJobsByLocale: job ? { en: { generationId: "g", locale: "en", requestedAt, ...job } } : null,
    aiSummaryJob: legacy,
  });

  it("is null when this locale never had a job or the job is unreadable", () => {
    expect(selectAuditSummaryProgress(snapshot(null), "en", at(5))).toBeNull();
    expect(selectAuditSummaryProgress(snapshot({ status: "queued", requestedAt: "nope" }), "en", at(5))).toBeNull();
    expect(selectAuditSummaryProgress(snapshot({ status: "queued", locale: "fr" }), "en", at(5))).toBeNull();
  });

  it("reports queued and running stages with elapsed time on the server clock", () => {
    expect(selectAuditSummaryProgress(snapshot({ status: "queued" }), "en", at(4))).toEqual({
      stage: "queued",
      requestedAt: requestedAt.toISOString(),
      startedAt: null,
      finishedAt: null,
      elapsedMs: 4000,
      failureCode: null,
    });
    expect(selectAuditSummaryProgress(snapshot({ status: "running", startedAt: at(1) }), "en", at(9))).toMatchObject({
      stage: "reading_findings",
      startedAt: at(1).toISOString(),
      elapsedMs: 9000,
    });
    expect(selectAuditSummaryProgress(snapshot({ status: "running", stage: "checking_priorities" }), "en", at(9))?.stage).toBe("checking_priorities");
    expect(selectAuditSummaryProgress(snapshot({ status: "queued" }), "en", at(-3))?.elapsedMs).toBe(0);
  });

  it("measures a finished job to its end and explains a failure", () => {
    expect(selectAuditSummaryProgress(snapshot({ status: "succeeded", finishedAt: at(35) }), "en", at(400))).toMatchObject({
      stage: null,
      elapsedMs: 35000,
      failureCode: null,
    });
    expect(selectAuditSummaryProgress(snapshot({ status: "failed", finishedAt: at(12), failureCode: "timeout" }), "en", at(99))).toMatchObject({
      failureCode: "timeout",
      elapsedMs: 12000,
    });
    expect(selectAuditSummaryProgress(snapshot({ status: "failed", failureCode: "weird" }), "en", at(1))).toMatchObject({ failureCode: "internal" });
  });

  it("reads a legacy single job in its own locale", () => {
    expect(selectAuditSummaryProgress(snapshot(null, { generationId: "g", locale: "en", status: "running", requestedAt }), "en", at(2))).toMatchObject({
      stage: "reading_findings",
      elapsedMs: 2000,
    });
  });

  it("proves ownership before reading progress", async () => {
    const payload = await seed();
    await expect(getAuditSummaryProgress({ ...payload, accountId: new mongoose.Types.ObjectId().toHexString() })).rejects.toMatchObject({ status: 404 });
    expect((await getAuditSummaryProgress(payload))?.stage).toBe("queued");
  });
});
