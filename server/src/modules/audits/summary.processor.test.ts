import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import mongoose, { type Types } from "mongoose";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SummaryProvider } from "../../shared/providers/index.js";
import { VendorUnavailableError } from "../../shared/providers/errors.js";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "../../shared/testing/mongo.js";
import { Site } from "../sites/index.js";
import { AuditRun } from "./audit-run.model.js";
import { ReportSnapshot } from "./report-snapshot.model.js";
import {
  auditSummaryProcessorTestables,
  createAuditSummaryProcessor,
  onAuditSummaryJobExhausted,
} from "./summary.processor.js";

const stubGeneratePrompts = async () => ({ prompts: [], model: "stub" });

function provider(summarize: SummaryProvider["summarize"]): SummaryProvider {
  return { summarize, generatePrompts: stubGeneratePrompts };
}

function jobFor(data: unknown): Job {
  return { data, name: "audit-summary" } as Job;
}

async function seedJob(
  status: "queued" | "running" | "succeeded" | "failed" = "queued",
) {
  const accountId = new mongoose.Types.ObjectId();
  const site = await Site.create({
    accountId,
    url: "https://example.com",
    domain: "example.com",
    displayName: "Example",
  });
  const run = await AuditRun.create({
    accountId,
    siteId: site._id,
    pageCap: 100,
    status: "succeeded",
  });
  const generationId = new mongoose.Types.ObjectId().toHexString();
  await ReportSnapshot.create({
    runId: run._id,
    siteId: site._id,
    accountId,
    counts: { fixNow: 1, watch: 0, passed: 0 },
    findings: [
      {
        ruleId: "title-missing-or-weak",
        bucket: "fix-now",
        severity: "critical",
        affectedUrls: ["https://example.com/a"],
        meta: null,
      },
    ],
    aiSummaryJobsByLocale: {
      en: {
        generationId,
        locale: "en",
        status,
        requestedAt: new Date("2026-07-16T09:00:00.000Z"),
        ...(status !== "queued"
          ? { startedAt: new Date("2026-07-16T09:00:01.000Z") }
          : {}),
        ...(["succeeded", "failed"].includes(status)
          ? { finishedAt: new Date("2026-07-16T09:00:02.000Z") }
          : {}),
      },
    },
  });
  return {
    accountId: (accountId as Types.ObjectId).toHexString(),
    runId: (run._id as Types.ObjectId).toHexString(),
    generationId,
    locale: "en" as const,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  vi.restoreAllMocks();
});

describe("createAuditSummaryProcessor", () => {
  it("rejects malformed payloads as unrecoverable", async () => {
    const process = createAuditSummaryProcessor({ provider: null });
    await expect(process(jobFor({ nope: true }))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("returns stale when the snapshot or its exact generation disappears during resolution", async () => {
    const identity = {
      accountId: new mongoose.Types.ObjectId().toHexString(),
      runId: new mongoose.Types.ObjectId().toHexString(),
      generationId: new mongoose.Types.ObjectId().toHexString(),
      locale: "en" as const,
    };
    const process = createAuditSummaryProcessor({ provider: null });
    await expect(process(jobFor(identity))).resolves.toBe("stale");

    const snapshot = {
      aiSummaryJobsByLocale: {
        en: {
          generationId: identity.generationId,
          locale: "en",
          status: "queued",
          requestedAt: new Date(),
        },
      },
    };
    vi.spyOn(ReportSnapshot, "findOne")
      .mockResolvedValueOnce({ toObject: () => snapshot } as never)
      .mockResolvedValueOnce(null);
    await expect(process(jobFor(identity))).resolves.toBe("stale");
  });


  it("treats invalid legacy timestamps and lost compatibility claims as stale", async () => {
    const payload = {
      accountId: new mongoose.Types.ObjectId().toHexString(),
      runId: new mongoose.Types.ObjectId().toHexString(),
      generationId: new mongoose.Types.ObjectId().toHexString(),
      locale: "en" as const,
    };
    const invalidTimestamp = {
      aiSummaryJob: {
        generationId: payload.generationId,
        locale: "en",
        status: "queued",
        requestedAt: "not-a-date",
      },
    };
    const process = createAuditSummaryProcessor({ provider: null });
    vi.spyOn(ReportSnapshot, "findOne").mockResolvedValueOnce({
      toObject: () => invalidTimestamp,
    } as never);
    await expect(process(jobFor(payload))).resolves.toBe("stale");

    vi.restoreAllMocks();
    const validLegacy = {
      aiSummaryJob: {
        ...invalidTimestamp.aiSummaryJob,
        requestedAt: new Date(),
      },
    };
    vi.spyOn(ReportSnapshot, "findOne").mockResolvedValueOnce({
      toObject: () => validLegacy,
    } as never);
    vi.spyOn(ReportSnapshot, "updateOne").mockResolvedValueOnce({
      modifiedCount: 0,
    } as never);
    await expect(process(jobFor(payload))).resolves.toBe("stale");
  });

  it("bounds malformed legacy summary locale candidates", () => {
    const generationId = new mongoose.Types.ObjectId().toHexString();
    const base = {
      aiSummaryJob: { generationId, locale: "invalid" },
    };
    const malformed = [
      null,
      "not-an-object",
      { locale: "invalid" },
      { locale: "en", text: 1 },
      { locale: "en", text: "text", model: 1 },
      { locale: "en", text: "text", model: "model", truncated: "no" },
      {
        locale: "en",
        text: "text",
        model: "model",
        truncated: false,
        createdAt: null,
      },
      { locale: "en", text: "text", model: "model", truncated: false },
      {
        locale: "en",
        text: "text",
        model: "model",
        truncated: false,
        createdAt: "not-a-date",
      },
    ];
    for (const aiSummary of malformed) {
      expect(
        auditSummaryProcessorTestables.matchingLocaleCandidates(
          { ...base, aiSummary },
          generationId,
        ),
      ).toEqual([]);
    }
    expect(
      auditSummaryProcessorTestables.matchingLocaleCandidates(
        {
          ...base,
          aiSummary: {
            locale: "en",
            text: "text",
            model: "model",
            truncated: false,
            createdAt: new Date(),
          },
        },
        generationId,
      ),
    ).toEqual(["en"]);
    expect(
      auditSummaryProcessorTestables.matchingLocaleCandidates(
        { ...base, aiSummary: null },
        new mongoose.Types.ObjectId().toHexString(),
      ),
    ).toEqual([]);
  });

  it("no-ops jobs whose generation no longer exists", async () => {
    const payload = await seedJob();
    payload.generationId = new mongoose.Types.ObjectId().toHexString();
    const summarize = vi.fn();
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    await expect(process(jobFor(payload))).resolves.toBe("stale");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("claims queued state, runs once, and persists success", async () => {
    const payload = await seedJob();
    const startedAt = new Date("2026-07-16T10:00:00.000Z");
    const finishedAt = new Date("2026-07-16T10:00:01.000Z");
    const generatedAt = new Date("2026-07-16T10:00:02.000Z");
    const times = [startedAt, generatedAt, finishedAt];
    const archive = vi.fn().mockResolvedValue(undefined);
    const summarize = vi.fn().mockResolvedValue({
      summary: "Done.",
      truncated: false,
      model: "model-1",
    });
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
      archiveVendorResponse: archive,
      now: () => times.shift()!,
    });
    await expect(process(jobFor(payload))).resolves.toBe("succeeded");
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en).toMatchObject({
      status: "succeeded",
      startedAt,
      finishedAt,
    });
    expect(snapshot?.toObject().aiSummaryVariantsByLocale?.en).toMatchObject({
      text: "Done.",
      model: "model-1",
      createdAt: generatedAt,
    });
    expect(archive).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledOnce();
  });

  it("resumes a matching running job", async () => {
    const payload = await seedJob("running");
    const process = createAuditSummaryProcessor({
      provider: provider(async () => ({
        summary: "Resumed.",
        truncated: false,
        model: "m",
      })),
      now: () => new Date("2026-07-16T10:00:00.000Z"),
    });
    await expect(process(jobFor(payload))).resolves.toBe("succeeded");
  });

  it("completes simultaneous different-locale jobs without overwriting either variant", async () => {
    const english = await seedJob();
    const frenchGenerationId = new mongoose.Types.ObjectId().toHexString();
    await ReportSnapshot.updateOne(
      { runId: english.runId },
      {
        $set: {
          "aiSummaryJobsByLocale.fr": {
            generationId: frenchGenerationId,
            locale: "fr",
            status: "queued",
            requestedAt: new Date(),
          },
        },
      },
    );
    const summarize = vi.fn(async (input: { locale: string }) => ({
      summary: `summary-${input.locale}`,
      truncated: false,
      model: `model-${input.locale}`,
    }));
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    await expect(
      Promise.all([
        process(jobFor(english)),
        process(
          jobFor({
            ...english,
            generationId: frenchGenerationId,
            locale: "fr",
          }),
        ),
      ]),
    ).resolves.toEqual(["succeeded", "succeeded"]);
    const variants = (
      await ReportSnapshot.findOne({ runId: english.runId })
    )?.toObject().aiSummaryVariantsByLocale;
    expect(variants?.en?.text).toBe("summary-en");
    expect(variants?.fr?.text).toBe("summary-fr");
  });

  it("no-ops terminal jobs and a queued claim lost to another worker", async () => {
    const terminal = await seedJob("succeeded");
    const summarize = vi.fn();
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    await expect(process(jobFor(terminal))).resolves.toBe("stale");
    await clearCollections();
    const queued = await seedJob("queued");
    vi.spyOn(ReportSnapshot, "findOneAndUpdate").mockResolvedValueOnce(null);
    await expect(process(jobFor(queued))).resolves.toBe("stale");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("marks the durable job failed and rethrows provider failures", async () => {
    const payload = await seedJob();
    const failure = new VendorUnavailableError("down", {
      provider: "ai-generation",
      operation: "summarize",
    });
    const process = createAuditSummaryProcessor({
      provider: provider(vi.fn().mockRejectedValue(failure)),
    });
    await expect(process(jobFor(payload))).rejects.toBe(failure);
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en).toMatchObject({
      status: "failed",
    });
  });

  it("does not let an old completion overwrite a newer generation", async () => {
    const payload = await seedJob();
    const newerGenerationId = new mongoose.Types.ObjectId().toHexString();
    const summarize = vi.fn().mockImplementation(async () => {
      await ReportSnapshot.updateOne(
        { runId: payload.runId },
        {
          $set: {
            "aiSummaryJobsByLocale.en": {
              generationId: newerGenerationId,
              locale: "en",
              status: "queued",
              requestedAt: new Date(),
            },
          },
        },
      );
      return { summary: "Stale result.", truncated: false, model: "m" };
    });
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    await expect(process(jobFor(payload))).resolves.toBe("stale");
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryVariantsByLocale?.en).toBeFalsy();
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en).toMatchObject({
      generationId: newerGenerationId,
    });
  });

  it("marks failed if API/worker provider configuration drifts", async () => {
    const payload = await seedJob();
    const process = createAuditSummaryProcessor({ provider: null });
    await expect(process(jobFor(payload))).rejects.toMatchObject({
      status: 503,
    });
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en).toMatchObject({
      status: "failed",
    });
  });

  it("runs one unambiguous locale-less legacy payload and writes only its locale variant", async () => {
    const payload = await seedJob();
    await ReportSnapshot.updateOne(
      { runId: payload.runId },
      {
        $unset: { aiSummaryJobsByLocale: 1 },
        $set: {
          aiSummaryJob: {
            generationId: payload.generationId,
            locale: "ar",
            status: "queued",
            requestedAt: new Date("2026-08-25T08:00:00.000Z"),
          },
        },
      },
    );
    const summarize = vi.fn().mockResolvedValue({
      summary: "ابدأ بإصلاح العناوين.",
      truncated: false,
      model: "m-ar",
    });
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    const { locale: _locale, ...localeLess } = payload;
    await expect(process(jobFor(localeLess))).resolves.toBe("succeeded");
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryVariantsByLocale?.ar).toMatchObject({
      text: "ابدأ بإصلاح العناوين.",
      locale: "ar",
    });
    expect(snapshot?.toObject().aiSummary).toBeFalsy();
    expect(snapshot?.toObject().aiSummaryJob).toMatchObject({
      status: "queued",
    });
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "ar" }),
    );
  });

  it("dead-letters zero-match locale-less work", async () => {
    const payload = await seedJob();
    await ReportSnapshot.updateOne(
      { runId: payload.runId },
      { $unset: { aiSummaryJobsByLocale: 1, aiSummaryJob: 1, aiSummary: 1 } },
    );
    const summarize = vi.fn();
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    const { locale: _locale, ...localeLess } = payload;
    await expect(process(jobFor(localeLess))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(process(jobFor(localeLess))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      process(jobFor({ ...localeLess, unexpected: true })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("does not infer a locale-less payload from a new per-locale job", async () => {
    const payload = await seedJob();
    const summarize = vi.fn();
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    const { locale: _locale, ...localeLess } = payload;
    await expect(process(jobFor(localeLess))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(summarize).not.toHaveBeenCalled();
  });

  it("dead-letters multiple-match locale-less work without a cross-locale write", async () => {
    const payload = await seedJob();
    await ReportSnapshot.updateOne(
      { runId: payload.runId },
      {
        $unset: { aiSummaryJobsByLocale: 1 },
        $set: {
          aiSummaryJob: {
            generationId: payload.generationId,
            locale: "en",
            status: "queued",
            requestedAt: new Date(),
          },
          aiSummary: {
            text: "Résumé historique.",
            locale: "fr",
            model: "legacy",
            truncated: false,
            createdAt: new Date(),
          },
        },
      },
    );
    const summarize = vi.fn();
    const process = createAuditSummaryProcessor({
      provider: provider(summarize),
    });
    const { locale: _locale, ...localeLess } = payload;
    await expect(process(jobFor(localeLess))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    const snapshot = await ReportSnapshot.findOne({ runId: payload.runId });
    expect(snapshot?.toObject().aiSummaryVariantsByLocale ?? {}).toEqual({});
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe("onAuditSummaryJobExhausted", () => {
  it("ignores malformed payloads", async () => {
    await expect(
      onAuditSummaryJobExhausted(jobFor({ bad: true }), new Error("x")),
    ).resolves.toBeUndefined();
  });

  it("marks a matching active job failed and leaves terminal jobs unchanged", async () => {
    const queued = await seedJob();
    await onAuditSummaryJobExhausted(jobFor(queued), new Error("worker died"));
    expect(
      (await ReportSnapshot.findOne({ runId: queued.runId }))?.toObject()
        .aiSummaryJobsByLocale?.en,
    ).toMatchObject({ status: "failed" });

    await clearCollections();
    const succeeded = await seedJob("succeeded");
    await onAuditSummaryJobExhausted(
      jobFor(succeeded),
      new Error("late event"),
    );
    expect(
      (await ReportSnapshot.findOne({ runId: succeeded.runId }))?.toObject()
        .aiSummaryJobsByLocale?.en,
    ).toMatchObject({ status: "succeeded" });
  });
});
