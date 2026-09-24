import { createHash } from "node:crypto";
import { rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "../security/json-ld.js";
import {
  REPORT_FORMAT_EXTENSIONS,
  REPORT_NATIVE_MEDIA_TYPES,
  type ReportDocumentV1,
  type ReportRenderedResult,
} from "./contracts.js";
import {
  REPORT_PDF_MARGIN,
  addReportPdfPage,
  containsReportArabic,
  createReportPdfContext,
  drawReportPdfParagraph,
  ensureReportPdfSpace,
  prepareReportPdfText,
  readReportPdfFont,
  reportPdfFontFiles,
  shapeReportArabic,
  toVisualReportRtlLine,
  wrapReportPdfText,
} from "./pdf-support.js";
import {
  ReportRenderRefusal,
  assertReportDocumentRenderable,
  renderReportCsv,
  renderReportDocument,
  renderReportJson,
  renderReportPdf,
} from "./renderers.js";

const OBSERVED_AT = "2026-08-08T10:00:00.000Z";
const SNAPSHOT_AT = "2026-08-09T10:00:00.000Z";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function richDocument(
  locale: ReportDocumentV1["locale"] = "en",
): ReportDocumentV1 {
  const columns = Array.from({ length: 9 }, (_, index) => ({
    key: `column-${index + 1}`,
    label: `Column ${index + 1}`,
    valueType: "string" as const,
    ...(index === 1 ? { unit: "points" } : {}),
  }));
  const rows = Array.from({ length: 42 }, (_, rowIndex) => ({
    id: `row-${rowIndex + 1}`,
    cells: columns.map((column, columnIndex) => ({
      columnKey: column.key,
      value:
        columnIndex === 0
          ? {
              type: "string" as const,
              value:
                rowIndex === 0
                  ? "=SUM(A1:A2), remains inert"
                  : `Stored value ${rowIndex + 1}`,
            }
          : columnIndex === 1
            ? { type: "number" as const, value: rowIndex }
            : columnIndex === 2
              ? { type: "boolean" as const, value: rowIndex % 2 === 0 }
              : columnIndex === 3
                ? { type: "null" as const, value: null }
                : columnIndex === 4
                  ? {
                      type: "unavailable" as const,
                      value: null,
                      reason: "Not observed",
                    }
                  : columnIndex === 5
                    ? { type: "date" as const, value: OBSERVED_AT }
                    : columnIndex === 6
                      ? {
                          type: "url" as const,
                          value: `https://example.test/${rowIndex + 1}`,
                        }
                      : {
                          type: "string" as const,
                          value:
                            "A long stored cell that wraps across the available width",
                        },
      ...(columnIndex === 0 && rowIndex === 0
        ? { sourceDateId: "observed" }
        : {}),
    })),
  }));
  const logoBytes = Buffer.from(PNG_BASE64, "base64");
  return {
    schema: "rankme.report",
    schemaVersion: 1,
    kind: "audit.run",
    kindVersion: 1,
    locale,
    title:
      locale === "ar"
        ? "تقرير محفوظ"
        : locale === "zh"
          ? "已存储报告"
          : "Stored report",
    subject: [{ label: "Site", value: "example.test" }],
    selection: [{ label: "Scope", value: "All stored evidence" }],
    sourceDates: [
      {
        id: "observed",
        label: "Provider observation",
        kind: "provider_observation",
        observedAt: OBSERVED_AT,
        sourceNoteKey: "source.provider",
        freshness: "cached",
      },
      {
        id: "window",
        label: "First-party window",
        kind: "first_party_observation",
        from: "2026-08-01T00:00:00.000Z",
        to: OBSERVED_AT,
        sourceNoteKey: "source.window",
      },
    ],
    completeness: {
      state: "complete",
      selectedItems: rows.length,
      representedItems: rows.length,
      bound: "All selected stored rows",
    },
    branding: {
      mode: "white_label",
      companyName: locale === "ar" ? "شركة الاختبار" : "Example Company",
      accentColor: "#b5321e",
      logo: {
        mediaType: "image/png",
        bytesBase64: PNG_BASE64,
        width: 1,
        height: 1,
        sha256: createHash("sha256").update(logoBytes).digest("hex"),
      },
    },
    blocks: [
      ...Array.from({ length: 6 }, (_, index) => ({
        type: "heading" as const,
        id: `heading-${index + 1}`,
        level: index + 1,
        text: `Heading ${index + 1}`,
      })),
      { type: "prose", id: "body", tone: "body", text: "Stored body copy." },
      {
        type: "prose",
        id: "warning",
        tone: "warning",
        text: "Stored warning copy.",
      },
      {
        type: "kpi_group",
        id: "kpis",
        items: [
          {
            id: "score",
            label: "Score",
            value: { type: "number", value: 91 },
            unit: "points",
            sourceDateId: "observed",
          },
          {
            id: "available",
            label: "Available",
            value: { type: "boolean", value: true },
          },
        ],
      },
      {
        type: "key_value",
        id: "details",
        items: [
          { id: "empty", label: "Empty", value: { type: "null", value: null } },
          {
            id: "missing",
            label: "Missing",
            value: { type: "unavailable", value: null, reason: "Not observed" },
          },
        ],
      },
      {
        type: "findings",
        id: "findings",
        items: [
          {
            id: "fix-finding",
            ruleKey: "fix-rule",
            bucket: "fix_now",
            severity: "high",
            title: "Fix this",
            why: "Stored evidence explains why.",
            fix: "Apply the stored fix.",
            affectedUrls: ["https://example.test/page"],
            evidence: ["Evidence one"],
            sourceDateId: "observed",
          },
          {
            id: "passed-finding",
            ruleKey: "pass-rule",
            bucket: "passed",
            severity: "info",
            title: "Passed",
            why: "Stored evidence passed.",
            pass: "Keep this behavior.",
            affectedUrls: [],
            evidence: [],
          },
        ],
      },
      { type: "table", id: "wide-table", columns, rows },
      {
        type: "time_series",
        id: "trend",
        series: [
          {
            id: "score-trend",
            label: "Score",
            sourceDateId: "window",
            points: [
              { timestamp: "2026-08-01T00:00:00.000Z", value: 80 },
              { timestamp: OBSERVED_AT, value: null },
            ],
          },
        ],
        tableFallback: {
          columns: [
            { key: "date", label: "Date", valueType: "date" },
            { key: "score", label: "Score", valueType: "number" },
          ],
          rows: [
            {
              cells: [
                {
                  columnKey: "date",
                  value: { type: "date", value: OBSERVED_AT },
                },
                {
                  columnKey: "score",
                  value: { type: "number", value: 91 },
                  sourceDateId: "window",
                },
              ],
            },
          ],
        },
      },
      {
        type: "source_note",
        id: "source-note",
        sourceDateId: "observed",
        methodology: "Uses only stored provider observations.",
        coverageWarning: "Coverage may be partial.",
      },
      {
        type: "source_note",
        id: "source-note-no-warning",
        sourceDateId: "window",
        methodology: "Uses a stored first-party window.",
      },
      {
        type: "state",
        id: "unavailable-state",
        state: "unavailable",
        reason: "Some data was not observed.",
      },
      { type: "native_artifact", id: "artifact-block", artifactId: "artifact" },
    ],
    artifacts: [
      {
        id: "artifact",
        label: "Stored draft",
        format: "md",
        mediaType: REPORT_NATIVE_MEDIA_TYPES.md,
        extension: "md",
        byteLength: 0,
        sha256: "0".repeat(64),
        validation: "valid",
      },
    ],
  };
}

function csvDocument(): ReportDocumentV1 {
  const document = richDocument();
  return {
    ...document,
    branding: { ...document.branding, logo: null },
    blocks: document.blocks.filter((block) => block.type === "table"),
    artifacts: [],
  };
}

function nativeDocument(
  format: "md" | "jsonld" | "txt",
  bytes: Uint8Array,
): ReportDocumentV1 {
  const document = richDocument();
  const mediaType = REPORT_NATIVE_MEDIA_TYPES[format];
  return {
    ...document,
    blocks: [
      { type: "native_artifact", id: "native-block", artifactId: "native" },
    ],
    artifacts: [
      {
        id: "native",
        label: "Native artifact",
        format,
        mediaType,
        extension: format,
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        validation: "valid",
      },
    ],
  };
}

function nativeResult(
  format: "md" | "jsonld" | "txt",
  bytes: Uint8Array,
): ReportRenderedResult {
  return {
    format,
    mediaType: REPORT_NATIVE_MEDIA_TYPES[format],
    extension: REPORT_FORMAT_EXTENSIONS[format],
    bytes: Uint8Array.from(bytes),
  };
}

describe("canonical report renderers", () => {
  it("renders a complete branded multipage PDF including every block family", async () => {
    const first = await renderReportPdf({
      document: richDocument(),
      snapshotCreatedAt: SNAPSHOT_AT,
    });
    const second = await renderReportDocument({
      document: richDocument(),
      format: "pdf",
      snapshotCreatedAt: SNAPSHOT_AT,
    });
    expect(first).toMatchObject({
      format: "pdf",
      mediaType: "application/pdf",
      extension: "pdf",
    });
    expect(Buffer.from(first.bytes).subarray(0, 5).toString("ascii")).toBe(
      "%PDF-",
    );
    expect(Buffer.from(second.bytes)).toEqual(Buffer.from(first.bytes));
    expect(first.bytes.byteLength).toBeGreaterThan(5_000);
  }, 30_000);

  it("renders Arabic RTL and Chinese CJK documents with the locale-specific embedded fonts", async () => {
    const arabic = richDocument("ar");
    const chinese = richDocument("zh");
    chinese.branding = { ...chinese.branding, logo: null };
    chinese.blocks = chinese.blocks.slice(0, 3);
    const [arBytes, zhBytes] = await Promise.all([
      renderReportPdf({ document: arabic, snapshotCreatedAt: SNAPSHOT_AT }),
      renderReportPdf({ document: chinese, snapshotCreatedAt: SNAPSHOT_AT }),
    ]);
    expect(arBytes.bytes.byteLength).toBeGreaterThan(1_000);
    expect(zhBytes.bytes.byteLength).toBeGreaterThan(1_000);
  }, 30_000);

  it("renders source-aware formula-safe CSV and recursively stable JSON", async () => {
    const document = csvDocument();
    assertReportDocumentRenderable(document, "csv");
    assertReportDocumentRenderable(document, "json");
    const csv = renderReportCsv(document);
    const viaDispatch = await renderReportDocument({
      document,
      format: "csv",
      snapshotCreatedAt: SNAPSHOT_AT,
    });
    const text = Buffer.from(csv.bytes).toString("utf8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("Column 1 — observation");
    expect(text).toContain("'=SUM(A1:A2)");
    expect(Buffer.from(viaDispatch.bytes)).toEqual(Buffer.from(csv.bytes));

    const json = renderReportJson(document);
    const parsed = JSON.parse(
      Buffer.from(json.bytes).toString("utf8"),
    ) as ReportDocumentV1;
    expect(parsed.title).toBe(document.title);
    expect(Buffer.from(json.bytes).toString("utf8").endsWith("\n")).toBe(true);
    await expect(
      renderReportDocument({
        document,
        format: "json",
        snapshotCreatedAt: SNAPSHOT_AT,
      }),
    ).resolves.toMatchObject({ format: "json" });
  });

  it("refuses oversized PDF tables/cells, ambiguous CSV projections, and invalid snapshot input", async () => {
    const tooWide = csvDocument();
    const table = tooWide.blocks[0];
    if (!table || table.type !== "table")
      throw new Error("missing table fixture");
    table.columns = Array.from({ length: 17 }, (_, index) => ({
      key: `wide-${index}`,
      label: `Wide ${index}`,
      valueType: "string",
    }));
    table.rows = [];
    expect(() => assertReportDocumentRenderable(tooWide, "pdf")).toThrow(
      /too many columns/u,
    );

    const hugeCell = csvDocument();
    const hugeTable = hugeCell.blocks[0];
    if (!hugeTable || hugeTable.type !== "table")
      throw new Error("missing table fixture");
    hugeTable.rows[0]!.cells[0]!.value = {
      type: "string",
      value: "x".repeat(10_001),
    };
    expect(() => assertReportDocumentRenderable(hugeCell, "pdf")).toThrow(
      /cell is too large/u,
    );

    expect(() => assertReportDocumentRenderable(richDocument(), "csv")).toThrow(
      /exactly one/u,
    );
    const noTable = richDocument();
    noTable.blocks = noTable.blocks.filter(
      (block) => block.type !== "table" && block.type !== "time_series",
    );
    expect(() => assertReportDocumentRenderable(noTable, "csv")).toThrow(
      /exactly one/u,
    );
    await expect(
      renderReportPdf({
        document: richDocument(),
        snapshotCreatedAt: "invalid",
      }),
    ).rejects.toMatchObject({ reason: "invalid_output" });
  }, 30_000);

  it.each([
    ["md", Buffer.from("# Stored draft\n", "utf8")],
    ["txt", Buffer.from("Stored disavow artifact\n", "utf8")],
    [
      "jsonld",
      Buffer.from(
        serializeJsonLd({
          "@context": "https://schema.org",
          name: "</script>",
        }),
        "utf8",
      ),
    ],
  ] as const)(
    "validates and renders one canonical %s native artifact",
    async (format, bytes) => {
      const document = nativeDocument(format, bytes);
      assertReportDocumentRenderable(document, format);
      const result = await renderReportDocument({
        document,
        format,
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult(format, bytes),
      });
      expect(result.format).toBe(format);
      expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
    },
  );

  it("fails closed for every native artifact mismatch and wraps schema/decoder errors", async () => {
    const bytes = Buffer.from("# Stored draft\n", "utf8");
    const document = nativeDocument("md", bytes);
    await expect(
      renderReportDocument({
        document,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
      }),
    ).rejects.toThrow(/renderer is unavailable/u);
    await expect(
      renderReportDocument({
        document,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("txt", bytes),
      }),
    ).rejects.toThrow(/format mismatch/u);
    await expect(
      renderReportDocument({
        document,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => ({
          ...nativeResult("md", bytes),
          mediaType: "text/plain",
        }),
      }),
    ).rejects.toThrow(/output failed validation/u);
    const descriptorMismatch = nativeDocument("md", bytes);
    descriptorMismatch.artifacts[0] = {
      ...descriptorMismatch.artifacts[0]!,
      sha256: "f".repeat(64),
    };
    await expect(
      renderReportDocument({
        document: descriptorMismatch,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("md", bytes),
      }),
    ).rejects.toThrow(/bytes do not match/u);
    await expect(
      renderReportDocument({
        document,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () =>
          nativeResult("md", Buffer.from("unsafe\u0001text")),
      }),
    ).rejects.toThrow(/unsafe text/u);
    await expect(
      renderReportDocument({
        document: nativeDocument("md", new Uint8Array([0xff])),
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("md", new Uint8Array([0xff])),
      }),
    ).rejects.toMatchObject({ reason: "invalid_output" });

    const arrayJson = Buffer.from("[]", "utf8");
    await expect(
      renderReportDocument({
        document: nativeDocument("jsonld", arrayJson),
        format: "jsonld",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("jsonld", arrayJson),
      }),
    ).rejects.toThrow(/must be an object/u);
    const nonCanonicalJson = Buffer.from('{"name":"value" }', "utf8");
    await expect(
      renderReportDocument({
        document: nativeDocument("jsonld", nonCanonicalJson),
        format: "jsonld",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("jsonld", nonCanonicalJson),
      }),
    ).rejects.toThrow(/canonically escaped/u);

    const ambiguous = nativeDocument("md", bytes);
    ambiguous.artifacts.push({
      ...ambiguous.artifacts[0]!,
      id: "second-native",
    });
    expect(() => assertReportDocumentRenderable(ambiguous, "md")).toThrow(
      /ambiguous/u,
    );
    await expect(
      renderReportDocument({
        document: ambiguous,
        format: "md",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("md", bytes),
      }),
    ).rejects.toThrow(/ambiguous/u);
    const missingDescriptor = nativeDocument("md", bytes);
    await expect(
      renderReportDocument({
        document: missingDescriptor,
        format: "txt",
        snapshotCreatedAt: SNAPSHOT_AT,
        renderNative: async () => nativeResult("txt", bytes),
      }),
    ).rejects.toThrow(/missing or ambiguous/u);

    const invalid = richDocument();
    invalid.branding = { ...invalid.branding, accentColor: "not-a-color" };
    await expect(
      renderReportDocument({
        document: invalid,
        format: "json",
        snapshotCreatedAt: SNAPSHOT_AT,
      }),
    ).rejects.toBeInstanceOf(ReportRenderRefusal);
  });
});

describe("report PDF text and pagination support", () => {
  it("selects and caches locale fonts and shapes mixed RTL runs", () => {
    expect(reportPdfFontFiles("ar")).toEqual({
      regular: "NotoSansArabic-Regular.ttf",
      bold: "NotoSansArabic-Regular.ttf",
    });
    expect(reportPdfFontFiles("zh")).toEqual({
      regular: "NotoSansSC-Regular.otf",
      bold: "NotoSansSC-Regular.otf",
    });
    expect(reportPdfFontFiles("en")).toEqual({
      regular: "NotoSans-Regular.ttf",
      bold: "NotoSans-Bold.ttf",
    });
    const first = readReportPdfFont("NotoSans-Regular.ttf");
    expect(readReportPdfFont("NotoSans-Regular.ttf")).toBe(first);
    expect(first.byteLength).toBeGreaterThan(1_000);
    expect(containsReportArabic("English only")).toBe(false);
    expect(containsReportArabic("مرحبا")).toBe(true);
    expect(shapeReportArabic("مرحبا")).not.toBe("مرحبا");
    expect(toVisualReportRtlLine("مرحبا rank me fast العالم")).toContain(
      "rank me fast",
    );
    expect(toVisualReportRtlLine("one two")).toBe("one two");
  });

  it("wraps words, long tokens, CJK characters, empty text, and paginates paragraphs", async () => {
    const context = await createReportPdfContext("en");
    expect(
      wrapReportPdfText({
        context,
        font: context.regular,
        size: 10,
        text: "short words that wrap",
        maxWidth: 40,
      }).length,
    ).toBeGreaterThan(1);
    expect(
      wrapReportPdfText({
        context,
        font: context.regular,
        size: 10,
        text: "averyveryverylongtoken",
        maxWidth: 20,
      }).length,
    ).toBeGreaterThan(1);
    expect(
      wrapReportPdfText({
        context,
        font: context.regular,
        size: 10,
        text: "",
        maxWidth: 20,
      }),
    ).toEqual([""]);
    const initialPages = context.doc.getPageCount();
    context.y = REPORT_PDF_MARGIN;
    ensureReportPdfSpace(context, 20);
    expect(context.doc.getPageCount()).toBe(initialPages + 1);
    addReportPdfPage(context);
    drawReportPdfParagraph(context, "first line\nsecond line", {
      font: context.regular,
      size: 10,
      color: rgb(0, 0, 0),
      indent: 5,
      maxWidth: 100,
      spacingAfter: 4,
    });
    expect(context.y).toBeLessThan(800);
    expect(
      prepareReportPdfText(context, context.regular, "tabs\tare\rspaces\nand lines"),
    ).toBe("tabs are spaces and lines");
    expect(() =>
      prepareReportPdfText(context, context.regular, "\u{10ffff}"),
    ).toThrow(/has no glyph/u);

    const cjk = await createReportPdfContext("zh");
    expect(
      wrapReportPdfText({
        context: cjk,
        font: cjk.regular,
        size: 10,
        text: "已存储报告内容",
        maxWidth: 20,
      }).length,
    ).toBeGreaterThan(1);
    const rtl = await createReportPdfContext("ar");
    expect(prepareReportPdfText(rtl, rtl.regular, "مرحبا")).not.toBe("مرحبا");
  }, 30_000);
});
