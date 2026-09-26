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
import express from "express";
import request from "supertest";
import { createApp } from "../../app.js";
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from "../../shared/testing/mongo.js";
import { env } from "../../config/env.js";
import {
  configureHealthController,
  resetHealthController,
  runHealthCheck,
  pingRedis,
  redisProbe,
  type RedisPingClient,
} from "./index.js";

const app = createApp();

beforeAll(() => startMemoryMongo());
afterAll(() => stopMemoryMongo());
beforeEach(async () => {
  await clearCollections();
  resetHealthController();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("runHealthCheck", () => {
  it("reports ok when db + redis probes pass", async () => {
    const res = await runHealthCheck({
      probeDb: () => true,
      probeRedis: async () => true,
      now: () => new Date("2027-01-01T00:00:00Z"),
    });
    expect(res.status).toBe("ok");
    expect(res.db).toBe(true);
    expect(res.redis).toBe(true);
    expect(res.timestamp).toBe("2027-01-01T00:00:00.000Z");
  });

  it("reports degraded when db is down", async () => {
    const res = await runHealthCheck({
      probeDb: () => false,
      probeRedis: async () => true,
    });
    expect(res.status).toBe("degraded");
    expect(res.db).toBe(false);
  });

  it("reports degraded when db is up but redis is down", async () => {
    const res = await runHealthCheck({
      probeDb: () => true,
      probeRedis: async () => false,
    });
    expect(res.status).toBe("degraded");
    expect(res.db).toBe(true);
    expect(res.redis).toBe(false);
  });

  it("uses default probes when none provided", async () => {
    const res = await runHealthCheck();
    // in tests mongoose is connected via memory server → ok
    expect(res.status).toBe("ok");
  });

  it("probes the configured Redis via the default probe", async () => {
    const original = env.REDIS_URL;
    (env as { REDIS_URL?: string }).REDIS_URL = "redis://localhost:6379";
    const spy = vi.spyOn(redisProbe, "pingRedis").mockResolvedValue(true);
    try {
      const res = await runHealthCheck({ probeDb: () => true });
      expect(res.redis).toBe(true);
      expect(res.redisConfigured).toBe(true);
      expect(spy).toHaveBeenCalledWith("redis://localhost:6379");
    } finally {
      spy.mockRestore();
      (env as { REDIS_URL?: string }).REDIS_URL = original;
    }
  });
});

describe("pingRedis", () => {
  function fakeClient(overrides: Partial<RedisPingClient>): RedisPingClient {
    return {
      ping: overrides.ping ?? (async () => "PONG"),
      quit: overrides.quit ?? (async () => undefined),
    };
  }

  it("returns true when the client answers PONG", async () => {
    const ok = await pingRedis("redis://x", () =>
      fakeClient({ ping: async () => "PONG" }),
    );
    expect(ok).toBe(true);
  });

  it("returns false when the reply is not PONG", async () => {
    const ok = await pingRedis("redis://x", () =>
      fakeClient({ ping: async () => "nope" }),
    );
    expect(ok).toBe(false);
  });

  it("returns false when the ping throws", async () => {
    const ok = await pingRedis("redis://x", () =>
      fakeClient({
        ping: async () => {
          throw new Error("unreachable");
        },
      }),
    );
    expect(ok).toBe(false);
  });

  it("swallows a quit() failure in the finally cleanup", async () => {
    const ok = await pingRedis("redis://x", () =>
      fakeClient({
        ping: async () => "PONG",
        quit: async () => {
          throw new Error("quit failed");
        },
      }),
    );
    expect(ok).toBe(true);
  });
});

describe("/api/health", () => {
  it("returns 200 with ok status when probes pass", async () => {
    configureHealthController({
      probeDb: () => true,
      probeRedis: async () => true,
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toMatch(
      /^\d+\.\d+\.\d+\+(?:dev|[a-f0-9]{7,12})$/u,
    );
  });

  it("returns 503 when a probe fails", async () => {
    configureHealthController({
      probeDb: () => false,
      probeRedis: async () => true,
    });
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("does not require auth", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).not.toBe(401);
  });

  it("includes the baked SHA version without leaking runtime environment values", async () => {
    vi.stubEnv("APP_BUILD_SHA", "A1B2C3D4");
    // Re-import only the health module graph: the full app graph registers
    // Mongoose models, which cannot be compiled twice in one process.
    const {
      configureHealthController: configureVersionedHealth,
      healthRouter: versionedHealthRouter,
    } = await import("./index.js");
    configureVersionedHealth({
      probeDb: () => true,
      probeRedis: async () => true,
    });
    const versionedApp = express();
    versionedApp.use("/api", versionedHealthRouter);

    const response = await request(versionedApp).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      db: true,
      redis: true,
      version: "0.1.0+a1b2c3d4",
    });
    expect(JSON.stringify(response.body)).not.toContain("APP_BUILD_SHA");
    expect(JSON.stringify(response.body)).not.toContain("A1B2C3D4");
  });
});
