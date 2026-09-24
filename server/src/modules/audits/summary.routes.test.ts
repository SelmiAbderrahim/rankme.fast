/** HTTP contract tests for durable audit-summary enqueue + polling. */
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
import request from "supertest";
import type mongoose from "mongoose";
import type { Job, Queue } from "bullmq";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import type { SummaryProvider } from "../../shared/providers/index.js";
import { DICTIONARIES } from "../../shared/i18n/index.js";
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from "../../shared/testing/auth.js";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "../../shared/testing/mongo.js";
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from "../../shared/testing/postgres.js";
import { Site, setSitesDb } from "../sites/index.js";
import { AuditRun } from "./audit-run.model.js";
import { setAuditsQueue } from "./audits.queue-holder.js";
import { ReportSnapshot } from "./report-snapshot.model.js";
import { writeReportSnapshot } from "./report.service.js";
import { makeAuditResult } from "./rules/fixtures.js";
import { setSummaryProvider } from "./summary.holder.js";

const app = createApp();
const stubGeneratePrompts = async () => ({ prompts: [], model: "stub" });

function trackingProvider() {
  const summarize = vi.fn().mockResolvedValue({
    summary: "Worker-only result.",
    truncated: false,
    model: "test-model",
  });
  const provider: SummaryProvider = {
    summarize,
    generatePrompts: stubGeneratePrompts,
  };
  return { provider, summarize };
}

function fakeQueue(
  add = vi
    .fn()
    .mockImplementation(
      async (_name: string, _data: unknown, options: { jobId?: string }) =>
        ({ id: options.jobId }) as Job,
    ),
): { queue: Queue; add: ReturnType<typeof vi.fn> } {
  return { queue: { add } as unknown as Queue, add };
}

async function addSite(user: TestUser): Promise<string> {
  const response = await request(app)
    .post("/api/sites")
    .set("Cookie", user.cookie)
    .send({ url: "https://example.com" });
  return (response.body as { site: { id: string } }).site.id;
}

async function seedRunFor(
  user: TestUser,
  withSummary = false,
): Promise<{
  runId: string;
  siteId: string;
  accountId: string;
}> {
  const siteId = await addSite(user);
  const site = await Site.findById(siteId);
  const run = await AuditRun.create({
    accountId: site!.accountId,
    siteId: site!._id,
    pageCap: 100,
    status: "succeeded",
  });
  await writeReportSnapshot({
    runId: run.id as string,
    siteId,
    accountId: (site!.accountId as mongoose.Types.ObjectId).toHexString(),
    result: makeAuditResult(),
  });
  if (withSummary) {
    await ReportSnapshot.updateOne(
      { runId: run._id },
      {
        $set: {
          aiSummary: {
            text: "Existing summary.",
            locale: "en",
            model: "old-model",
            truncated: false,
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
          },
        },
      },
    );
  }
  return {
    runId: run.id as string,
    siteId,
    accountId: (site!.accountId as mongoose.Types.ObjectId).toHexString(),
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setSummaryProvider(null);
  setAuditsQueue(fakeQueue().queue);
  Object.assign(env, { AI_SUMMARY_ENABLED: true });
});

afterEach(() => {
  setAuditsQueue(null);
  setSummaryProvider(null);
  Object.assign(env, { AI_SUMMARY_ENABLED: false });
  vi.restoreAllMocks();
});

describe("summary endpoint gates and ownership", () => {
  it("returns 404 for both methods when the feature flag is off", async () => {
    Object.assign(env, { AI_SUMMARY_ENABLED: false });
    const user = await signupVerifiedUser(app, { email: "summary-off@x.co" });
    const { runId } = await seedRunFor(user);
    expect(
      (
        await request(app)
          .post(`/api/audits/${runId}/summary`)
          .set("Cookie", user.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/audits/${runId}/summary`)
          .set("Cookie", user.cookie)
      ).status,
    ).toBe(404);
    const report = await request(app)
      .get(`/api/audits/${runId}/report`)
      .set("Cookie", user.cookie);
    expect(report.body).toMatchObject({
      aiSummary: null,
      aiSummaryStatus: "idle",
      aiSummaryEnabled: false,
    });
  });

  it("returns 503 when provider or queue is unavailable", async () => {
    const user = await signupVerifiedUser(app, { email: "summary-deps@x.co" });
    const { runId } = await seedRunFor(user);
    const noProvider = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(noProvider.status).toBe(503);
    setSummaryProvider(trackingProvider().provider);
    setAuditsQueue(null);
    const noQueue = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(noQueue.status).toBe(503);
  });

  it("requires authentication and conceals cross-account runs", async () => {
    setSummaryProvider(trackingProvider().provider);
    expect(
      (await request(app).post("/api/audits/507f191e810c19729de860ea/summary"))
        .status,
    ).toBe(401);
    const owner = await signupVerifiedUser(app, {
      email: "summary-owner@x.co",
    });
    const other = await signupVerifiedUser(app, {
      email: "summary-other@x.co",
    });
    const { runId } = await seedRunFor(owner);
    expect(
      (
        await request(app)
          .post(`/api/audits/${runId}/summary`)
          .set("Cookie", other.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/audits/${runId}/summary`)
          .set("Cookie", other.cookie)
      ).status,
    ).toBe(404);
  });

  it("returns the localized 409 for a paused site without enqueueing", async () => {
    const queued = fakeQueue();
    setSummaryProvider(trackingProvider().provider);
    setAuditsQueue(queued.queue);
    const user = await signupVerifiedUser(app, {
      email: "summary-paused@x.co",
    });
    const { runId, siteId } = await seedRunFor(user);
    await Site.updateOne(
      { _id: siteId },
      { $set: { paused: true, pausedAt: new Date() } },
    );
    const post = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(post.status).toBe(409);
    expect(post.body.error.message).toBe(DICTIONARIES.en.sites.errors.paused);
    expect(queued.add).not.toHaveBeenCalled();
    // The stored summary read stays available while paused.
    const poll = await request(app)
      .get(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(poll.status).toBe(200);
    expect(poll.body).toEqual({
      status: "idle",
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });
  });

  it("returns 404 for malformed and unknown run ids", async () => {
    setSummaryProvider(trackingProvider().provider);
    const user = await signupVerifiedUser(app, {
      email: "summary-missing@x.co",
    });
    expect(
      (
        await request(app)
          .post("/api/audits/not-an-id/summary")
          .set("Cookie", user.cookie)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/api/audits/507f191e810c19729de860ea/summary")
          .set("Cookie", user.cookie)
      ).status,
    ).toBe(404);
  });
});

describe("POST enqueue and GET polling contract", () => {
  it("returns 202 queued, invokes no provider, and exposes state through GET/report", async () => {
    const tracked = trackingProvider();
    const queued = fakeQueue();
    setSummaryProvider(tracked.provider);
    setAuditsQueue(queued.queue);
    const user = await signupVerifiedUser(app, { email: "summary-queue@x.co" });
    const { runId, accountId } = await seedRunFor(user);
    const post = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie)
      .set("x-lang", "fr");
    expect(post.status).toBe(202);
    expect(post.body).toEqual({
      status: "queued",
      aiSummary: null,
      requestedLocale: 'fr',
      availableLocales: [],
    });
    expect(tracked.summarize).not.toHaveBeenCalled();
    expect(queued.add).toHaveBeenCalledWith(
      "audit-summary",
      expect.objectContaining({ accountId, runId, locale: "fr" }),
      expect.objectContaining({ attempts: 1 }),
    );

    const poll = await request(app)
      .get(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(poll.status).toBe(200);
    expect(poll.body).toEqual({
      status: "idle",
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });
    const report = await request(app)
      .get(`/api/audits/${runId}/report`)
      .set("Cookie", user.cookie);
    expect(report.body).toMatchObject({
      aiSummaryStatus: "idle",
      aiSummaryEnabled: true,
      aiSummaryAvailability: {
        requestedLocale: 'en',
        availableLocales: [],
        status: 'idle',
      },
    });

    const frenchPoll = await request(app)
      .get(`/api/audits/${runId}/summary`)
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr');
    expect(frenchPoll.body).toMatchObject({
      status: 'queued',
      requestedLocale: 'fr',
    });
  });

  it("dedupes repeated POSTs while active", async () => {
    const queued = fakeQueue();
    setSummaryProvider(trackingProvider().provider);
    setAuditsQueue(queued.queue);
    const user = await signupVerifiedUser(app, {
      email: "summary-dedupe@x.co",
    });
    const { runId } = await seedRunFor(user);
    const first = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    const second = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.status).toBe("queued");
    expect(queued.add).toHaveBeenCalledOnce();
  });

  it("preserves an existing summary during regeneration", async () => {
    setSummaryProvider(trackingProvider().provider);
    const user = await signupVerifiedUser(app, {
      email: "summary-preserve@x.co",
    });
    const { runId } = await seedRunFor(user, true);
    const post = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(post.body).toMatchObject({
      status: "queued",
      aiSummary: { text: "Existing summary.", model: "old-model" },
    });
  });

  it("polls legacy summary snapshots as succeeded", async () => {
    const user = await signupVerifiedUser(app, {
      email: "summary-legacy@x.co",
    });
    const { runId } = await seedRunFor(user, true);
    const poll = await request(app)
      .get(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(poll.body).toMatchObject({
      status: "succeeded",
      aiSummary: { text: "Existing summary." },
    });
  });

  it("maps enqueue failure to 503 and a durable failed polling state", async () => {
    setSummaryProvider(trackingProvider().provider);
    setAuditsQueue(
      fakeQueue(vi.fn().mockRejectedValue(new Error("redis down"))).queue,
    );
    const user = await signupVerifiedUser(app, { email: "summary-redis@x.co" });
    const { runId } = await seedRunFor(user);
    const post = await request(app)
      .post(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(post.status).toBe(503);
    const poll = await request(app)
      .get(`/api/audits/${runId}/summary`)
      .set("Cookie", user.cookie);
    expect(poll.body).toEqual({
      status: "failed",
      aiSummary: null,
      requestedLocale: 'en',
      availableLocales: [],
    });
  });
});
