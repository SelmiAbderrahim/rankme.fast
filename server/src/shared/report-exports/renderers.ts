import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { rgb, type RGB } from "pdf-lib";
import { serializeJsonLd } from "../security/json-ld.js";
import { toCsv, type CsvColumn } from "../utils/csv.js";
import { REPORT_FORMAT_EXTENSIONS, REPORT_FORMAT_MEDIA_TYPES, REPORT_NATIVE_MEDIA_TYPES, reportDocumentV1Schema, reportRenderedResultSchema, type ReportBlockV1, type ReportDocumentV1, type ReportRenderedResult, type ReportScalarValue, type ReportSourceDate, } from "./contracts.js";
import type { ReportFormat } from "./catalog.js";
import { REPORT_PDF_CONTENT_WIDTH, REPORT_PDF_MARGIN, REPORT_PDF_PAGE_WIDTH, createReportPdfContext, drawReportPdfText, drawReportPdfParagraph, ensureReportPdfSpace, measureReportPdfText, prepareReportPdfText, toVisualReportRtlLine, wrapReportPdfText, } from "./pdf-support.js";
import { stableReportJson } from "./stable-json.js";
const INK = rgb(28 / 255, 26 / 255, 24 / 255);
const BODY = rgb(25 / 255, 23 / 255, 21 / 255);
const MUTED = rgb(107 / 255, 102 / 255, 96 / 255);
const RULE = rgb(210 / 255, 204 / 255, 196 / 255);
const MAX_PDF_COLUMNS = 16;
const PDF_VISIBLE_COLUMNS = 8;
const MAX_PDF_CELL_CHARACTERS = 10000;
type NativeReportFormat = keyof typeof REPORT_NATIVE_MEDIA_TYPES;
const NATIVE_FORMATS = new Set<ReportFormat>(["md", "jsonld", "txt"]);
const SAFE_NATIVE_TEXT = 
// eslint-disable-next-line no-control-regex -- native text must explicitly reject C0/C1 controls and bidi overrides
/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]*$/u;
export class ReportRenderRefusal extends Error {
    constructor(readonly reason: "scope_too_large" | "invalid_output", message: string) {
        super(message);
        this.name = "ReportRenderRefusal";
    }
}
function accentColor(value: string): RGB {
    return rgb(Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255);
}
function scalarText(value: ReportScalarValue): string {
    if (value.type === "null")
        return "";
    if (value.type === "unavailable")
        return value.reason;
    if (value.type === "boolean")
        return value.value ? "true" : "false";
    return String(value.value);
}
function sourceLabel(source: ReportSourceDate): string {
    const range = source.observedAt ?? `${source.from}/${source.to}`;
    const freshness = source.freshness ? `; ${source.freshness}` : "";
    return `${source.label}; ${source.kind}; ${range}${freshness}`;
}
function dataTables(document: ReportDocumentV1): Array<{
    columns: Extract<ReportBlockV1, {
        type: "table";
    }>["columns"];
    rows: Extract<ReportBlockV1, {
        type: "table";
    }>["rows"];
}> {
    return document.blocks.flatMap((block) => {
        if (block.type === "table")
            return [block];
        if (block.type === "time_series")
            return [block.tableFallback];
        return [];
    });
}
function assertPdfBounds(document: ReportDocumentV1): void {
    for (const table of dataTables(document)) {
        if (table.columns.length > MAX_PDF_COLUMNS) {
            throw new ReportRenderRefusal("scope_too_large", "report PDF table has too many columns");
        }
        for (const row of table.rows) {
            for (const cell of row.cells) {
                if (scalarText(cell.value).length > MAX_PDF_CELL_CHARACTERS) {
                    throw new ReportRenderRefusal("scope_too_large", "report PDF cell is too large");
                }
            }
        }
    }
}
/** Validate format-specific shape and size bounds before any bytes are rendered. */
export function assertReportDocumentRenderable(documentInput: ReportDocumentV1, format: ReportFormat): void {
    const document = reportDocumentV1Schema.parse(documentInput);
    if (format === "pdf") {
        assertPdfBounds(document);
        return;
    }
    if (format === "csv") {
        const tables = dataTables(document);
        if (tables.length !== 1) {
            throw new ReportRenderRefusal("scope_too_large", "CSV reports require exactly one canonical table projection");
        }
        return;
    }
    if (NATIVE_FORMATS.has(format)) {
        const artifacts = document.artifacts.filter((artifact) => artifact.format === format);
        if (artifacts.length !== 1) {
            throw new ReportRenderRefusal("invalid_output", "native artifact descriptor is missing or ambiguous");
        }
    }
}
function drawTitleAndMetadata(document: ReportDocumentV1, context: Awaited<ReturnType<typeof createReportPdfContext>>, accent: RGB): void {
    drawReportPdfParagraph(context, document.branding.companyName, {
        font: context.bold,
        size: 20,
        color: INK,
        spacingAfter: 6,
    });
    context.page.drawRectangle({
        x: REPORT_PDF_MARGIN,
        y: context.y - 3,
        width: REPORT_PDF_CONTENT_WIDTH,
        height: 3,
        color: accent,
    });
    context.y -= 17;
    drawReportPdfParagraph(context, document.title, {
        font: context.bold,
        size: 16,
        color: BODY,
        spacingAfter: 8,
    });
    for (const item of [...document.subject, ...document.selection]) {
        drawReportPdfParagraph(context, `${item.label}: ${item.value}`, {
            font: context.regular,
            size: 9,
            color: MUTED,
            spacingAfter: 2,
        });
    }
    for (const source of document.sourceDates) {
        drawReportPdfParagraph(context, sourceLabel(source), {
            font: context.regular,
            size: 8,
            color: MUTED,
            spacingAfter: 2,
        });
    }
    context.y -= 8;
}
async function drawLogo(document: ReportDocumentV1, context: Awaited<ReturnType<typeof createReportPdfContext>>): Promise<void> {
    if (!document.branding.logo)
        return;
    const bytes = Buffer.from(document.branding.logo.bytesBase64, "base64");
    const image = await context.doc.embedPng(bytes);
    const scale = Math.min(1, 96 / image.width, 36 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ensureReportPdfSpace(context, height + 8);
    context.page.drawImage(image, {
        x: context.rtl
            ? REPORT_PDF_PAGE_WIDTH - REPORT_PDF_MARGIN - width
            : REPORT_PDF_MARGIN,
        y: context.y - height,
        width,
        height,
    });
    context.y -= height + 8;
}
type PdfKeyValueItem = Extract<ReportBlockV1, {
    type: "key_value";
}>["items"][number] | Extract<ReportBlockV1, {
    type: "kpi_group";
}>["items"][number];
function drawKeyValueItems(context: Awaited<ReturnType<typeof createReportPdfContext>>, items: readonly PdfKeyValueItem[]): void {
    for (const item of items) {
        const unit = item.unit ? ` ${item.unit}` : "";
        drawReportPdfParagraph(context, `${item.label}: ${scalarText(item.value)}${unit}`, {
            font: context.regular,
            size: 10,
            color: BODY,
            spacingAfter: 4,
        });
    }
    context.y -= 4;
}
function drawTable(context: Awaited<ReturnType<typeof createReportPdfContext>>, table: ReturnType<typeof dataTables>[number]): void {
    const columnSlices: number[][] = [];
    const allIndexes = table.columns.map((_column, index) => index);
    if (allIndexes.length <= PDF_VISIBLE_COLUMNS) {
        columnSlices.push(allIndexes);
    }
    else {
        columnSlices.push(allIndexes.slice(0, PDF_VISIBLE_COLUMNS));
        for (let start = PDF_VISIBLE_COLUMNS; start < allIndexes.length; start += PDF_VISIBLE_COLUMNS - 1) {
            columnSlices.push([
                0,
                ...allIndexes.slice(start, start + PDF_VISIBLE_COLUMNS - 1),
            ]);
        }
    }
    const gap = 6;
    const drawRow = (values: readonly string[], header: boolean, visibleColumnCount: number): void => {
        const width = (REPORT_PDF_CONTENT_WIDTH - gap * (visibleColumnCount - 1)) /
            visibleColumnCount;
        const font = header ? context.bold : context.regular;
        const size = header ? 8 : 7.5;
        const wrapped = values.map((value) => {
            const prepared = prepareReportPdfText(context, font, value);
            return wrapReportPdfText({
                context,
                font,
                size,
                text: prepared,
                maxWidth: width,
            });
        });
        const lines = Math.max(...wrapped.map((value) => value.length));
        const rowHeight = Math.max(18, lines * size * 1.35 + 6);
        ensureReportPdfSpace(context, rowHeight);
        wrapped.forEach((cell, columnIndex) => {
            cell.forEach((line, lineIndex) => {
                const visual = context.rtl ? toVisualReportRtlLine(line) : line;
                const left = REPORT_PDF_MARGIN + columnIndex * (width + gap);
                const x = context.rtl
                    ? left + width - measureReportPdfText(context, font, visual, size)
                    : left;
                drawReportPdfText(context, font, visual, {
                    x,
                    y: context.y - size - lineIndex * size * 1.35,
                    size,
                    color: header ? INK : BODY,
                });
            });
        });
        context.page.drawLine({
            start: { x: REPORT_PDF_MARGIN, y: context.y - rowHeight + 2 },
            end: {
                x: REPORT_PDF_PAGE_WIDTH - REPORT_PDF_MARGIN,
                y: context.y - rowHeight + 2,
            },
            color: RULE,
            thickness: 0.5,
        });
        context.y -= rowHeight;
    };
    for (const indexes of columnSlices) {
        const headers = indexes.map((index) => {
            const column = table.columns[index]!;
            return column.unit ? `${column.label} [${column.unit}]` : column.label;
        });
        drawRow(headers, true, indexes.length);
        for (const row of table.rows) {
            if (context.y < REPORT_PDF_MARGIN + 70) {
                drawRow(headers, true, indexes.length);
            }
            drawRow(indexes.map((index) => scalarText(row.cells[index]!.value)), false, indexes.length);
        }
        context.y -= 8;
    }
}
function drawBlock(document: ReportDocumentV1, block: ReportBlockV1, context: Awaited<ReturnType<typeof createReportPdfContext>>, accent: RGB): void {
    if (block.type === "heading") {
        const sizes: Record<number, number> = {
            1: 15,
            2: 13,
            3: 12,
            4: 11,
            5: 10,
            6: 9,
        };
        drawReportPdfParagraph(context, block.text, {
            font: context.bold,
            size: sizes[block.level]!,
            color: block.level <= 2 ? accent : BODY,
            spacingAfter: 6,
        });
    }
    else if (block.type === "prose") {
        drawReportPdfParagraph(context, block.text, {
            font: context.regular,
            size: 10,
            color: block.tone === "warning" ? accent : BODY,
            spacingAfter: 8,
        });
    }
    else if (block.type === "kpi_group") {
        drawKeyValueItems(context, block.items);
    }
    else if (block.type === "key_value") {
        drawKeyValueItems(context, block.items);
    }
    else if (block.type === "findings") {
        for (const finding of block.items) {
            drawReportPdfParagraph(context, finding.title, {
                font: context.bold,
                size: 11,
                color: finding.bucket === "passed" ? BODY : accent,
                spacingAfter: 2,
            });
            drawReportPdfParagraph(context, finding.why, {
                font: context.regular,
                size: 9,
                color: BODY,
                spacingAfter: 2,
            });
            for (const text of [finding.fix, finding.pass].filter((value): value is string => Boolean(value))) {
                drawReportPdfParagraph(context, text, {
                    font: context.regular,
                    size: 9,
                    color: BODY,
                    spacingAfter: 2,
                });
            }
            for (const url of finding.affectedUrls) {
                drawReportPdfParagraph(context, url, {
                    font: context.regular,
                    size: 8,
                    color: MUTED,
                    indent: 10,
                    spacingAfter: 1,
                });
            }
            for (const evidence of finding.evidence) {
                drawReportPdfParagraph(context, evidence, {
                    font: context.regular,
                    size: 8,
                    color: MUTED,
                    indent: 10,
                    spacingAfter: 1,
                });
            }
            context.y -= 6;
        }
    }
    else if (block.type === "table") {
        drawTable(context, block);
    }
    else if (block.type === "time_series") {
        drawTable(context, block.tableFallback);
    }
    else if (block.type === "source_note") {
        const source = document.sourceDates.find((item) => item.id === block.sourceDateId)!;
        drawReportPdfParagraph(context, `${sourceLabel(source)}\n${block.methodology}`, {
            font: context.regular,
            size: 8,
            color: MUTED,
            spacingAfter: 4,
        });
        if (block.coverageWarning) {
            drawReportPdfParagraph(context, block.coverageWarning, {
                font: context.regular,
                size: 8,
                color: accent,
                spacingAfter: 6,
            });
        }
    }
    else if (block.type === "state") {
        drawReportPdfParagraph(context, block.reason, {
            font: context.regular,
            size: 10,
            color: MUTED,
            spacingAfter: 8,
        });
    }
    else {
        const artifact = document.artifacts.find((item) => item.id === block.artifactId)!;
        drawReportPdfParagraph(context, artifact.label, {
            font: context.regular,
            size: 9,
            color: MUTED,
            spacingAfter: 6,
        });
    }
}
export async function renderReportPdf(input: {
    document: ReportDocumentV1;
    snapshotCreatedAt: string;
}): Promise<ReportRenderedResult> {
    const document = reportDocumentV1Schema.parse(input.document);
    assertPdfBounds(document);
    const context = await createReportPdfContext(document.locale);
    const snapshotDate = new Date(input.snapshotCreatedAt);
    if (!Number.isFinite(snapshotDate.getTime())) {
        throw new ReportRenderRefusal("invalid_output", "invalid snapshot date");
    }
    context.doc.setTitle(document.title);
    context.doc.setProducer("RankMeFast");
    context.doc.setCreator("RankMeFast");
    context.doc.setCreationDate(snapshotDate);
    context.doc.setModificationDate(snapshotDate);
    await drawLogo(document, context);
    const accent = accentColor(document.branding.accentColor);
    drawTitleAndMetadata(document, context, accent);
    for (const block of document.blocks)
        drawBlock(document, block, context, accent);
    const pages = context.doc.getPages();
    pages.forEach((page, index) => {
        const logical = `${index + 1} / ${pages.length}`;
        const prepared = prepareReportPdfText(context, context.regular, logical);
        const text = context.rtl ? toVisualReportRtlLine(prepared) : prepared;
        context.page = page;
        drawReportPdfText(context, context.regular, text, {
            x: (REPORT_PDF_PAGE_WIDTH -
                measureReportPdfText(context, context.regular, text, 9)) /
                2,
            y: REPORT_PDF_MARGIN / 2,
            size: 9,
            color: MUTED,
        });
    });
    return reportRenderedResultSchema.parse({
        format: "pdf",
        mediaType: REPORT_FORMAT_MEDIA_TYPES.pdf,
        extension: REPORT_FORMAT_EXTENSIONS.pdf,
        bytes: await context.doc.save(),
    });
}
export function renderReportCsv(documentInput: ReportDocumentV1): ReportRenderedResult {
    const document = reportDocumentV1Schema.parse(documentInput);
    assertReportDocumentRenderable(document, "csv");
    const tables = dataTables(document);
    const table = tables[0]!;
    const sources = new Map(document.sourceDates.map((source) => [source.id, source]));
    const columns: CsvColumn[] = [];
    const rows: Array<Record<string, unknown>> = table.rows.map(() => ({}));
    table.columns.forEach((column, columnIndex) => {
        const valueKey = `value_${columnIndex}`;
        columns.push({
            key: valueKey,
            header: column.unit ? `${column.label} [${column.unit}]` : column.label,
        });
        const includesObservation = table.rows.some((row) => row.cells[columnIndex]?.sourceDateId !== undefined);
        const observationKey = `observation_${columnIndex}`;
        if (includesObservation) {
            columns.push({
                key: observationKey,
                header: `${column.label} — observation`,
            });
        }
        table.rows.forEach((row, rowIndex) => {
            const cell = row.cells[columnIndex]!;
            rows[rowIndex]![valueKey] = scalarText(cell.value);
            if (includesObservation) {
                const source = cell.sourceDateId
                    ? sources.get(cell.sourceDateId)
                    : undefined;
                rows[rowIndex]![observationKey] = source ? sourceLabel(source) : "";
            }
        });
    });
    return reportRenderedResultSchema.parse({
        format: "csv",
        mediaType: REPORT_FORMAT_MEDIA_TYPES.csv,
        extension: REPORT_FORMAT_EXTENSIONS.csv,
        bytes: Buffer.from(toCsv(rows, columns), "utf8"),
    });
}
export function renderReportJson(documentInput: ReportDocumentV1): ReportRenderedResult {
    const document = reportDocumentV1Schema.parse(documentInput);
    return reportRenderedResultSchema.parse({
        format: "json",
        mediaType: REPORT_FORMAT_MEDIA_TYPES.json,
        extension: REPORT_FORMAT_EXTENSIONS.json,
        bytes: Buffer.from(stableReportJson(document), "utf8"),
    });
}
function validateNativeBytes(document: ReportDocumentV1, result: ReportRenderedResult, format: NativeReportFormat): ReportRenderedResult {
    const descriptor = document.artifacts.find((artifact) => artifact.format === format);
    if (!descriptor ||
        document.artifacts.filter((artifact) => artifact.format === format)
            .length !== 1) {
        throw new ReportRenderRefusal("invalid_output", "native artifact descriptor is missing or ambiguous");
    }
    const bytes = Buffer.from(result.bytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!SAFE_NATIVE_TEXT.test(text)) {
        throw new ReportRenderRefusal("invalid_output", "native artifact contains unsafe text");
    }
    if (format === "jsonld") {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null ||
            Array.isArray(parsed) ||
            typeof parsed !== "object") {
            throw new ReportRenderRefusal("invalid_output", "JSON-LD artifact must be an object");
        }
        if (serializeJsonLd(parsed as Record<string, unknown>) !== text) {
            throw new ReportRenderRefusal("invalid_output", "JSON-LD artifact is not canonically escaped");
        }
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (result.mediaType !== REPORT_NATIVE_MEDIA_TYPES[format] ||
        result.extension !== REPORT_FORMAT_EXTENSIONS[format] ||
        descriptor.mediaType !== result.mediaType ||
        descriptor.extension !== result.extension ||
        descriptor.byteLength !== bytes.byteLength ||
        descriptor.sha256 !== digest) {
        throw new ReportRenderRefusal("invalid_output", "native artifact bytes do not match the canonical descriptor");
    }
    return reportRenderedResultSchema.parse(result);
}
export type NativeReportRenderer = () => Promise<ReportRenderedResult>;
/** One deterministic dispatch point for every approved representation. */
export async function renderReportDocument(input: {
    document: ReportDocumentV1;
    format: ReportFormat;
    snapshotCreatedAt: string;
    renderNative?: NativeReportRenderer;
}): Promise<ReportRenderedResult> {
    try {
        if (input.format === "pdf")
            return await renderReportPdf(input);
        if (input.format === "csv")
            return renderReportCsv(input.document);
        if (input.format === "json")
            return renderReportJson(input.document);
        if (!input.renderNative) {
            throw new ReportRenderRefusal("invalid_output", "native report renderer is unavailable");
        }
        const result = reportRenderedResultSchema.parse(await input.renderNative());
        if (result.format !== input.format) {
            throw new ReportRenderRefusal("invalid_output", "native report format mismatch");
        }
        return validateNativeBytes(reportDocumentV1Schema.parse(input.document), result, input.format);
    }
    catch (error) {
        if (error instanceof ReportRenderRefusal)
            throw error;
        throw new ReportRenderRefusal("invalid_output", "report output failed validation");
    }
}
