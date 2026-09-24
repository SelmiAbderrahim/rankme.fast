import { describe, expect, it } from "vitest";
import {
  reportCatalogCopy,
  reportCopy,
  reportIsoDateTime,
  reportScalar,
  reportSourceDate,
  reportSourceNote,
  reportSourceVersion,
  reportTable,
  reportWindow,
  stableSortText,
} from "./adapter-helpers.js";
import {
  createReportDownloadHeaders,
  createSafeReportFilename,
} from "./download-headers.js";
import { stableReportJson } from "./stable-json.js";

describe("report adapter canonical helpers", () => {
  it("localizes core and catalog copy across the supported dictionaries", () => {
    expect(reportCopy("en", "labels.observation")).toBeTruthy();
    expect(reportCopy("ar", "labels.observation")).toBeTruthy();
    expect(reportCatalogCopy("en", "auditRun", "title")).toBeTruthy();
    expect(reportCatalogCopy("fr", "auditRun", "description")).toBeTruthy();
    expect(reportCatalogCopy("zh", "auditRun", "bound")).toBeTruthy();
  });

  it("normalizes instants, source windows, immutable versions, and provenance variants", () => {
    expect(reportIsoDateTime("2026-08-08")).toBe("2026-08-08T00:00:00.000Z");
    expect(reportIsoDateTime("2026-08-08T10:00:00+02:00")).toBe(
      "2026-08-08T08:00:00.000Z",
    );
    expect(reportIsoDateTime(new Date("2026-08-08T10:00:00.000Z"))).toBe(
      "2026-08-08T10:00:00.000Z",
    );
    expect(() => reportIsoDateTime("not-a-date")).toThrow(RangeError);
    expect(reportWindow("2026-08-08", 3)).toEqual({
      from: "2026-08-06T00:00:00.000Z",
      to: "2026-08-08T00:00:00.000Z",
    });
    expect(reportSourceVersion("audit", { b: 2, a: 1 })).toMatch(
      /^audit:[a-f0-9]{64}$/u,
    );
    expect(reportSourceVersion("audit", { b: 2, a: 1 })).toBe(
      reportSourceVersion("audit", { a: 1, b: 2 }),
    );

    expect(
      reportSourceDate({
        id: "observed",
        label: "Observed",
        kind: "provider_observation",
        observedAt: "2026-08-08",
        sourceNoteKey: "source.provider",
        lagDays: 2,
        freshness: "cached",
        cachedAt: "2026-08-09",
      }),
    ).toEqual({
      id: "observed",
      label: "Observed",
      kind: "provider_observation",
      observedAt: "2026-08-08T00:00:00.000Z",
      sourceNoteKey: "source.provider",
      lagDays: 2,
      freshness: "cached",
      cachedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(
      reportSourceDate({
        id: "window",
        label: "Window",
        kind: "first_party_observation",
        from: "2026-08-01",
        to: "2026-08-08",
        sourceNoteKey: "source.window",
      }),
    ).toMatchObject({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-08T00:00:00.000Z",
    });
  });

  it("maps every scalar kind and preserves per-cell or row-level provenance", () => {
    expect(reportScalar(null, "string")).toEqual({ type: "null", value: null });
    expect(reportScalar({ unavailable: "Not observed" }, "string")).toEqual({
      type: "unavailable",
      value: null,
      reason: "Not observed",
    });
    expect(
      reportScalar(new Date("2026-08-08T00:00:00.000Z"), "string"),
    ).toEqual({
      type: "date",
      value: "2026-08-08T00:00:00.000Z",
    });
    expect(reportScalar("2026-08-08", "date")).toEqual({
      type: "date",
      value: "2026-08-08T00:00:00.000Z",
    });
    expect(reportScalar("https://example.test/a", "url")).toEqual({
      type: "url",
      value: "https://example.test/a",
    });
    expect(reportScalar(42, "number")).toEqual({ type: "number", value: 42 });
    expect(reportScalar(false, "boolean")).toEqual({
      type: "boolean",
      value: false,
    });
    expect(reportScalar("42", "number")).toEqual({
      type: "string",
      value: "42",
    });

    const table = reportTable({
      id: "mixed-table",
      columns: [
        { key: "name", label: "Name", valueType: "string" },
        { key: "score", label: "Score", valueType: "number", unit: "points" },
        { key: "missing", label: "Missing", valueType: "string" },
      ],
      rows: [
        {
          id: "row-1",
          values: ["Example", 91],
          sourceDateId: "row-source",
          sourceDateIds: ["cell-source", undefined],
        },
        { values: ["No id", true, { unavailable: "Unavailable" }] },
      ],
    });
    expect(table.columns[1]).toEqual({
      key: "score",
      label: "Score",
      valueType: "number",
      unit: "points",
    });
    expect(table.rows[0]).toMatchObject({
      id: "row-1",
      cells: [
        { columnKey: "name", sourceDateId: "cell-source" },
        { columnKey: "score", sourceDateId: "row-source" },
        { columnKey: "missing", value: { type: "null", value: null } },
      ],
    });
    expect(table.rows[1]?.id).toBeUndefined();
  });

  it("builds optional source notes and supplies a total deterministic text ordering", () => {
    expect(
      reportSourceNote({
        id: "note",
        sourceDateId: "observed",
        methodology: "Stored evidence only.",
      }),
    ).toEqual({
      type: "source_note",
      id: "note",
      sourceDateId: "observed",
      methodology: "Stored evidence only.",
    });
    expect(
      reportSourceNote({
        id: "warning",
        sourceDateId: "observed",
        methodology: "Stored evidence only.",
        coverageWarning: "Partial coverage.",
      }),
    ).toHaveProperty("coverageWarning", "Partial coverage.");
    expect(stableSortText("a", "b")).toBe(-1);
    expect(stableSortText("b", "a")).toBe(1);
    expect(stableSortText("a", "a")).toBe(0);
  });

  it("serializes recursively sorted objects without reordering arrays", () => {
    expect(
      stableReportJson({ z: 1, a: { y: 2, b: 1 }, rows: [{ z: 2, a: 1 }] }),
    ).toBe('{"a":{"b":1,"y":2},"rows":[{"a":1,"z":2}],"z":1}\n');
    expect(stableReportJson([3, { b: true, a: null }])).toBe(
      '[3,{"a":null,"b":true}]\n',
    );
  });
});

describe("safe report download headers", () => {
  it("bounds Unicode and ASCII names and neutralizes path, control, bidi, and header injection", () => {
    const safe = createSafeReportFilename({
      stem: '../\u202Eتقرير/"\r\n<script> Résumé ' + "界".repeat(100),
      sourceDate: "2026-08-08",
      format: "pdf",
      duplicateIndex: 3.9,
    });
    expect(safe.filename).toMatch(/^rankmefast-/u);
    expect(safe.filename).toMatch(/-2026-08-08-3\.pdf$/u);
    expect(safe.asciiFilename).toMatch(/^[\x20-\x7e]+$/u);
    expect(Buffer.byteLength(safe.filename, "utf8")).toBeLessThanOrEqual(96);
    expect(safe.contentDisposition).not.toMatch(/[\r\n\u202e]/u);
    expect(safe.contentDisposition).toContain("filename*=UTF-8''");
  });

  it("falls back for empty stems/dates and emits an allowlisted frozen header set", () => {
    const safe = createSafeReportFilename({
      stem: "...///",
      sourceDate: "not-a-date",
      format: "json",
      duplicateIndex: 1,
    });
    expect(safe.filename).toBe("rankmefast-report-undated.json");
    expect(
      createSafeReportFilename({
        stem: "it's (really)! safe",
        sourceDate: "2026-08-08",
        format: "txt",
      }).contentDisposition,
    ).toContain("%27");
    expect(
      createSafeReportFilename({
        stem: "界界",
        sourceDate: "2026-08-08",
        format: "csv",
      }).asciiFilename,
    ).toBe("rankmefast-report-2026-08-08.csv");
    const headers = createReportDownloadHeaders({
      filename: safe,
      format: "json",
      byteLength: 123,
    });
    expect(headers).toEqual({
      "Cache-Control": "private, no-store",
      "Content-Disposition": safe.contentDisposition,
      "Content-Length": "123",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    expect(Object.isFrozen(headers)).toBe(true);
    expect(() =>
      createReportDownloadHeaders({
        filename: safe,
        format: "json",
        byteLength: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createReportDownloadHeaders({
        filename: safe,
        format: "json",
        byteLength: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(RangeError);
  });
});
