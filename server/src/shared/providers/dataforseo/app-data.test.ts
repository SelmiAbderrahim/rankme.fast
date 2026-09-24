import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse, type JsonBodyType } from "msw";
import { providerContractTests } from "../../testing/fixtures/contract.js";
import { loadFixture } from "../../testing/fixtures/load.js";
import {
  mockVendor,
  vendorMockServer,
} from "../../testing/fixtures/mock-vendor.js";
import { captureVendorCost, usdToMicros } from "../cost-capture.js";
import { VendorMalformedError, VendorUnavailableError } from "../errors.js";
import {
  APP_CHART_MAX_DEPTH,
  APP_DATA_STANDARD_PRIORITY,
  APP_REVIEWS_MAX_DEPTH,
  APP_SEARCH_DEPTH_APPLE,
  APP_SEARCH_DEPTH_PLAY,
  BULK_METRICS_MAX_APPS,
  INTERSECTION_MAX_APPS,
  LABS_ROW_LIMIT,
  createDataForSeoAppDataProvider,
  normalizeInstallRange,
} from "./app-data.js";

const CREATED = {
  version: "0.1.20260808",
  status_code: 20000,
  status_message: "Ok.",
  time: "0.01 sec.",
  cost: 0.001,
  tasks_count: 1,
  tasks_error: 0,
  tasks: [
    {
      id: "TASK_ID",
      status_code: 20100,
      status_message: "Task Created.",
      time: "0.01 sec.",
      cost: 0.001,
      result_count: 0,
      path: ["v3", "app_data", "task_post"],
      result: null,
    },
  ],
};

const IN_QUEUE = {
  ...CREATED,
  cost: 0,
  tasks_error: 1,
  tasks: [
    {
      ...CREATED.tasks[0],
      status_code: 40602,
      status_message: "Task In Queue.",
      cost: 0,
    },
  ],
};

function okEnvelope(result: unknown, costUsd = 0) {
  return {
    ...CREATED,
    cost: costUsd,
    tasks: [
      {
        ...CREATED.tasks[0],
        status_code: 20000,
        status_message: "Ok.",
        cost: 0,
        result_count: 1,
        result,
      },
    ],
  };
}

const PLAY_RESULT = [
  {
    keyword: "seo",
    location_code: 2840,
    language_code: "en",
    datetime: "2026-08-08 10:00:00 +00:00",
    se_results_count: 42,
    items: [
      {
        type: "google_play_search_paid",
        rank_group: 1,
        rank_absolute: 1,
        app_id: "paid.app",
        title: "Sponsored app",
      },
      {
        type: "google_play_search_bundle",
        rank_group: 1,
        rank_absolute: 2,
        app_id: "bundle.app",
        title: "App bundle",
      },
      {
        type: "google_play_search_organic",
        rank_group: 1,
        rank_absolute: 3,
        title: "Malformed organic app without an id",
      },
      {
        type: "google_play_search_organic",
        rank_group: 2,
        rank_absolute: 4,
        app_id: "com.example.organic",
        title: "Organic App",
        url: "https://play.example.test/apps/details?id=com.example.organic",
        icon: null,
        reviews_count: 123,
        rating: { value: 4.4 },
        is_free: true,
        price: { current: 0, currency: "USD", displayed_price: "Free" },
        developer: "Example Studio",
        installs: "1,000,000+",
      },
    ],
  },
];

const APPLE_RESULT = [
  {
    keyword: "seo",
    location_code: 2840,
    language_code: "en",
    datetime: "2026-08-08 10:00:00 +00:00",
    se_results_count: 1,
    items: [
      {
        type: "app_store_search_organic",
        rank_group: 1,
        rank_absolute: 1,
        app_id: "123456789",
        title: "Apple Organic App",
        url: "https://apps.example.test/app/id123456789",
        icon: null,
        reviews_count: 12,
        rating: { value: 4.8 },
        is_free: false,
        price: { current: 2.99, currency: "USD", displayed_price: "$2.99" },
        developer: "Example Studio",
        installs: "999,999+",
      },
    ],
  },
];

const PLAY_INFO_RESULT = [
  {
    app_id: "com.example.organic",
    location_code: 2840,
    language_code: "en",
    datetime: "2026-08-08 10:00:00 +00:00",
    items: [
      {
        type: "google_play_info_organic",
        app_id: "com.example.organic",
        title: "Organic App",
        url: "https://play.example.test/apps/details?id=com.example.organic",
        icon: "https://play.example.test/icon.png",
        description: "A deterministic listing.",
        reviews_count: 123,
        rating: { value: 4.4 },
        price: { current: 0, currency: "USD", displayed_price: "Free" },
        is_free: true,
        main_category: "Tools",
        installs: "1,000,000+",
        developer: "Example Studio",
        developer_url: "https://play.example.test/developer/example",
        developer_website: "https://example.test/",
        version: "2.0.0",
        minimum_os_version: "10",
        size: "20 MB",
        released_date: "2020-01-01 00:00:00 +00:00",
        last_update_date: "2026-08-01 00:00:00 +00:00",
        update_notes: "Reliability improvements.",
        images: ["https://play.example.test/screenshot.png", "javascript:alert(1)"],
        videos: ["https://play.example.test/video.mp4"],
        similar_apps: [
          {
            app_id: "com.example.similar",
            title: "Similar App",
            url: "https://play.example.test/apps/details?id=com.example.similar",
          },
        ],
        more_apps_by_developer: [],
        genres: ["Tools", "Productivity", "Tools"],
        tags: ["seo", "audit"],
      },
    ],
  },
];

const APPLE_INFO_RESULT = [
  {
    app_id: "123456789",
    location_code: 2840,
    language_code: "en",
    datetime: "2026-08-08 10:00:00 +00:00",
    items: [
      {
        type: "app_store_info_organic",
        app_id: "123456789",
        title: "Apple Organic App",
        url: "https://apps.example.test/app/id123456789",
        icon: null,
        description: "An App Store listing.",
        reviews_count: 12,
        rating: { value: 4.8 },
        price: { current: 2.99, currency: "USD", displayed_price: "$2.99" },
        is_free: false,
        main_category: "Utilities",
        categories: ["Utilities"],
        languages: ["en", "fr"],
        advisories: ["4+"],
        developer: "Example Studio",
        developer_url: "https://apps.example.test/developer/123",
        version: "3.0.0",
        minimum_os_version: "17.0",
        size: "30 MB",
        last_update_date: "2026-08-01 00:00:00 +00:00",
        update_notes: "App Store update.",
        images: ["https://apps.example.test/screenshot.png"],
        similar_apps: [],
        more_apps_by_developer: [],
        // Deliberate cross-store noise: normalization must not fabricate these
        // fields on the App Store shape even if a vendor payload drifts.
        installs: "999,999+",
        developer_website: "https://should-not-cross.example.test/",
        released_date: "2020-01-01 00:00:00 +00:00",
        videos: ["https://should-not-cross.example.test/video.mp4"],
        tags: ["should-not-cross"],
      },
    ],
  },
];

const PLAY_REVIEWS_RESULT = [
  {
    app_id: "com.example.organic",
    location_code: 2840,
    language_code: "en",
    datetime: "2026-08-08 10:00:00 +00:00",
    title: "Organic App",
    rating: { value: 4.4 },
    reviews_count: 123,
    items: [
      {
        type: "google_play_reviews_search",
        id: "review-play-1",
        rating: { value: 5 },
        title: "Useful",
        review_text: "The audit is clear and practical.",
        timestamp: "2026-08-07 09:00:00 +00:00",
        user_profile: {
          profile_name: "Helpful reviewer",
          profile_image_url: "https://profiles.example.test/private.png",
          id: "profile-id-must-not-cross-boundary",
        },
      },
      {
        type: "google_play_reviews_search",
        id: "review-play-2",
        rating: { value: 3 },
        title: null,
        review_text: "It works, but the report could load faster.",
        timestamp: "not-a-timestamp",
        user_profile: { profile_name: "reviewer@example.test" },
      },
      {
        type: "google_play_reviews_search",
        rating: { value: 4 },
        review_text: "Malformed because its review id is absent.",
      },
      {
        type: "app_store_reviews_search",
        id: "wrong-store-review",
        rating: { value: 5 },
        review_text: "A cross-store item must be ignored.",
      },
    ],
  },
];

const APPLE_REVIEWS_RESULT = [
  {
    app_id: "123456789",
    location_code: 2826,
    language_code: "en",
    datetime: "2026-08-08 11:00:00 +00:00",
    title: "Apple Organic App",
    rating: { value: 4.8 },
    reviews_count: 12,
    items: [
      {
        type: "app_store_reviews_search",
        id: "review-apple-1",
        rating: { value: 4 },
        title: "Solid",
        review_text: "The keyword view is easy to use.",
        timestamp: "2026-08-06 08:00:00 +00:00",
        user_profile: { profile_name: "Store reviewer" },
      },
    ],
  },
];

const APPLE_METRICS = {
  pos_1: 2,
  pos_2_3: 3,
  pos_4_10: 5,
  pos_11_100: 7,
  count: 17,
  search_volume: 4_200,
};

const KEYWORDS_FOR_APP_RESULT = [
  {
    items: [
      {
        keyword_data: {
          keyword: "seo audit",
          keyword_info: {
            search_volume: 1_200,
            last_updated_time: "2026-08-01 06:00:00 +00:00",
          },
        },
        ranked_serp_element: {
          serp_item: { rank_group: 3, rank_absolute: 5 },
          last_updated_time: "2026-08-02 07:00:00 +00:00",
        },
      },
    ],
  },
];

const APP_COMPETITORS_RESULT = [
  {
    items: [
      {
        app_id: "382617920",
        avg_position: 12.5,
        sum_position: 250,
        intersections: 17,
        competitor_metrics: {
          app_store_search_organic: APPLE_METRICS,
        },
        full_metrics: {
          app_store_search_organic: {
            ...APPLE_METRICS,
            count: 30,
            search_volume: 9_000,
          },
        },
      },
    ],
  },
];

const APP_INTERSECTION_RESULT = [
  {
    items: [
      {
        keyword_data: {
          keyword: "rank tracker",
          keyword_info: {
            search_volume: 880,
            last_updated_time: "2026-08-03 08:00:00 +00:00",
          },
          serp_info: {
            last_updated_time: "2026-08-04 09:00:00 +00:00",
          },
        },
        intersection_result: {
          "1": { rank_group: 2, rank_absolute: 3 },
          "2": { rank_group: 9, rank_absolute: 12 },
        },
      },
    ],
  },
];

const BULK_APP_METRICS_RESULT = [
  {
    items: [
      {
        app_id: "686449807",
        metrics: { app_store_search_organic: APPLE_METRICS },
      },
    ],
  },
];

const waits: number[] = [];
const FIXTURE_PROVIDER = "dataforseo-app-data";
const provider = createDataForSeoAppDataProvider({
  login: "sandbox-login",
  password: "sandbox-password",
  baseUrl: "https://dataforseo.mock/v3",
  timeoutMs: 60,
  maxRetries: 0,
  backoffBaseMs: 1,
  random: () => 0,
  wait: async (milliseconds) => {
    waits.push(milliseconds);
  },
  maxPollAttempts: 2,
  pollIntervalMs: 0,
  now: () => new Date("2026-08-08T10:00:00.000Z"),
});

function mockTaskFlow(
  result: unknown,
  opts: {
    queueOnce?: boolean;
    successCostUsd?: number;
    onRequest?: (request: Request) => Promise<void> | void;
  } = {},
): void {
  let getCount = 0;
  vendorMockServer.use(
    http.all("*", async ({ request }) => {
      await opts.onRequest?.(request);
      if (request.method === "POST")
        return HttpResponse.json(CREATED as JsonBodyType);
      getCount += 1;
      if (opts.queueOnce && getCount === 1) {
        return HttpResponse.json(IN_QUEUE as JsonBodyType);
      }
      return HttpResponse.json(
        okEnvelope(result, opts.successCostUsd) as JsonBodyType,
      );
    }),
  );
}

function mockLiveFlow(
  result: unknown,
  onRequest?: (request: Request) => Promise<void> | void,
  costUsd = 0,
): void {
  vendorMockServer.use(
    http.post("*", async ({ request }) => {
      await onRequest?.(request);
      return HttpResponse.json(okEnvelope(result, costUsd) as JsonBodyType);
    }),
  );
}

function mockStaticEnvelope(envelope: unknown): void {
  vendorMockServer.use(
    http.all("*", () => HttpResponse.json(envelope as JsonBodyType)),
  );
}

function fixtureResponse(operation: string, kase: string): Response {
  const fixture = loadFixture(FIXTURE_PROVIDER, operation, kase);
  return HttpResponse.json(fixture.body as JsonBodyType, {
    status: fixture.status,
  });
}

function mockTaskFixture(
  operation: string,
  kase: "success" | "timeout" | "malformed" | "quota",
  successCase = "success-google-play",
): void {
  if (kase !== "success") {
    mockVendor(FIXTURE_PROVIDER, operation, kase);
    return;
  }
  vendorMockServer.use(
    http.all("*", ({ request }) =>
      fixtureResponse(
        operation,
        request.method === "POST" ? "post-success" : successCase,
      ),
    ),
  );
}

function mockLiveFixture(
  operation: string,
  kase: "success" | "timeout" | "malformed" | "quota",
  successCase = "success-google-play",
): void {
  mockVendor(
    FIXTURE_PROVIDER,
    operation,
    kase === "success" ? successCase : kase,
  );
}

providerContractTests({
  title: "DataForSeoAppDataProvider.listMarkets",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "market-catalog",
  makeCall: () => provider.listMarkets!("google_play"),
  assertSuccess: (markets) => {
    expect(markets).toEqual([
      { countryCode: "US", locationCode: 2840, languageCodes: ["en", "es"] },
    ]);
  },
});

it("accepts app location catalogs above the shared response ceiling", async () => {
  const largeProvider = createDataForSeoAppDataProvider({
    login: "sandbox-login",
    password: "sandbox-password",
    baseUrl: "https://dataforseo.mock/v3",
    maxRetries: 0,
    fetchImpl: async (input) =>
      Response.json(
        okEnvelope(
          String(input).endsWith("/languages")
            ? [{ language_code: "en" }]
            : [
                {
                  location_code: 2840,
                  country_iso_code: "US",
                  location_type: "Country",
                  ignored: "x".repeat(33 * 1024 * 1024),
                },
              ],
        ),
      ),
  });

  await expect(largeProvider.listMarkets!("google_play")).resolves.toEqual([
    { countryCode: "US", locationCode: 2840, languageCodes: ["en"] },
  ]);
});

it("rejects an app market catalog envelope without a successful task", async () => {
  const emptyTaskProvider = createDataForSeoAppDataProvider({
    login: "sandbox-login",
    password: "sandbox-password",
    baseUrl: "https://dataforseo.mock/v3",
    maxRetries: 0,
    fetchImpl: async () =>
      Response.json({
        ...okEnvelope([]),
        tasks_count: 0,
        tasks: [],
      }),
  });

  await expect(emptyTaskProvider.listMarkets!("google_play")).rejects.toThrow(
    "catalog returned no ok tasks",
  );
});

providerContractTests({
  title: "DataForSeoAppDataProvider.searchApps",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "search-apps",
  makeCall: () =>
    provider.searchApps({ store: "google_play", keyword: "seo audit" }),
  assertSuccess: (result) => {
    expect(result.store).toBe("google_play");
    expect(result.rows[0]).toMatchObject({
      appId: "com.example.audit",
      installs: { raw: "10,000+", lowerBound: 10_000 },
    });
  },
  mockCase: (kase) => mockTaskFixture("search-apps", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.getAppInfo",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "app-info",
  makeCall: () =>
    provider.getAppInfo({
      store: "google_play",
      appId: "com.example.audit",
    }),
  assertSuccess: (result) => {
    expect(result).toMatchObject({
      store: "google_play",
      appId: "com.example.audit",
      installs: { raw: "10,000+", lowerBound: 10_000 },
    });
  },
  mockCase: (kase) => mockTaskFixture("app-info", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.getAppReviews",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "app-reviews",
  makeCall: () =>
    provider.getAppReviews({
      store: "google_play",
      appId: "com.example.audit",
    }),
  assertSuccess: (result) => {
    expect(result.store).toBe("google_play");
    expect(result.rows[0]).toMatchObject({
      reviewId: "review-play-1",
      authorDisplayName: "Sample reviewer",
    });
  },
  mockCase: (kase) => mockTaskFixture("app-reviews", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.getTopChart",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "top-chart",
  makeCall: () =>
    provider.getTopChart({
      store: "google_play",
      chartId: "topselling_free",
    }),
  assertSuccess: (result) => {
    expect(result.store).toBe("google_play");
    expect(result.rows[0]?.appId).toBe("com.example.chart");
  },
  mockCase: (kase) => mockTaskFixture("top-chart", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.keywordsForApp",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "keywords-for-app",
  makeCall: () =>
    provider.keywordsForApp({
      store: "google_play",
      appId: "com.example.audit",
    }),
  assertSuccess: (result) => {
    expect(result[0]).toMatchObject({
      store: "google_play",
      keyword: "seo audit",
      rank: 3,
    });
  },
  mockCase: (kase) => mockLiveFixture("keywords-for-app", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.appCompetitors",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "app-competitors",
  makeCall: () =>
    provider.appCompetitors({
      store: "google_play",
      appId: "com.example.audit",
    }),
  assertSuccess: (result) => {
    expect(result[0]).toMatchObject({
      store: "google_play",
      appId: "com.example.competitor",
      sharedKeywordCount: 17,
    });
  },
  mockCase: (kase) => mockLiveFixture("app-competitors", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.appIntersection",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "app-intersection",
  makeCall: () =>
    provider.appIntersection({
      store: "google_play",
      appIds: ["com.example.audit", "com.example.competitor"],
    }),
  assertSuccess: (result) => {
    expect(result[0]).toMatchObject({
      store: "google_play",
      keyword: "rank tracker",
      ranksByAppId: {
        "com.example.audit": { rank: 2, absoluteRank: 3 },
        "com.example.competitor": { rank: 9, absoluteRank: 12 },
      },
    });
  },
  mockCase: (kase) => mockLiveFixture("app-intersection", kase),
});

providerContractTests({
  title: "DataForSeoAppDataProvider.bulkAppMetrics",
  fixtureProvider: FIXTURE_PROVIDER,
  fixtureOperation: "bulk-app-metrics",
  makeCall: () =>
    provider.bulkAppMetrics({
      store: "google_play",
      appIds: ["com.example.audit"],
    }),
  assertSuccess: (result) => {
    expect(result[0]).toMatchObject({
      store: "google_play",
      appId: "com.example.audit",
      metrics: { rankedKeywordCount: 17 },
    });
  },
  mockCase: (kase) => mockLiveFixture("bulk-app-metrics", kase),
});

describe("DataForSEO App Data provider", () => {
  beforeAll(() => vendorMockServer.listen({ onUnhandledRequest: "error" }));
  afterEach(() => {
    waits.length = 0;
    vendorMockServer.resetHandlers();
  });
  afterAll(() => vendorMockServer.close());

  it("exposes all nine operations without making a startup request", () => {
    expect(Object.keys(provider).sort()).toEqual(
      [
        "appCompetitors",
        "appIntersection",
        "bulkAppMetrics",
        "getAppInfo",
        "getAppReviews",
        "getTopChart",
        "keywordsForApp",
        "listMarkets",
        "searchApps",
      ].sort(),
    );
  });

  it.each([
    {
      operation: "search-apps",
      invoke: async () => {
        const result = await provider.searchApps({
          store: "app_store" as const,
          keyword: "app seo",
        });
        return result.rows[0]?.appId;
      },
      expected: "686449807",
    },
    {
      operation: "app-info",
      invoke: async () => {
        const result = await provider.getAppInfo({
          store: "app_store" as const,
          appId: "686449807",
        });
        expect(result.installs).toBeNull();
        return result.appId;
      },
      expected: "686449807",
    },
    {
      operation: "app-reviews",
      invoke: async () => {
        const result = await provider.getAppReviews({
          store: "app_store" as const,
          appId: "686449807",
        });
        return result.rows[0]?.reviewId;
      },
      expected: "review-apple-1",
    },
    {
      operation: "top-chart",
      invoke: async () => {
        const result = await provider.getTopChart({
          store: "app_store" as const,
          chartId: "top_free_ios",
        });
        return result.rows[0]?.appId;
      },
      expected: "686449807",
    },
  ])(
    "$operation consumes its App Store task success fixture",
    async ({ operation, invoke, expected }) => {
      mockTaskFixture(operation, "success", "success-app-store");
      await expect(invoke()).resolves.toBe(expected);
    },
  );

  it.each([
    {
      operation: "keywords-for-app",
      invoke: async () => {
        const result = await provider.keywordsForApp({
          store: "app_store" as const,
          appId: "686449807",
        });
        return result[0]?.keyword;
      },
      expected: "app seo",
    },
    {
      operation: "app-competitors",
      invoke: async () => {
        const result = await provider.appCompetitors({
          store: "app_store" as const,
          appId: "686449807",
        });
        return result[0]?.appId;
      },
      expected: "382617920",
    },
    {
      operation: "app-intersection",
      invoke: async () => {
        const result = await provider.appIntersection({
          store: "app_store" as const,
          appIds: ["686449807", "382617920"],
        });
        return result[0]?.keyword;
      },
      expected: "app seo",
    },
    {
      operation: "bulk-app-metrics",
      invoke: async () => {
        const result = await provider.bulkAppMetrics({
          store: "app_store" as const,
          appIds: ["686449807"],
        });
        return result[0]?.appId;
      },
      expected: "686449807",
    },
  ])(
    "$operation consumes its App Store Labs success fixture",
    async ({ operation, invoke, expected }) => {
      mockLiveFixture(operation, "success", "success-app-store");
      await expect(invoke()).resolves.toBe(expected);
    },
  );

  it("skips paid, bundle, and malformed search items from the fixture boundary", async () => {
    mockTaskFixture("search-apps", "success", "malformed-items");

    const result = await provider.searchApps({
      store: "google_play",
      keyword: "seo audit",
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        appId: "com.example.organic",
        position: 2,
        absolutePosition: 4,
        installs: { raw: "1M+", lowerBound: null },
      }),
    ]);
  });

  it("posts and polls Google Play search at one billed page and keeps organic apps only", async () => {
    let postBody: unknown;
    let getPath = "";
    mockTaskFlow(PLAY_RESULT, {
      onRequest: async (request) => {
        if (request.method === "POST") postBody = await request.json();
        else getPath = new URL(request.url).pathname;
      },
    });

    const result = await provider.searchApps({
      store: "google_play",
      keyword: "seo",
      depth: 999,
    });

    expect(postBody).toEqual([
      {
        keyword: "seo",
        location_code: 2840,
        language_code: "en",
        depth: APP_SEARCH_DEPTH_PLAY,
        priority: APP_DATA_STANDARD_PRIORITY,
      },
    ]);
    expect(getPath).toContain(
      "/app_data/google/app_searches/task_get/advanced/TASK_ID",
    );
    expect(result.totalCount).toBe(42);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      appId: "com.example.organic",
      position: 2,
      absolutePosition: 4,
      installs: { raw: "1,000,000+", lowerBound: 1_000_000 },
    });
  });

  it("uses the Apple namespace and never fabricates Apple installs", async () => {
    let postPath = "";
    let postBody: unknown;
    mockTaskFlow(APPLE_RESULT, {
      onRequest: async (request) => {
        if (request.method !== "POST") return;
        postPath = new URL(request.url).pathname;
        postBody = await request.json();
      },
    });

    const result = await provider.searchApps({
      store: "app_store",
      keyword: "seo",
      depth: 999,
    });

    expect(postPath).toContain("/app_data/apple/app_searches/task_post");
    expect(postBody).toEqual([
      expect.objectContaining({ depth: APP_SEARCH_DEPTH_APPLE, priority: 1 }),
    ]);
    expect(result.rows[0]?.installs).toBeNull();
  });

  it("normalizes sparse search fields and stops at the requested depth", async () => {
    mockTaskFlow([
      {
        datetime: null,
        items: [
          {
            type: "google_play_search_organic",
            rank_group: 1,
            rank_absolute: 1,
            app_id: "com.example.sparse",
            title: "Sparse app",
            price: {},
            installs: "999999999999999999999999999999+",
          },
          {
            type: "google_play_search_organic",
            rank_group: 2,
            rank_absolute: 2,
            app_id: "com.example.must-not-cross-depth",
            title: "Second app",
          },
        ],
      },
    ]);

    const result = await provider.searchApps({
      store: "google_play",
      keyword: "sparse",
      depth: 1,
    });

    expect(result).toMatchObject({
      totalCount: null,
      rows: [
        {
          appId: "com.example.sparse",
          price: { amount: null, currency: null, displayed: null },
          installs: {
            raw: "999999999999999999999999999999+",
            lowerBound: null,
          },
        },
      ],
    });
    expect(result.observationMeta.observedAt).toBe("2026-08-08T10:00:00.000Z");
  });

  it("normalizes Google Play app info and keeps only safe bounded fields", async () => {
    let postBody: unknown;
    mockTaskFlow(PLAY_INFO_RESULT, {
      onRequest: async (request) => {
        if (request.method === "POST") postBody = await request.json();
      },
    });

    const result = await provider.getAppInfo({
      store: "google_play",
      appId: "com.example.organic",
    });

    expect(postBody).toEqual([
      {
        app_id: "com.example.organic",
        location_code: 2840,
        language_code: "en",
        priority: APP_DATA_STANDARD_PRIORITY,
      },
    ]);
    expect(result).toMatchObject({
      appId: "com.example.organic",
      installs: { raw: "1,000,000+", lowerBound: 1_000_000 },
      developerWebsite: "https://example.test/",
      releasedAt: "2020-01-01T00:00:00.000Z",
      categories: ["Tools", "Productivity"],
      languages: null,
      advisories: null,
      tags: ["seo", "audit"],
    });
    expect(result.imageUrls).toEqual(["https://play.example.test/screenshot.png"]);
    expect(result.videoUrls).toEqual(["https://play.example.test/video.mp4"]);
  });

  it("keeps Apple-absent and Google page-only app info fields null", async () => {
    let getPath = "";
    mockTaskFlow(APPLE_INFO_RESULT, {
      onRequest: (request) => {
        if (request.method === "GET") getPath = new URL(request.url).pathname;
      },
    });

    const result = await provider.getAppInfo({ store: "app_store", appId: "123456789" });

    expect(getPath).toContain("/app_data/apple/app_info/task_get/advanced/TASK_ID");
    expect(result).toMatchObject({
      store: "app_store",
      installs: null,
      developerWebsite: null,
      releasedAt: null,
      videoUrls: null,
      languages: ["en", "fr"],
      advisories: ["4+"],
      tags: null,
    });
  });

  it("bounds sparse app-info lists and skips invalid boundary items", async () => {
    const tags = [
      42,
      "",
      "x".repeat(501),
      "duplicate",
      "duplicate",
      ...Array.from({ length: 100 }, (_, index) => `tag-${index}`),
    ];
    const videos = [
      42,
      "javascript:alert(1)",
      "https://video.example.test/duplicate",
      "https://video.example.test/duplicate",
      ...Array.from(
        { length: 100 },
        (_, index) => `https://video.example.test/${index}`,
      ),
    ];
    const references = [
      42,
      ...Array.from({ length: 100 }, (_, index) => ({
        app_id: `com.example.reference${index}`,
        title: `Reference ${index}`,
      })),
    ];
    mockTaskFlow([
      {
        datetime: "not-a-timestamp",
        items: [
          "not-an-object",
          { type: "google_play_info_organic" },
          {
            type: "google_play_info_organic",
            app_id: "com.example.sparse",
            title: "Sparse app",
            tags,
            videos,
            more_apps_by_developer: references,
          },
        ],
      },
    ]);

    const result = await provider.getAppInfo({
      store: "google_play",
      appId: "com.example.sparse",
    });

    expect(result).toMatchObject({
      url: null,
      description: null,
      rating: null,
      reviewCount: null,
      isFree: null,
      mainCategory: null,
      categories: [],
      developerName: null,
      developerWebsite: null,
      imageUrls: [],
      similarApps: [],
    });
    expect(result.tags).toHaveLength(100);
    expect(result.videoUrls).toHaveLength(100);
    expect(result.moreByDeveloper).toHaveLength(100);
    expect(result.moreByDeveloper[0]?.url).toBeNull();
    expect(result.observationMeta.observedAt).toBe("2026-08-08T10:00:00.000Z");
  });

  it("rejects app-info results without a valid organic item", async () => {
    mockTaskFlow([
      {
        items: [
          { type: "app_store_info_organic", app_id: "wrong", title: "Wrong store" },
          { type: "google_play_info_organic" },
        ],
      },
    ]);

    await expect(
      provider.getAppInfo({
        store: "google_play",
        appId: "com.example.missing",
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it("normalizes Google Play reviews, clamps depth, and drops private profile data", async () => {
    let postBody: unknown;
    let getPath = "";
    mockTaskFlow(PLAY_REVIEWS_RESULT, {
      onRequest: async (request) => {
        if (request.method === "POST") postBody = await request.json();
        else getPath = new URL(request.url).pathname;
      },
    });

    const result = await provider.getAppReviews({
      store: "google_play",
      appId: "com.example.organic",
      depth: 999,
    });

    expect(postBody).toEqual([
      {
        app_id: "com.example.organic",
        location_code: 2840,
        language_code: "en",
        depth: APP_REVIEWS_MAX_DEPTH,
        priority: APP_DATA_STANDARD_PRIORITY,
      },
    ]);
    expect(getPath).toContain(
      "/app_data/google/app_reviews/task_get/advanced/TASK_ID",
    );
    expect(result).toMatchObject({
      store: "google_play",
      appId: "com.example.organic",
      title: "Organic App",
      rating: 4.4,
      reviewCount: 123,
    });
    expect(result.rows).toEqual([
      {
        reviewId: "review-play-1",
        rating: 5,
        title: "Useful",
        text: "The audit is clear and practical.",
        authorDisplayName: "Helpful reviewer",
        reviewedAt: "2026-08-07T09:00:00.000Z",
      },
      {
        reviewId: "review-play-2",
        rating: 3,
        title: null,
        text: "It works, but the report could load faster.",
        authorDisplayName: null,
        reviewedAt: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("profile-id-must-not-cross-boundary");
    expect(JSON.stringify(result)).not.toContain("profiles.example.test");
  });

  it("uses the Apple reviews task namespace and preserves country-level inputs", async () => {
    let postPath = "";
    let postBody: unknown;
    mockTaskFlow(APPLE_REVIEWS_RESULT, {
      onRequest: async (request) => {
        if (request.method !== "POST") return;
        postPath = new URL(request.url).pathname;
        postBody = await request.json();
      },
    });

    const result = await provider.getAppReviews({
      store: "app_store",
      appId: "123456789",
      locationCode: 2826,
      languageCode: "en",
      depth: 25,
    });

    expect(postPath).toContain("/app_data/apple/app_reviews/task_post");
    expect(postBody).toEqual([
      expect.objectContaining({
        app_id: "123456789",
        location_code: 2826,
        language_code: "en",
        depth: 25,
      }),
    ]);
    expect(result).toMatchObject({
      store: "app_store",
      appId: "123456789",
      title: "Apple Organic App",
      rows: [
        {
          reviewId: "review-apple-1",
          authorDisplayName: "Store reviewer",
        },
      ],
    });
  });

  it("handles empty review buckets, private author shapes, and a page boundary", async () => {
    mockTaskFlow([
      { datetime: null, items: null },
      {
        items: [
          {
            type: "google_play_reviews_search",
            id: "missing-rating",
            rating: { value: null },
            review_text: "This row is intentionally skipped.",
          },
          {
            type: "google_play_reviews_search",
            id: "non-string-author",
            rating: { value: 5 },
            review_text: "First accepted row.",
            user_profile: { profile_name: 42 },
          },
          {
            type: "google_play_reviews_search",
            id: "empty-author",
            rating: { value: 4 },
            review_text: "Second accepted row.",
            user_profile: { profile_name: "   " },
          },
          {
            type: "google_play_reviews_search",
            id: "long-author",
            rating: { value: 3 },
            review_text: "Third accepted row.",
            user_profile: { profile_name: "x".repeat(301) },
          },
          {
            type: "google_play_reviews_search",
            id: "beyond-depth",
            rating: { value: 2 },
            review_text: "This row must not cross the requested depth.",
          },
        ],
      },
      {
        items: [
          {
            type: "google_play_reviews_search",
            id: "beyond-page",
            rating: { value: 1 },
            review_text: "The outer loop must stop before this bucket.",
          },
        ],
      },
    ]);

    const result = await provider.getAppReviews({
      store: "google_play",
      appId: "com.example.sparse",
      depth: 3,
    });

    expect(result).toMatchObject({
      title: null,
      rating: null,
      reviewCount: null,
      rows: [
        { reviewId: "non-string-author", authorDisplayName: null },
        { reviewId: "empty-author", authorDisplayName: null },
        { reviewId: "long-author", authorDisplayName: null },
      ],
    });
    expect(result.observationMeta.observedAt).toBe("2026-08-08T10:00:00.000Z");
  });

  it("passes chart and category identifiers to the Google Play app-list task", async () => {
    let postBody: unknown;
    let getPath = "";
    mockTaskFlow(PLAY_RESULT, {
      onRequest: async (request) => {
        if (request.method === "POST") postBody = await request.json();
        else getPath = new URL(request.url).pathname;
      },
    });

    const result = await provider.getTopChart({
      store: "google_play",
      chartId: "topselling_free",
      categoryId: "shopping",
      depth: 999,
    });

    expect(postBody).toEqual([
      {
        app_collection: "topselling_free",
        app_category: "shopping",
        location_code: 2840,
        language_code: "en",
        depth: APP_CHART_MAX_DEPTH,
        priority: APP_DATA_STANDARD_PRIORITY,
      },
    ]);
    expect(getPath).toContain(
      "/app_data/google/app_list/task_get/advanced/TASK_ID",
    );
    expect(result).toMatchObject({
      store: "google_play",
      chartId: "topselling_free",
      categoryId: "shopping",
      rows: [{ appId: "com.example.organic" }],
    });
  });

  it("returns a valid empty Apple chart page without fabricating a category", async () => {
    let postPath = "";
    let postBody: unknown;
    mockTaskFlow([], {
      onRequest: async (request) => {
        if (request.method !== "POST") return;
        postPath = new URL(request.url).pathname;
        postBody = await request.json();
      },
    });

    const result = await provider.getTopChart({
      store: "app_store",
      chartId: "top_free_ios",
      depth: 100,
    });

    expect(postPath).toContain("/app_data/apple/app_list/task_post");
    expect(postBody).toEqual([
      {
        app_collection: "top_free_ios",
        location_code: 2840,
        language_code: "en",
        depth: 100,
        priority: APP_DATA_STANDARD_PRIORITY,
      },
    ]);
    expect(result).toMatchObject({
      store: "app_store",
      chartId: "top_free_ios",
      categoryId: null,
      rows: [],
    });
  });

  it("normalizes Google Play keywords and clamps the Labs live row limit", async () => {
    let postPath = "";
    let postBody: unknown;
    mockLiveFlow(KEYWORDS_FOR_APP_RESULT, async (request) => {
      postPath = new URL(request.url).pathname;
      postBody = await request.json();
    });

    const result = await provider.keywordsForApp({
      store: "google_play",
      appId: "com.example.organic",
      limit: 999,
    });

    expect(postPath).toContain(
      "/dataforseo_labs/google/keywords_for_app/live",
    );
    expect(postBody).toEqual([
      {
        app_id: "com.example.organic",
        location_code: 2840,
        language_code: "en",
        limit: LABS_ROW_LIMIT,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        store: "google_play",
        appId: "com.example.organic",
        keyword: "seo audit",
        searchVolume: 1_200,
        rank: 3,
        absoluteRank: 5,
        lastUpdatedAt: "2026-08-02T07:00:00.000Z",
      }),
    ]);
  });

  it("normalizes App Store competitors and both metric families", async () => {
    let postPath = "";
    let postBody: unknown;
    mockLiveFlow(APP_COMPETITORS_RESULT, async (request) => {
      postPath = new URL(request.url).pathname;
      postBody = await request.json();
    });

    const result = await provider.appCompetitors({
      store: "app_store",
      appId: "686449807",
      locationCode: 2826,
      languageCode: "en",
      limit: 999,
    });

    expect(postPath).toContain(
      "/dataforseo_labs/apple/app_competitors/live",
    );
    expect(postBody).toEqual([
      {
        app_id: "686449807",
        location_code: 2826,
        language_code: "en",
        limit: LABS_ROW_LIMIT,
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        store: "app_store",
        appId: "382617920",
        averagePosition: 12.5,
        summedPosition: 250,
        sharedKeywordCount: 17,
        sharedKeywordMetrics: {
          firstPositionCount: 2,
          secondToThirdPositionCount: 3,
          fourthToTenthPositionCount: 5,
          eleventhToHundredthPositionCount: 7,
          rankedKeywordCount: 17,
          rankingKeywordSearchVolume: 4_200,
        },
        allKeywordMetrics: expect.objectContaining({
          rankedKeywordCount: 30,
          rankingKeywordSearchVolume: 9_000,
        }),
      }),
    ]);
  });

  it("clamps app intersection ids and rows while preserving missing ranks", async () => {
    const requestedAppIds = Array.from(
      { length: INTERSECTION_MAX_APPS + 5 },
      (_, index) => `com.example.app${index + 1}`,
    );
    let postPath = "";
    let postBody: unknown;
    mockLiveFlow(APP_INTERSECTION_RESULT, async (request) => {
      postPath = new URL(request.url).pathname;
      postBody = await request.json();
    });

    const result = await provider.appIntersection({
      store: "google_play",
      appIds: requestedAppIds,
      limit: 999,
    });

    expect(postPath).toContain(
      "/dataforseo_labs/google/app_intersection/live",
    );
    const body = (postBody as Array<Record<string, unknown>>)[0];
    expect(body).toMatchObject({
      location_code: 2840,
      language_code: "en",
      limit: LABS_ROW_LIMIT,
    });
    expect(Object.keys(body?.app_ids as object)).toHaveLength(
      INTERSECTION_MAX_APPS,
    );
    expect(body?.app_ids).toMatchObject({
      "1": "com.example.app1",
      "20": "com.example.app20",
    });
    expect(result[0]).toMatchObject({
      store: "google_play",
      keyword: "rank tracker",
      searchVolume: 880,
      lastUpdatedAt: "2026-08-04T09:00:00.000Z",
      ranksByAppId: {
        "com.example.app1": { rank: 2, absoluteRank: 3 },
        "com.example.app2": { rank: 9, absoluteRank: 12 },
        "com.example.app3": { rank: null, absoluteRank: null },
      },
    });
    expect(result[0]?.ranksByAppId).not.toHaveProperty("com.example.app21");
  });

  it("rejects non-US or non-English app intersection before HTTP", async () => {
    let requests = 0;
    vendorMockServer.use(
      http.all("*", () => {
        requests += 1;
        return HttpResponse.json(okEnvelope([]) as JsonBodyType);
      }),
    );

    await expect(
      provider.appIntersection({
        store: "google_play",
        appIds: ["app.one", "app.two"],
        locationCode: 2826,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    await expect(
      provider.appIntersection({
        store: "app_store",
        appIds: ["123", "456"],
        languageCode: "fr",
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    expect(requests).toBe(0);
  });

  it("clamps bulk App Store metrics to fifty app ids", async () => {
    const requestedAppIds = Array.from(
      { length: BULK_METRICS_MAX_APPS + 5 },
      (_, index) => String(686_449_807 + index),
    );
    let postPath = "";
    let postBody: unknown;
    mockLiveFlow(BULK_APP_METRICS_RESULT, async (request) => {
      postPath = new URL(request.url).pathname;
      postBody = await request.json();
    });

    const result = await provider.bulkAppMetrics({
      store: "app_store",
      appIds: requestedAppIds,
    });

    expect(postPath).toContain(
      "/dataforseo_labs/apple/bulk_app_metrics/live",
    );
    const body = (postBody as Array<Record<string, unknown>>)[0];
    expect(body).toMatchObject({
      location_code: 2840,
      language_code: "en",
    });
    expect(body?.app_ids).toHaveLength(BULK_METRICS_MAX_APPS);
    expect(body?.app_ids).not.toContain(requestedAppIds[50]);
    expect(result).toEqual([
      expect.objectContaining({
        store: "app_store",
        appId: "686449807",
        metrics: expect.objectContaining({
          rankedKeywordCount: 17,
          rankingKeywordSearchVolume: 4_200,
        }),
      }),
    ]);
  });

  it("normalizes sparse Labs rows and enforces every row boundary", async () => {
    const googleMetrics = { google_play_search_organic: APPLE_METRICS };

    mockLiveFlow([
      { items: null },
      {
        items: [
          {
            keyword_data: {
              keyword: "sparse keyword",
              keyword_info: {
                search_volume: null,
                last_updated_time: null,
              },
            },
            ranked_serp_element: {
              serp_item: { rank_group: null, rank_absolute: null },
              last_updated_time: null,
            },
          },
          {
            keyword_data: {
              keyword: "beyond limit",
              keyword_info: {},
            },
            ranked_serp_element: { serp_item: {} },
          },
        ],
      },
    ]);
    const keywords = await provider.keywordsForApp({
      store: "google_play",
      appId: "com.example.sparse",
      limit: 1,
    });
    expect(keywords).toEqual([
      expect.objectContaining({
        searchVolume: null,
        rank: null,
        absoluteRank: null,
        lastUpdatedAt: null,
      }),
    ]);
    expect(keywords[0]?.observationMeta.observedAt).toBe(
      "2026-08-08T10:00:00.000Z",
    );

    mockLiveFlow([
      { items: null },
      {
        items: [
          {
            app_id: "com.example.competitor",
            avg_position: null,
            sum_position: null,
            intersections: 0,
            competitor_metrics: googleMetrics,
            full_metrics: googleMetrics,
          },
          {
            app_id: "com.example.beyond-limit",
            intersections: 0,
            competitor_metrics: googleMetrics,
            full_metrics: googleMetrics,
          },
        ],
      },
    ]);
    const competitors = await provider.appCompetitors({
      store: "google_play",
      appId: "com.example.sparse",
      limit: 1,
    });
    expect(competitors).toEqual([
      expect.objectContaining({
        averagePosition: null,
        summedPosition: null,
      }),
    ]);

    mockLiveFlow([
      { items: null },
      {
        items: [
          {
            keyword_data: {
              keyword: "sparse intersection",
              keyword_info: {
                search_volume: null,
                last_updated_time: null,
              },
              serp_info: null,
            },
            intersection_result: {},
          },
          {
            keyword_data: {
              keyword: "beyond intersection limit",
              keyword_info: {},
            },
            intersection_result: {},
          },
        ],
      },
    ]);
    const intersections = await provider.appIntersection({
      store: "google_play",
      appIds: ["com.example.one", "com.example.two"],
      limit: 1,
    });
    expect(intersections).toEqual([
      expect.objectContaining({ searchVolume: null, lastUpdatedAt: null }),
    ]);
    expect(intersections[0]?.observationMeta.observedAt).toBe(
      "2026-08-08T10:00:00.000Z",
    );

    mockLiveFlow([
      { items: null },
      {
        items: Array.from({ length: BULK_METRICS_MAX_APPS + 1 }, (_, index) => ({
          app_id: `com.example.bulk${index}`,
          metrics: googleMetrics,
        })),
      },
    ]);
    const bulk = await provider.bulkAppMetrics({
      store: "google_play",
      appIds: Array.from(
        { length: BULK_METRICS_MAX_APPS },
        (_, index) => `com.example.bulk${index}`,
      ),
    });
    expect(bulk).toHaveLength(BULK_METRICS_MAX_APPS);
  });

  it("rejects a Labs metric row without the selected store family", async () => {
    mockLiveFlow([
      {
        items: [
          {
            app_id: "com.example.missing-metrics",
            intersections: 1,
            competitor_metrics: {},
            full_metrics: { google_play_search_organic: APPLE_METRICS },
          },
        ],
      },
    ]);

    await expect(
      provider.appCompetitors({
        store: "google_play",
        appId: "com.example.source",
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it.each([
    {
      operation: "searchApps",
      result: PLAY_RESULT,
      invoke: () =>
        provider.searchApps({ store: "google_play", keyword: "seo" }),
    },
    {
      operation: "getAppInfo",
      result: PLAY_INFO_RESULT,
      invoke: () =>
        provider.getAppInfo({
          store: "google_play",
          appId: "com.example.organic",
        }),
    },
    {
      operation: "getAppReviews",
      result: PLAY_REVIEWS_RESULT,
      invoke: () =>
        provider.getAppReviews({
          store: "google_play",
          appId: "com.example.organic",
        }),
    },
    {
      operation: "getTopChart",
      result: PLAY_RESULT,
      invoke: () =>
        provider.getTopChart({
          store: "google_play",
          chartId: "topselling_free",
        }),
    },
  ])(
    "$operation captures and sums task POST/GET envelope costs",
    async ({ result, invoke }) => {
      mockTaskFlow(result, { successCostUsd: 0.002 });

      const { costMicros } = await captureVendorCost(async () => {
        await invoke();
      });

      expect(costMicros).toBe(usdToMicros(0.003));
    },
  );

  it.each([
    {
      operation: "keywordsForApp",
      result: KEYWORDS_FOR_APP_RESULT,
      invoke: () =>
        provider.keywordsForApp({
          store: "google_play",
          appId: "com.example.organic",
        }),
    },
    {
      operation: "appCompetitors",
      result: APP_COMPETITORS_RESULT,
      invoke: () =>
        provider.appCompetitors({
          store: "app_store",
          appId: "686449807",
        }),
    },
    {
      operation: "appIntersection",
      result: APP_INTERSECTION_RESULT,
      invoke: () =>
        provider.appIntersection({
          store: "google_play",
          appIds: ["com.example.app1", "com.example.app2"],
        }),
    },
    {
      operation: "bulkAppMetrics",
      result: BULK_APP_METRICS_RESULT,
      invoke: () =>
        provider.bulkAppMetrics({
          store: "app_store",
          appIds: ["686449807"],
        }),
    },
  ])(
    "$operation captures its Labs live envelope cost",
    async ({ result, invoke }) => {
      mockLiveFlow(result, undefined, 0.011);

      const { costMicros } = await captureVendorCost(async () => {
        await invoke();
      });

      expect(costMicros).toBe(usdToMicros(0.011));
    },
  );

  it.each(["task-handed", "in-queue"])(
    "re-polls a %s task through the injected wait seam",
    async (pendingCase) => {
      let getCount = 0;
      vendorMockServer.use(
        http.all("*", ({ request }) => {
          if (request.method === "POST") {
            return fixtureResponse("search-apps", "post-success");
          }
          getCount += 1;
          return fixtureResponse(
            "search-apps",
            getCount === 1 ? pendingCase : "success-google-play",
          );
        }),
      );
      await expect(
        provider.searchApps({ store: "google_play", keyword: "seo" }),
      ).resolves.toMatchObject({ store: "google_play" });
      expect(waits).toEqual([0]);
    },
  );

  it("re-polls a newly accepted task before task_get can see its id", async () => {
    let getCount = 0;
    vendorMockServer.use(
      http.all("*", ({ request }) => {
        if (request.method === "POST") {
          return fixtureResponse("search-apps", "post-success");
        }
        getCount += 1;
        return fixtureResponse(
          "search-apps",
          getCount === 1 ? "not-ready" : "success-google-play",
        );
      }),
    );

    await expect(
      provider.searchApps({ store: "google_play", keyword: "seo" }),
    ).resolves.toMatchObject({ store: "google_play" });
    expect(waits).toEqual([0]);
  });

  it("gives up as unavailable when task_get never sees the accepted id", async () => {
    vendorMockServer.use(
      http.all("*", ({ request }) =>
        request.method === "POST"
          ? fixtureResponse("search-apps", "post-success")
          : fixtureResponse("search-apps", "not-ready"),
      ),
    );

    await expect(
      provider.searchApps({ store: "google_play", keyword: "seo" }),
    ).rejects.toThrow("task_get remained in queue after 2 polls");
    expect(waits).toEqual([0]);
  });

  it("does not re-poll a malformed task_get response", async () => {
    vendorMockServer.use(
      http.all("*", ({ request }) =>
        request.method === "POST"
          ? fixtureResponse("search-apps", "post-success")
          : fixtureResponse("search-apps", "malformed"),
      ),
    );

    await expect(
      provider.searchApps({ store: "google_play", keyword: "seo" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    expect(waits).toEqual([]);
  });

  it("rejects impossible task and live status transitions", async () => {
    mockStaticEnvelope({ ...CREATED, tasks: [] });
    await expect(
      provider.searchApps({ store: "google_play", keyword: "no task" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);

    mockStaticEnvelope(okEnvelope([]));
    await expect(
      provider.searchApps({ store: "google_play", keyword: "immediate" }),
    ).resolves.toMatchObject({ totalCount: null, rows: [] });

    mockStaticEnvelope(IN_QUEUE);
    await expect(
      provider.searchApps({ store: "google_play", keyword: "queued post" }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);

    mockStaticEnvelope({
      ...CREATED,
      tasks: [{ ...CREATED.tasks[0], id: undefined }],
    });
    await expect(
      provider.searchApps({ store: "google_play", keyword: "missing id" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);

    vendorMockServer.use(
      http.all("*", ({ request }) =>
        HttpResponse.json(
          (request.method === "POST" ? CREATED : { ...CREATED, tasks: [] }) as JsonBodyType,
        ),
      ),
    );
    await expect(
      provider.searchApps({ store: "google_play", keyword: "empty get" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);

    vendorMockServer.use(
      http.all("*", () => HttpResponse.json(CREATED as JsonBodyType)),
    );
    await expect(
      provider.searchApps({ store: "google_play", keyword: "created get" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);

    waits.length = 0;
    vendorMockServer.use(
      http.all("*", ({ request }) =>
        HttpResponse.json(
          (request.method === "POST" ? CREATED : IN_QUEUE) as JsonBodyType,
        ),
      ),
    );
    await expect(
      provider.searchApps({ store: "google_play", keyword: "stuck get" }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
    expect(waits).toEqual([0]);

    mockStaticEnvelope(CREATED);
    await expect(
      provider.keywordsForApp({
        store: "google_play",
        appId: "com.example.created-live",
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);

    mockStaticEnvelope(IN_QUEUE);
    await expect(
      provider.keywordsForApp({
        store: "google_play",
        appId: "com.example.queued-live",
      }),
    ).rejects.toBeInstanceOf(VendorUnavailableError);
  });

  it("uses bounded production polling and clock defaults when seams are omitted", async () => {
    const defaultProvider = createDataForSeoAppDataProvider({
      login: "sandbox-login",
      password: "sandbox-password",
      baseUrl: "https://dataforseo.mock/v3",
      timeoutMs: 60,
      maxRetries: 0,
      backoffBaseMs: 1,
      random: () => 0,
    });
    let getCount = 0;
    vendorMockServer.use(
      http.all("*", ({ request }) => {
        if (request.method === "POST") {
          return HttpResponse.json(CREATED as JsonBodyType);
        }
        getCount += 1;
        return HttpResponse.json(
          (getCount === 1
            ? IN_QUEUE
            : okEnvelope([{ items: [] }])) as JsonBodyType,
        );
      }),
    );

    const result = await defaultProvider.searchApps({
      store: "google_play",
      keyword: "default seams",
    });

    expect(getCount).toBe(2);
    expect(result.observationMeta.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("parses numeric install ranges without inventing abbreviated counts", () => {
    expect(normalizeInstallRange(" 5,000+ ")).toEqual({
      raw: "5,000+",
      lowerBound: 5_000,
    });
    expect(normalizeInstallRange("1M+")).toEqual({
      raw: "1M+",
      lowerBound: null,
    });
    expect(normalizeInstallRange("   ")).toBeNull();
    expect(normalizeInstallRange("999999999999999999999999999999+")).toEqual({
      raw: "999999999999999999999999999999+",
      lowerBound: null,
    });
    expect(normalizeInstallRange(null)).toBeNull();
  });

  it("rejects invalid input through the provider error taxonomy before HTTP", async () => {
    let requests = 0;
    vendorMockServer.use(
      http.all("*", () => {
        requests += 1;
        return HttpResponse.json(CREATED as JsonBodyType);
      }),
    );
    await expect(
      provider.searchApps({ store: "google_play", keyword: "" }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    expect(requests).toBe(0);
  });
});
