import { describe, expect, it } from "vitest";
import type { ReportSnapshotHydrated } from "./report-snapshot.model.js";
import {
  plainAuditSummarySnapshot,
  selectAuditSummaryLocale,
  type PlainAuditSummarySnapshot,
} from "./summary.selection.js";

const createdAt = new Date("2026-08-25T10:00:00.000Z");

function summary(overrides: Record<string, unknown> = {}) {
  return {
    text: "English summary.",
    locale: "en",
    model: "model-en",
    truncated: false,
    createdAt,
    ...overrides,
  };
}

describe("audit summary locale selection boundaries", () => {
  it("accepts hydrated and already-plain snapshots", () => {
    const plain: PlainAuditSummarySnapshot = { aiSummary: summary() };
    expect(plainAuditSummarySnapshot(plain)).toBe(plain);
    expect(
      plainAuditSummarySnapshot({
        toObject: () => plain,
      } as unknown as ReportSnapshotHydrated),
    ).toBe(plain);
  });

  it("rejects every malformed summary boundary without cross-locale fallback", () => {
    const malformed = [
      undefined,
      "not-an-object",
      summary({ locale: "fr" }),
      summary({ text: 1 }),
      summary({ model: 1 }),
      summary({ truncated: "no" }),
      summary({ createdAt: null }),
      summary({ createdAt: undefined }),
      summary({ createdAt: "" }),
      summary({ createdAt: "not-a-date" }),
    ];

    for (const value of malformed) {
      expect(
        selectAuditSummaryLocale(
          { aiSummaryVariantsByLocale: { en: value } },
          "en",
        ),
      ).toEqual({
        status: "idle",
        aiSummary: null,
        requestedLocale: "en",
        availableLocales: [],
      });
    }
  });

  it("accepts valid Date and serialized-date values and sorts all seven variants", () => {
    const state = selectAuditSummaryLocale(
      {
        aiSummaryVariantsByLocale: {
          zh: summary({
            locale: "zh",
            text: "zh",
            createdAt: createdAt.toISOString(),
          }),
          ru: summary({ locale: "ru", text: "ru" }),
          fr: summary({ locale: "fr", text: "fr" }),
          es: summary({ locale: "es", text: "es" }),
          en: summary(),
          de: summary({ locale: "de", text: "de" }),
          ar: summary({ locale: "ar", text: "ar" }),
        },
        aiSummaryJobsByLocale: {
          en: { locale: "en", status: "running" },
        },
      },
      "en",
    );

    expect(state).toEqual({
      status: "running",
      aiSummary: {
        text: "English summary.",
        locale: "en",
        model: "model-en",
        truncated: false,
        createdAt: createdAt.toISOString(),
      },
      requestedLocale: "en",
      availableLocales: ["ar", "de", "en", "es", "fr", "ru", "zh"],
    });
  });

  it("accepts only an exact valid job status and otherwise infers the honest state", () => {
    const invalidJobs = [
      undefined,
      { locale: "fr", status: "running" },
      { locale: "en", status: 1 },
      { locale: "en", status: "unknown" },
    ];
    for (const job of invalidJobs) {
      expect(
        selectAuditSummaryLocale(
          {
            aiSummary: summary(),
            aiSummaryJobsByLocale: { en: job },
          },
          "en",
        ).status,
      ).toBe("succeeded");
    }

    expect(
      selectAuditSummaryLocale(
        {
          aiSummary: summary(),
          aiSummaryJob: { locale: "en", status: "failed" },
        },
        "en",
      ).status,
    ).toBe("failed");
  });

  it("includes only a valid legacy locale in availability and de-duplicates it", () => {
    const legacyValues = [
      undefined,
      "not-an-object",
      summary({ locale: "it" }),
      summary({ text: 1 }),
    ];
    for (const aiSummary of legacyValues) {
      expect(
        selectAuditSummaryLocale({ aiSummary }, "fr").availableLocales,
      ).toEqual([]);
    }

    expect(
      selectAuditSummaryLocale(
        {
          aiSummaryVariantsByLocale: { en: summary() },
          aiSummary: summary(),
        },
        "fr",
      ).availableLocales,
    ).toEqual(["en"]);
  });
});
