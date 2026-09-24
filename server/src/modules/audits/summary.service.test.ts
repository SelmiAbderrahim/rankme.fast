import mongoose, { type Types } from "mongoose";
import type { Queue } from "bullmq";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';
import type { SummaryProvider } from "../../shared/providers/index.js";
import { VendorUnavailableError } from "../../shared/providers/errors.js";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "../../shared/testing/mongo.js";
import { Site } from "../sites/index.js";
import { AuditRun } from "./audit-run.model.js";
import {
  ReportSnapshot,
  type ReportSnapshotHydrated,
} from "./report-snapshot.model.js";
import {
  generateAuditSummary,
  getAuditSummaryState,
  startAuditSummary,
  toAuditSummaryState,
} from "./summary.service.js";

const stubGeneratePrompts = async () => ({
  prompts: [],
  model: "stub-summary",
});

function fakeProvider(
  overrides: Partial<SummaryProvider> = {},
): SummaryProvider {
  return {
    generatePrompts: stubGeneratePrompts,
    async summarize() {
      return {
        summary: "Fix titles first.",
        truncated: false,
        model: "test-model",
      };
    },
    ...overrides,
  };
}

function fakeQueue(
  add = vi.fn().mockResolvedValue({ id: "summary-job" }),
): Queue {
  return { add } as unknown as Queue;
}

async function seedOne(options: { withSummary?: boolean } = {}): Promise<{
  runId: string;
  accountId: string;
  siteId: string;
}> {
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
  await ReportSnapshot.create({
    runId: run._id,
    siteId: site._id,
    accountId,
    counts: { fixNow: 1, watch: 1, passed: 0 },
    findings: [
      {
        ruleId: "title-missing-or-weak",
        bucket: "fix-now",
        severity: "critical",
        affectedUrls: ["https://example.com/a"],
        meta: null,
      },
      {
        ruleId: "headings-weak",
        bucket: "watch",
        severity: "warning",
        affectedUrls: [],
        meta: null,
      },
    ],
    ...(options.withSummary
      ? {
          aiSummary: {
            text: "Old summary.",
            locale: "en",
            model: "old-model",
            truncated: false,
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
          },
        }
      : {}),
  });
  return {
    runId: (run._id as Types.ObjectId).toHexString(),
    accountId: (accountId as Types.ObjectId).toHexString(),
    siteId: (site._id as Types.ObjectId).toHexString(),
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("summary state and enqueue orchestration", () => {
  it('selects all seven exact variants and reports sorted completed availability', () => {
    const variants = Object.fromEntries(
      [...SUPPORTED_LOCALES].reverse().map((locale) => [
        locale,
        {
          text: `summary-${locale}`,
          locale,
          model: `model-${locale}`,
          truncated: false,
          createdAt: new Date('2026-08-25T10:00:00.000Z'),
        },
      ]),
    );
    const snapshot = {
      toObject: () => ({ aiSummaryVariantsByLocale: variants }),
    } as unknown as ReportSnapshotHydrated;
    for (const locale of SUPPORTED_LOCALES) {
      expect(toAuditSummaryState(snapshot, locale)).toMatchObject({
        status: 'succeeded',
        requestedLocale: locale,
        aiSummary: { text: `summary-${locale}`, locale },
        availableLocales: ['ar', 'de', 'en', 'es', 'fr', 'ru', 'zh'],
      });
    }
  });

  it('uses legacy summary/job only for an exact locale and ignores malformed legacy data', () => {
    const legacy = {
      aiSummary: {
        text: 'Résumé historique.',
        locale: 'fr',
        model: 'legacy',
        truncated: false,
        createdAt: new Date('2026-08-20T00:00:00.000Z'),
      },
      aiSummaryJob: { locale: 'fr', status: 'running' },
    };
    const snapshot = { toObject: () => legacy } as unknown as ReportSnapshotHydrated;
    expect(toAuditSummaryState(snapshot, 'fr')).toMatchObject({
      status: 'running',
      aiSummary: { text: 'Résumé historique.' },
      availableLocales: ['fr'],
    });
    expect(toAuditSummaryState(snapshot, 'en')).toEqual({
      status: 'idle',
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: ['fr'],
    });
    const malformed = {
      toObject: () => ({
        aiSummary: { ...legacy.aiSummary, locale: 'xx', createdAt: 'not-a-date' },
        aiSummaryJob: { locale: 'xx', status: 'running' },
      }),
    } as unknown as ReportSnapshotHydrated;
    expect(toAuditSummaryState(malformed, 'en')).toEqual({
      status: 'idle',
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });
  });

  it('rejects locale keys outside the fixed seven-key Mongoose subdocuments', async () => {
    const ids = await seedOne();
    await expect(
      ReportSnapshot.updateOne(
        { runId: ids.runId },
        {
          $set: {
            'aiSummaryVariantsByLocale.it': {
              text: 'no',
              locale: 'it',
              model: 'x',
              truncated: false,
              createdAt: new Date(),
            },
          },
        },
        { runValidators: true },
      ),
    ).rejects.toThrow();
  });

  it("infers idle and legacy succeeded states", async () => {
    const idle = await seedOne();
    expect(await getAuditSummaryState({ ...idle, locale: 'en' })).toEqual({
      status: "idle",
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });

    await clearCollections();
    const legacy = await seedOne({ withSummary: true });
    expect(await getAuditSummaryState({ ...legacy, locale: 'en' })).toMatchObject({
      status: "succeeded",
      aiSummary: {
        text: "Old summary.",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
    });
  });

  it("uses persisted job status and tolerates a non-object summary value at the serializer boundary", async () => {
    const ids = await seedOne();
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      {
        $set: {
          aiSummaryJob: {
            generationId: new mongoose.Types.ObjectId().toHexString(),
            locale: "en",
            status: "running",
            requestedAt: new Date(),
          },
        },
      },
    );
    expect(await getAuditSummaryState({ ...ids, locale: 'en' })).toMatchObject({
      status: "running",
    });
    expect(
      toAuditSummaryState({
        toObject: () => ({ aiSummary: "invalid", aiSummaryJob: null }),
      } as unknown as ReportSnapshotHydrated, 'en'),
    ).toEqual({
      status: "idle",
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });
  });

  it("rejects unavailable dependencies before claiming", async () => {
    const ids = await seedOne();
    await expect(
      startAuditSummary(
        { ...ids, locale: "en" },
        { provider: null, queue: fakeQueue() },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: "audits.aiSummary.errors.unavailable",
    });
    await expect(
      startAuditSummary(
        { ...ids, locale: "en" },
        { provider: fakeProvider(), queue: null },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: "audits.errors.queueUnavailable",
    });
  });

  it("returns 404 for malformed, unknown, cross-account, and snapshot-less runs", async () => {
    const deps = {
      provider: fakeProvider(),
      queue: fakeQueue(),
    };
    await expect(
      startAuditSummary({ runId: "bad", accountId: "x", locale: "en" }, deps),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      startAuditSummary(
        {
          runId: new mongoose.Types.ObjectId().toHexString(),
          accountId: new mongoose.Types.ObjectId().toHexString(),
          locale: "en",
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 404 });
    const ids = await seedOne();
    await expect(
      startAuditSummary(
        {
          ...ids,
          accountId: new mongoose.Types.ObjectId().toHexString(),
          locale: "en",
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await ReportSnapshot.deleteMany({});
    await expect(
      startAuditSummary({ ...ids, locale: "en" }, deps),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("preflights before claiming the snapshot", async () => {
    const ids = await seedOne();
    const invalid = new Error("invalid profile input");
    await expect(
      startAuditSummary(
        { ...ids, locale: "en" },
        {
            queue: fakeQueue(),
          provider: fakeProvider({
            preflightSummarize() {
              throw invalid;
            },
          }),
        },
      ),
    ).rejects.toBe(invalid);
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en).toBeFalsy();
  });

  it("atomically claims, preserves an old summary, and enqueues one-attempt generation", async () => {
    const ids = await seedOne({ withSummary: true });
    const add = vi.fn().mockResolvedValue({ id: "job" });
    const requestedAt = new Date("2026-07-16T10:00:00.000Z");
    const generationId = new mongoose.Types.ObjectId().toHexString();
    const state = await startAuditSummary(
      { ...ids, locale: "fr" },
      {
        provider: fakeProvider(),
        queue: fakeQueue(add),
        now: () => requestedAt,
        generationId: () => generationId,
      },
    );
    expect(state).toMatchObject({
      status: "queued",
      aiSummary: null,
    });
    expect(add).toHaveBeenCalledWith(
      "audit-summary",
      {
        accountId: ids.accountId,
        runId: ids.runId,
        generationId,
        locale: "fr",
      },
      expect.objectContaining({
        attempts: 1,
        jobId: `audit-summary-fr-${generationId}`,
      }),
    );
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.fr).toMatchObject({
      generationId,
      locale: "fr",
      status: "queued",
      requestedAt,
    });
  });

  it("dedupes an already active generation without enqueueing", async () => {
    const ids = await seedOne();
    await ReportSnapshot.updateOne(
      { runId: ids.runId },
      {
        $set: {
          aiSummaryJob: {
            generationId: new mongoose.Types.ObjectId().toHexString(),
            locale: "en",
            status: "queued",
            requestedAt: new Date(),
          },
        },
      },
    );
    const add = vi.fn();
    const state = await startAuditSummary(
      { ...ids, locale: "en" },
      { provider: fakeProvider(), queue: fakeQueue(add) },
    );
    expect(state.status).toBe("queued");
    expect(add).not.toHaveBeenCalled();
  });

  it('allows different locales to claim independently while same-locale state remains isolated', async () => {
    const ids = await seedOne();
    const add = vi.fn().mockResolvedValue({ id: 'job' });
    const generations = [
      new mongoose.Types.ObjectId().toHexString(),
      new mongoose.Types.ObjectId().toHexString(),
    ];
    const deps = {
      provider: fakeProvider(),
      queue: fakeQueue(add),
      generationId: () => generations.shift()!,
    };
    const [english, arabic] = await Promise.all([
      startAuditSummary({ ...ids, locale: 'en' }, deps),
      startAuditSummary({ ...ids, locale: 'ar' }, deps),
    ]);
    expect(english).toMatchObject({ status: 'queued', requestedLocale: 'en' });
    expect(arabic).toMatchObject({ status: 'queued', requestedLocale: 'ar' });
    expect(add).toHaveBeenCalledTimes(2);
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.en?.status).toBe('queued');
    expect(snapshot?.toObject().aiSummaryJobsByLocale?.ar?.status).toBe('queued');
    expect(snapshot?.toObject().aiSummaryJob).toBeFalsy();
  });

  it("returns the current state after losing a claim race", async () => {
    const ids = await seedOne();
    vi.spyOn(ReportSnapshot, "findOneAndUpdate").mockResolvedValueOnce(null);
    const state = await startAuditSummary(
      { ...ids, locale: "en" },
      { provider: fakeProvider(), queue: fakeQueue() },
    );
    expect(state.status).toBe("idle");
  });

  it("marks failed when Redis enqueue fails", async () => {
    const ids = await seedOne();
    const failureAt = new Date("2026-07-16T10:01:00.000Z");
    await expect(
      startAuditSummary(
        { ...ids, locale: "en" },
        {
            provider: fakeProvider(),
          queue: fakeQueue(vi.fn().mockRejectedValue(new Error("redis down"))),
          now: () => failureAt,
        },
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: "audits.errors.queueUnavailable",
    });
    expect(await getAuditSummaryState({ ...ids, locale: 'en' })).toMatchObject({ status: "failed" });
  });

  it("timestamps enqueue failure with the wall clock when no clock is injected", async () => {
    const ids = await seedOne();
    await expect(
      startAuditSummary(
        { ...ids, locale: "en" },
        {
            provider: fakeProvider(),
          queue: fakeQueue(vi.fn().mockRejectedValue(new Error("redis down"))),
        },
      ),
    ).rejects.toMatchObject({ status: 503 });
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId });
    const job = snapshot?.toObject().aiSummaryJobsByLocale?.en as { finishedAt: Date };
    expect(job.finishedAt).toBeInstanceOf(Date);
  });
});

describe("worker-side provider generation", () => {
  it("rejects a missing provider", async () => {
    const ids = await seedOne();
    await expect(
      generateAuditSummary(
        {
          ...ids,
          locale: "en",
          generationId: new mongoose.Types.ObjectId().toHexString(),
        },
        { provider: null },
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("uses the wall clock when no generation clock is injected", async () => {
    const ids = await seedOne();
    const result = await generateAuditSummary(
      {
        ...ids,
        locale: "en",
        generationId: new mongoose.Types.ObjectId().toHexString(),
      },
      { provider: fakeProvider() },
    );
    expect(Number.isNaN(Date.parse(result.createdAt))).toBe(false);
  });

  it("localizes fix-now findings, passes correlation, archives metadata, and logs safely", async () => {
    const ids = await seedOne();
    const summarize = vi.fn().mockResolvedValue({
      summary: "Generated summary.",
      truncated: true,
      model: "model-1",
    });
    const archive = vi.fn().mockResolvedValue(undefined);
    const info = vi.fn();
    const generatedAt = new Date("2026-07-16T11:00:00.000Z");
    const generationId = new mongoose.Types.ObjectId().toHexString();
    const result = await generateAuditSummary(
      { ...ids, locale: "fr", generationId },
      {
        provider: fakeProvider({ summarize }),
        archiveVendorResponse: archive,
        logger: { info },
        now: () => generatedAt,
      },
    );
    expect(result).toEqual({
      text: "Generated summary.",
      locale: "fr",
      model: "model-1",
      truncated: true,
      createdAt: generatedAt.toISOString(),
    });
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "fr",
        siteDomain: "example.com",
        correlationId: generationId,
        findings: [
          expect.objectContaining({
            ruleId: "title-missing-or-weak",
            affectedCount: 1,
          }),
        ],
      }),
    );
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "summary",
        accountId: ids.accountId,
        fetchedAt: generatedAt,
        payload: expect.objectContaining({
          model: "model-1",
          profile: "audit_summary",
        }),
      }),
    );
    expect(JSON.stringify(archive.mock.calls)).not.toContain(
      "Generated summary.",
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "ok",
        findingCount: 1,
        model: "model-1",
      }),
      "ai summary generated",
    );
    const snapshot = await ReportSnapshot.findOne({ runId: ids.runId });
    expect(snapshot?.get("aiSummary")).toBeFalsy();
  });

  it("hides summaries when their Site is missing or deleting", async () => {
    const ids = await seedOne();
    await Site.deleteMany({});
    const summarize = vi.fn();
    await expect(
      generateAuditSummary(
        {
          ...ids,
          locale: "en",
          generationId: new mongoose.Types.ObjectId().toHexString(),
        },
        { provider: fakeProvider({ summarize }), logger: { info: vi.fn() } },
      ),
    ).rejects.toMatchObject({ status: 404, message: "audits.errors.notFound" });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("rechecks the Site immediately before building provider input", async () => {
    const ids = await seedOne();
    vi.spyOn(Site, "exists").mockResolvedValueOnce({ _id: ids.siteId } as never);
    vi.spyOn(Site, "findOne").mockResolvedValueOnce(null as never);
    const summarize = vi.fn();

    await expect(
      generateAuditSummary(
        {
          ...ids,
          locale: "en",
          generationId: new mongoose.Types.ObjectId().toHexString(),
        },
        { provider: fakeProvider({ summarize }), logger: { info: vi.fn() } },
      ),
    ).rejects.toMatchObject({ status: 404, message: "audits.errors.notFound" });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("rethrows and logs provider errors for a live Site", async () => {
    const ids = await seedOne();
    const failure = new VendorUnavailableError("down", {
      provider: "ai-generation",
      operation: "summarize",
    });
    const info = vi.fn();
    const summarize = vi.fn().mockImplementation((input) => {
      expect(input.siteDomain).toBe("example.com");
      throw failure;
    });
    await expect(
      generateAuditSummary(
        {
          ...ids,
          locale: "en",
          generationId: new mongoose.Types.ObjectId().toHexString(),
        },
        { provider: fakeProvider({ summarize }), logger: { info } },
      ),
    ).rejects.toBe(failure);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        error: "VendorUnavailableError",
      }),
      "ai summary call failed",
    );
  });

  it("rethrows a non-Error rejection with a safe failure classification", async () => {
    const ids = await seedOne();
    const info = vi.fn();
    await expect(
      generateAuditSummary(
        {
          ...ids,
          locale: "en",
          generationId: new mongoose.Types.ObjectId().toHexString(),
        },
        {
          provider: fakeProvider({
            summarize: vi.fn().mockRejectedValue("down"),
          }),
          logger: { info },
        },
      ),
    ).rejects.toBe("down");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ error: "unknown" }),
      "ai summary call failed",
    );
  });
});
