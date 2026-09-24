import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import reshaper from "arabic-persian-reshaper";
import { PDFDocument, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { ReportLocale } from "./contracts.js";
export const REPORT_PDF_PAGE_WIDTH = 595.28;
export const REPORT_PDF_PAGE_HEIGHT = 841.89;
export const REPORT_PDF_MARGIN = 50;
export const REPORT_PDF_FOOTER_SPACE = 34;
export const REPORT_PDF_CONTENT_WIDTH = REPORT_PDF_PAGE_WIDTH - REPORT_PDF_MARGIN * 2;
export type PdfFontFile = "NotoSans-Regular.ttf" | "NotoSans-Bold.ttf" | "NotoSansArabic-Regular.ttf" | "NotoSansSC-Regular.otf";
const fontCache = new Map<PdfFontFile, Uint8Array>();
function fontUrl(file: PdfFontFile): URL {
    const sourceUrl = new URL(`../../modules/audits/pdf/fonts/${file}`, import.meta.url);
    if (existsSync(fileURLToPath(sourceUrl)))
        return sourceUrl;
    return new URL(`./fonts/${file}`, import.meta.url);
}
export function readReportPdfFont(file: PdfFontFile): Uint8Array {
    const cached = fontCache.get(file);
    if (cached)
        return cached;
    const bytes = readFileSync(fileURLToPath(fontUrl(file)));
    fontCache.set(file, bytes);
    return bytes;
}
export function reportPdfFontFiles(locale: ReportLocale): {
    regular: PdfFontFile;
    bold: PdfFontFile;
} {
    if (locale === "ar") {
        return {
            regular: "NotoSansArabic-Regular.ttf",
            bold: "NotoSansArabic-Regular.ttf",
        };
    }
    if (locale === "zh") {
        return {
            regular: "NotoSansSC-Regular.otf",
            bold: "NotoSansSC-Regular.otf",
        };
    }
    return { regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" };
}
const ARABIC_CHAR = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufefc]/u;
export function containsReportArabic(text: string): boolean {
    return ARABIC_CHAR.test(text);
}
export function shapeReportArabic(text: string): string {
    return reshaper.ArabicShaper.convertArabic(text);
}
export function toVisualReportRtlLine(line: string): string {
    const runs: Array<{
        rtl: boolean;
        words: string[];
    }> = [];
    for (const word of line.split(" ")) {
        const rtl = containsReportArabic(word);
        const previous = runs[runs.length - 1];
        if (previous?.rtl === rtl)
            previous.words.push(word);
        else
            runs.push({ rtl, words: [word] });
    }
    const output: string[] = [];
    for (let index = runs.length - 1; index >= 0; index -= 1) {
        const run = runs[index]!;
        if (run.rtl) {
            for (let wordIndex = run.words.length - 1; wordIndex >= 0; wordIndex -= 1) {
                output.push([...run.words[wordIndex]!].reverse().join(""));
            }
        }
        else
            output.push(...run.words);
    }
    return output.join(" ");
}
export interface ReportPdfContext {
    doc: PDFDocument;
    page: PDFPage;
    y: number;
    rtl: boolean;
    cjk: boolean;
    regular: PDFFont;
    bold: PDFFont;
    glyphs: Map<PDFFont, Set<number>>;
    fallbacks: Map<PDFFont, PDFFont>;
}
export async function createReportPdfContext(locale: ReportLocale): Promise<ReportPdfContext> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const files = reportPdfFontFiles(locale);
    const regular = await doc.embedFont(readReportPdfFont(files.regular), {
        subset: true,
        customName: "RankMeFast-Regular",
    });
    const bold = files.bold === files.regular && locale !== "ar"
        ? regular
        : await doc.embedFont(readReportPdfFont(files.bold), {
            subset: true,
            customName: "RankMeFast-Bold",
        });
    const fallbacks = new Map<PDFFont, PDFFont>();
    if (locale === "ar") {
        const latinRegular = await doc.embedFont(readReportPdfFont("NotoSans-Regular.ttf"), { subset: true, customName: "RankMeFast-Latin-Regular" });
        const latinBold = await doc.embedFont(readReportPdfFont("NotoSans-Bold.ttf"), { subset: true, customName: "RankMeFast-Latin-Bold" });
        fallbacks.set(regular, latinRegular);
        fallbacks.set(bold, latinBold);
    }
    const context: ReportPdfContext = {
        doc,
        page: undefined as unknown as PDFPage,
        y: 0,
        rtl: locale === "ar",
        cjk: locale === "zh",
        regular,
        bold,
        glyphs: new Map(),
        fallbacks,
    };
    addReportPdfPage(context);
    return context;
}
export function addReportPdfPage(context: ReportPdfContext): void {
    context.page = context.doc.addPage([
        REPORT_PDF_PAGE_WIDTH,
        REPORT_PDF_PAGE_HEIGHT,
    ]);
    context.y = REPORT_PDF_PAGE_HEIGHT - REPORT_PDF_MARGIN;
}
export function ensureReportPdfSpace(context: ReportPdfContext, height: number): void {
    if (context.y - height < REPORT_PDF_MARGIN + REPORT_PDF_FOOTER_SPACE) {
        addReportPdfPage(context);
    }
}
function glyphSet(context: ReportPdfContext, font: PDFFont): Set<number> {
    const cached = context.glyphs.get(font);
    if (cached)
        return cached;
    const result = new Set(font.getCharacterSet());
    context.glyphs.set(font, result);
    return result;
}
function reportPdfFontForCharacter(context: ReportPdfContext, preferred: PDFFont, character: string): PDFFont {
    const point = character.codePointAt(0) as number;
    if (glyphSet(context, preferred).has(point))
        return preferred;
    const fallback = context.fallbacks.get(preferred);
    if (fallback && glyphSet(context, fallback).has(point))
        return fallback;
    throw new RangeError(`report PDF font has no glyph for U+${point.toString(16)}`);
}
function reportPdfFontRuns(context: ReportPdfContext, preferred: PDFFont, text: string): Array<{
    font: PDFFont;
    text: string;
}> {
    const runs: Array<{
        font: PDFFont;
        text: string;
    }> = [];
    for (const character of text) {
        const font = reportPdfFontForCharacter(context, preferred, character);
        const previous = runs[runs.length - 1];
        if (previous?.font === font)
            previous.text += character;
        else
            runs.push({ font, text: character });
    }
    return runs;
}
export function measureReportPdfText(context: ReportPdfContext, preferred: PDFFont, text: string, size: number): number {
    return reportPdfFontRuns(context, preferred, text).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
}
export function drawReportPdfText(context: ReportPdfContext, preferred: PDFFont, text: string, options: {
    x: number;
    y: number;
    size: number;
    color: RGB;
}): void {
    let x = options.x;
    for (const run of reportPdfFontRuns(context, preferred, text)) {
        context.page.drawText(run.text, {
            x,
            y: options.y,
            size: options.size,
            font: run.font,
            color: options.color,
        });
        x += run.font.widthOfTextAtSize(run.text, options.size);
    }
}
/** Prepare inert text and refuse missing glyphs instead of substituting or clipping. */
export function prepareReportPdfText(context: ReportPdfContext, font: PDFFont, text: string): string {
    const normalized = text.replace(/[\t\r\n]/gu, " ");
    const shaped = context.rtl && containsReportArabic(normalized)
        ? shapeReportArabic(normalized)
        : normalized;
    for (const character of shaped) {
        reportPdfFontForCharacter(context, font, character);
    }
    return shaped;
}
export function wrapReportPdfText(input: {
    context: ReportPdfContext;
    font: PDFFont;
    size: number;
    text: string;
    maxWidth: number;
}): string[] {
    const tokens = input.context.cjk
        ? [...input.text]
        : input.text.split(" ").filter(Boolean);
    const separator = input.context.cjk ? "" : " ";
    const width = (value: string): number => measureReportPdfText(input.context, input.font, value, input.size);
    const lines: string[] = [];
    let current = "";
    const flush = (): void => {
        if (current)
            lines.push(current);
        current = "";
    };
    for (const token of tokens) {
        const candidate = current ? `${current}${separator}${token}` : token;
        if (width(candidate) <= input.maxWidth) {
            current = candidate;
            continue;
        }
        flush();
        if (width(token) <= input.maxWidth) {
            current = token;
            continue;
        }
        let chunk = "";
        for (const character of token) {
            if (chunk && width(chunk + character) > input.maxWidth) {
                lines.push(chunk);
                chunk = character;
            }
            else
                chunk += character;
        }
        current = chunk;
    }
    flush();
    return lines.length > 0 ? lines : [""];
}
export function drawReportPdfParagraph(context: ReportPdfContext, rawText: string, options: {
    font: PDFFont;
    size: number;
    color: RGB;
    indent?: number;
    spacingAfter: number;
    maxWidth?: number;
}): void {
    const indent = options.indent ?? 0;
    const maxWidth = options.maxWidth ?? REPORT_PDF_CONTENT_WIDTH - indent;
    const lineHeight = options.size * 1.4;
    for (const paragraph of rawText.split("\n")) {
        const prepared = prepareReportPdfText(context, options.font, paragraph);
        for (const line of wrapReportPdfText({
            context,
            font: options.font,
            size: options.size,
            text: prepared,
            maxWidth,
        })) {
            ensureReportPdfSpace(context, lineHeight);
            const visual = context.rtl ? toVisualReportRtlLine(line) : line;
            const x = context.rtl
                ? REPORT_PDF_PAGE_WIDTH -
                    REPORT_PDF_MARGIN -
                    indent -
                    measureReportPdfText(context, options.font, visual, options.size)
                : REPORT_PDF_MARGIN + indent;
            drawReportPdfText(context, options.font, visual, {
                x,
                y: context.y - options.size,
                size: options.size,
                color: options.color,
            });
            context.y -= lineHeight;
        }
    }
    context.y -= options.spacingAfter;
}
